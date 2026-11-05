import test from 'node:test';
import assert from 'node:assert/strict';
import { collectHistory, liveEvents, eventRoute, requestRoute, calendarRows } from '../history-route.js';
import { hash } from '../../Extension-WorldMemory/history.js';
import { createArchive, readArchive } from '../../Extension-WorldMemory/archive-store.js';
import { installArchiveRuntime } from '../../Extension-WorldMemory/archive-runtime.js';

const atlas = { id: 'example', places: [{ id: 'a', name: 'Альфа', aliases: ['Alpha'] }, { id: 'b', name: 'Бета', aliases: ['Beta'] }] };
const history = packets => collectHistory({ name1: 'Player' }, atlas, { packets });
const unknown = { text: null, precision: 'unknown' };
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
