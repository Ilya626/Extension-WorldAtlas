import test from 'node:test';
import assert from 'node:assert/strict';
import { collectHistory, liveEvents, eventRoute, requestRoute, calendarRows } from '../history-route.js';
import { hash } from '../../Extension-WorldMemory/history.js';
import { createArchive, readArchive } from '../../Extension-WorldMemory/archive-store.js';
import { installArchiveRuntime } from '../../Extension-WorldMemory/archive-runtime.js';
import { resolveCalendar, formatCalendar } from '../../Extension-WorldMemory/timeline-calendar.js';
import { readRouteSnapshot, snapshotBinding, snapshotHistory, applyRouteSnapshot, undoRouteChange, messageRevision } from '../route-import.js';
import { calendarSelection } from '../calendar-view.js';
import { withGamePlaces } from '../game-places.js';
import { AtlasView } from '../viewer.js';
import { createRouteNetwork } from '../route-network.js';

const atlas = { id: 'example', places: [{ id: 'a', name: 'Альфа', aliases: ['Alpha'] }, { id: 'b', name: 'Бета', aliases: ['Beta'] }] };
const history = packets => collectHistory({ name1: 'Player' }, atlas, { packets });
const unknown = { text: null, precision: 'unknown' };
const portableInput = () => ({ format: 'world-atlas-route', version: 1, atlasId: atlas.id,
    coverage: { throughMessage: 1, messageCount: 2 }, boundary: [messageRevision({ is_user: false, mes: 'Ты прибыл на Альфу.' })],
    events: [{ placeId: 'a', placeName: 'Альфа', status: 'arrived', source: 'Переносимый L0', offset: 0 }],
    calendar: { now: { label: 'День 2', elapsedHours: 24 }, rows: [{ place: 'Альфа', source: 'Переносимый L0', offset: 0, clock: { label: 'День 2' } }] } });
const turn = (id, text, place) => ({ id, text, textRevision: hash(text), order: Number(id), orderKnown: true, sourceMessageIds: [id],
    timeline: place === undefined ? null : { textRevision: hash(text), date: unknown,
        locations: place ? [{ place, status: 'arrived', date: unknown, quote: text, sourceIds: [id] }] : [] } });

test('a game-world leg retains network history and only its landmark approach is dashed', () => {
    const places = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 10, y: 0 }, { id: 'c', x: 20, y: 0 },
        { id: 'game:gamma', x: 33, y: 3, gamePlace: true, gameAnchor: { x: 30, y: 0, name: 'Landmark' } }];
    const layers = [];
    const layer = (points, options) => ({ points, options, addTo() { layers.push(this); return this; } });
    const view = Object.assign(Object.create(AtlasView.prototype), {
        atlas: { height: 100, places }, editing: true,
        displayPoints: () => places,
        routeLayer: { clearLayers() { layers.length = 0; } },
        L: { polyline: layer, circleMarker: layer },
        network: createRouteNetwork([{ name: 'Existing line', points: [[0, 0], [10, 0], [20, 0], [30, 0]] }],
            places.map(place => place.gameAnchor ? { ...place, ...place.gameAnchor } : place)),
    });
    view.drawRoute();
    const history = layers.filter(layer => layer.options.className === 'wa-route-history');
    const estimated = layers.filter(layer => layer.options.className === 'wa-route-estimated');
    assert.equal(history.length, 3);
    assert.deepEqual(history[0].points[0][0], [100, 0]);
    assert.deepEqual(history[0].points.at(-1).at(-1), [100, 10]);
    assert.deepEqual(history.at(-1).points[0][0], [100, 20]);
    assert.deepEqual(history.at(-1).points.at(-1).at(-1), [100, 30]);
    assert.equal(history[0].options.color, '#882b31');
    assert.equal(history.at(-1).options.color, '#ef5b5b');
    assert.ok(history.every(layer => !layer.options.dashArray));
    assert.equal(estimated.length, 1);
    assert.deepEqual(estimated[0].points, [[100, 30], [97, 33]]);
    assert.equal(estimated[0].options.dashArray, '5 8');
    assert.deepEqual(view.routeGaps, []);
});

test('a planned trip does not change player position', () => {
    const input = history([turn('1', 'Ты прибыл на Альфу.', 'Альфа'), turn('2', 'Ты собираешься прибыть на Бету. «Ты прибыл на Бету», — мечтаешь ты.', null)]);
    assert.deepEqual(eventRoute(liveEvents([], input, atlas)), ['a']);
});

test('rollback and editing rebuild the route from current evidence', () => {
    const original = [turn('1', 'Ты прибыл на Альфу.', 'Альфа'), turn('2', 'Ты прибыл на Бету.', 'Бета')];
    const saved = liveEvents([], history(original), atlas);
    assert.deepEqual(eventRoute(saved), ['a', 'b']);
    assert.deepEqual(eventRoute(liveEvents(saved, history(original.slice(0, 1)), atlas)), ['a']);
    const edited = [original[0], { ...original[1], text: 'Ты собираешься прибыть на Бету.', textRevision: hash('Ты собираешься прибыть на Бету.') }];
    assert.deepEqual(eventRoute(liveEvents(saved, history(edited), atlas)), ['a']);
});

test('one update uses one request and a failure preserves saved route data', async () => {
    const input = history([turn('1', 'Ты прибыл на Альфу.')]);
    const saved = { events: [], route: ['a'] };
    const before = structuredClone(saved);
    let calls = 0;
    const config = { url: 'https://example.invalid/v1', model: 'chosen-by-user' };
    await assert.rejects(requestRoute(input, atlas, config, async () => { calls++; throw new Error('HTTP 503'); }));
    assert.equal(calls, 1); assert.deepEqual(saved, before);
    calls = 0;
    const result = await requestRoute(input, atlas, config, async body => {
        calls++; assert.equal(body.stream, false);
        return { choices: [{ message: { content: JSON.stringify({ events: [{ placeId: 'a', source: 'l0:1', quote: 'Ты прибыл на Альфу.' }] }) } }], usage: { prompt_tokens: 100, completion_tokens: 30 } };
    });
    assert.equal(calls, 1); assert.deepEqual(eventRoute(result.events), ['a']); assert.deepEqual(saved, before);
});

test('one L0 response saves exact and approximate dates used by map and calendar without another call', async () => {
    const archive = createArchive(), calls = [];
    const text = 'On 4 Harvest 12, you arrived on Alpha. Two days later, around 6 Harvest 12, you arrived on Beta.';
    const context = { chatId: 'dated', chatMetadata: {}, name1: 'Player', chat: [
        { name: 'Player', is_user: true, mes: 'I take the shuttle.' },
        { name: 'Narrator', is_user: false, mes: text },
        { name: 'Player', is_user: true, mes: 'I pause here.' }], getTokenCountAsync: async text => Math.ceil(text.length / 4) };
    globalThis.SillyTavern = { getContext: () => context };
    const runtime = installArchiveRuntime({ ctx: () => context, getArchive: () => archive, saveArchive: async () => {},
        settings: () => ({ enabled: true, auto: false, retainedContextTokens: 0, blindZoneExchanges: 0,
            ghostUserMessages: false, ghostAssistantMessages: false, summarizerWorldInfo: false }),
        sendRequest: async (_settings, system) => {
            calls.push(system);
            if (!system.includes('This is stage 1')) throw new Error('Existing optional stage 2 is offline.');
            return { text: `${text}\n<story_spine>${JSON.stringify({ text: 'The player visits Alpha, then Beta.', timeline: {
                date: { text: 'Around 6 Harvest 12', precision: 'approximate' }, elapsedHours: 48, timePrecision: 'approximate', locations: [
                    { place: 'Alpha', date: { text: '4 Harvest 12', precision: 'exact' }, offsetHours: 0, status: 'arrived', src: ['s2'], quote: 'On 4 Harvest 12, you arrived on Alpha.' },
                    { place: 'Beta', date: { text: 'Around 6 Harvest 12', precision: 'approximate' }, offsetHours: 48, status: 'arrived', src: ['s2'], quote: 'Two days later, around 6 Harvest 12, you arrived on Beta.' },
                ] } })}</story_spine>` };
        } });
    await runtime.summarizeNow();
    assert.equal(readArchive(archive)[0].text, text);
    assert.equal(calls.filter(system => system.includes('This is stage 1')).length, 1);
    const beforeViews = calls.length;
    const input = collectHistory(context, atlas, runtime.snapshot());
    const events = liveEvents([], input, atlas);
    assert.deepEqual(eventRoute(events), ['a', 'b']);
    assert.deepEqual(calendarRows(input, events).map(row => row.date), [
        { text: '4 Harvest 12', precision: 'exact' }, { text: 'Around 6 Harvest 12', precision: 'approximate' },
    ]);
    assert.deepEqual(calendarRows(input, events, { label: 'Reference event', offsetDays: -60, approximate: true })
        .map(row => ({ day: row.clock.gameDay, offset: row.clock.anchorDay, approximate: row.clock.approximate })),
    [{ day: 1, offset: -60, approximate: true }, { day: 3, offset: -58, approximate: true }]);
    assert.equal(input.sources.length, 0); assert.equal(calls.length, beforeViews);
});

test('portable route/calendar survives reload with different L0 IDs and follows only new sources', () => {
    const context = { chat: [{ is_user: false, mes: 'Ты прибыл на Альфу.' }, { is_user: false, mes: 'Ты прибыл на Бету.' }] };
    const originalLocal = history([]);
    const pack = readRouteSnapshot(portableInput(), atlas);
    const saved = applyRouteSnapshot({ events: [], manual: false }, pack, snapshotBinding(context, originalLocal, pack.boundary), []);
    const restored = JSON.parse(JSON.stringify(saved));
    const oldPacket = { ...turn('99', 'Ты прибыл на Альфу.', 'Альфа'), order: 0 };
    const local = history([oldPacket]);
    const first = snapshotHistory(restored.importedSnapshot, context, local, atlas, resolveCalendar);
    assert.equal(first.importEvents.length, 1);
    assert.deepEqual(first.calendar.rows, pack.calendar.rows);
    const next = { ...turn('100', 'Ты прибыл на Бету.', 'Бета'), order: 1 };
    next.timeline.elapsedHours = 24; next.timeline.timePrecision = 'exact'; next.timeline.locations[0].offsetHours = 24;
    const advanced = snapshotHistory(restored.importedSnapshot, context, history([oldPacket, next]), atlas, resolveCalendar);
    assert.deepEqual(eventRoute(advanced.importEvents), ['a', 'b']);
    assert.equal(advanced.calendar.now.elapsedHours, 48);
    assert.equal(advanced.calendar.rows.length, 2);
    const rolledBack = snapshotHistory(restored.importedSnapshot, context, local, atlas, resolveCalendar);
    assert.equal(rolledBack.calendar.now.elapsedHours, 24);
    assert.deepEqual(eventRoute(rolledBack.importEvents), ['a']);
});

test('an invalid portable file preserves state and a successful import can be undone', () => {
    const original = { events: [{ id: 'existing' }], manual: false, calendarStart: { label: 'Своя опора' }, previous: { manual: true, route: ['a'] } };
    const before = structuredClone(original), route = ['b'];
    assert.throws(() => readRouteSnapshot('{"format":"world-memory-support"}', atlas), /не файл маршрута/);
    assert.deepEqual(original, before);
    const overlong = portableInput(); overlong.calendar.now.label = 'x'.repeat(2001);
    assert.throws(() => readRouteSnapshot(overlong, atlas), /не обрезались/);
    const imported = applyRouteSnapshot(original, readRouteSnapshot(portableInput(), atlas), {}, route);
    const undone = undoRouteChange(imported);
    assert.deepEqual(undone.state, before);
    assert.deepEqual(undone.route, route);
});

test('selecting a calendar day returns that days map events and retains lower-bound dates', () => {
    const rows = [
        { placeId: 'a', place: 'Альфа', clock: { elapsedHours: 0 } },
        { placeId: 'b', place: 'Бета', clock: { elapsedHours: 24, incomplete: true } },
        { place: 'Не датировано', clock: null },
    ];
    assert.deepEqual(calendarSelection(rows, 1).map(row => row.placeId), ['a']);
    const selected = calendarSelection(rows, 2);
    assert.deepEqual(selected.map(row => row.placeId), ['b']);
    assert.equal(selected[0].clock.incomplete, true);
});

test('a corrected portable calendar retains successive days and uncertain multi-day travel after reload', () => {
    const input = portableInput();
    input.calendarStart = { display: 'sw-legends', swYear: 22, swDay: 6, approximate: true, cycleHours: 24,
        note: 'A cycle is24h in this game; several days have no specified upper bound.' };
    input.calendar.rows = [0, 24, 48, 97].map((hours, offset) => {
        const clock = { elapsedHours: hours, gameDay: Math.floor(hours / 24) + 1, hourKnown: false,
            approximate: true, incomplete: offset > 0, period: offset === 3 ? 'evening' : null };
        clock.label = formatCalendar(clock, input.calendarStart);
        return { place: 'Альфа', source: `Сцена${offset}`, offset, clock };
    });
    input.calendar.now = input.calendar.rows.at(-1).clock;
    const parsed = readRouteSnapshot(input, atlas);
    const context = { chat: [{ is_user: false, mes: 'Ты прибыл на Альфу.' }] }, local = history([]);
    const saved = applyRouteSnapshot({}, parsed, snapshotBinding(context, local, parsed.boundary), []);
    const reloaded = JSON.parse(JSON.stringify(saved));
    const calendar = snapshotHistory(reloaded.importedSnapshot, context, local, atlas, resolveCalendar).calendar;
    assert.deepEqual(calendar.rows.map(row => Math.floor(row.clock.elapsedHours / 24) + 1), [1, 2, 3, 5]);
    assert.equal(calendar.now.incomplete, true); assert.equal(calendar.now.hourKnown, false);
    assert.equal(reloaded.importedSnapshot.calendarStart.cycleHours, 24);
    const wm = resolveCalendar([], { worldAtlas: { tracking: { example: reloaded } } }, undefined, context.chat);
    assert.deepEqual(wm.rows, calendar.rows); assert.equal(wm.now.label, calendar.now.label);
});

test('a private game world becomes a labelled approximate point and undo restores the prior map', () => {
    const base = { ...atlas, width: 1000, height: 1000, context: { points: [{ name: 'Опорный сектор', x: 500, y: 500 }] } };
    const input = portableInput();
    input.gamePlaces = [{ id: 'game:gamma', name: 'Гамма', anchorNames: ['Опорный сектор'], source: 'Открытая сцена',
        mapNote: 'Только область сектора; точная система не установлена.' }];
    input.events = [{ placeId: 'game:gamma', placeName: 'Гамма', status: 'arrived', source: 'Сцена', offset: 0 }];
    const original = { events: [], manual: true }, parsed = readRouteSnapshot(input, base);
    const imported = applyRouteSnapshot(original, parsed, {}, ['a']);
    const displayed = withGamePlaces(base, imported.importedSnapshot.gamePlaces);
    const point = displayed.places.find(place => place.id === 'game:gamma');
    assert.equal(point.gamePlace, true); assert.equal(point.gamePlacement, 'sector');
    assert.match(point.mapNote, /не координаты/); assert.equal(parsed.events[0].placeId, point.id);
    assert.equal(base.places.some(place => place.gamePlace), false);
    const undone = undoRouteChange(imported);
    assert.deepEqual(undone.state, original); assert.deepEqual(undone.route, ['a']);
    assert.deepEqual(withGamePlaces(base, undone.state.importedSnapshot?.gamePlaces), base);
});
