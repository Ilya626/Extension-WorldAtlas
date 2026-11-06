import test from 'node:test';
import assert from 'node:assert/strict';
import { collectHistory, liveEvents, eventRoute, requestRoute, calendarRows } from '../history-route.js';
import { hash } from '../../Extension-WorldMemory/history.js';
import { createArchive, readArchive } from '../../Extension-WorldMemory/archive-store.js';
import { installArchiveRuntime } from '../../Extension-WorldMemory/archive-runtime.js';
import { resolveCalendar } from '../../Extension-WorldMemory/timeline-calendar.js';
import { readRouteSnapshot, snapshotBinding, snapshotHistory, applyRouteSnapshot, undoRouteChange, messageRevision } from '../route-import.js';

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
