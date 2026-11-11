import test from 'node:test';
import assert from 'node:assert/strict';
import { identifyPlaceEvents, applyPlaceBindings, changePlaceBinding, currentEventPlace, placeCalendarRows } from '../place-binding.js';
import { eventRoute, liveEvents, findPlace } from '../history-route.js';
import { withBoundSourcePlaces, searchAtlasPlaces } from '../atlas-data.js';

const atlas = { places: [{ id: 'a', name: 'Alpha', x: 1, y: 1 }, { id: 'b', name: 'Beta', x: 2, y: 2 }] };
const text = 'At dawn you reached the first port. At dusk you reached the second port.';
const history = { evidence: [{ id: 'l0:one', text, originals: [{ id: 'message-1', text }] }] };
const raw = [
    { source: 'l0:one', sourceIds: ['message-1'], offset: 0, quote: 'At dawn you reached the first port.', placeName: 'Первый порт', placeId: null, status: 'arrived', date: { text: 'утром' } },
    { source: 'l0:one', sourceIds: ['message-1'], offset: 1, quote: 'At dusk you reached the second port.', placeName: 'Второй порт', placeId: 'b', status: 'arrived', date: { text: 'вечером' } },
];
const identified = () => identifyPlaceEvents(structuredClone(raw), history);

test('manual place survives reload and a model rerank with overlapping evidence, but not a source edit or another episode', () => {
    const before = JSON.stringify({ raw, history });
    const events = identified(), state = changePlaceBinding({}, events[0], 'a');
    const reloaded = JSON.parse(JSON.stringify(state));
    assert.equal(applyPlaceBindings(identified(), reloaded.placeBindings, atlas)[0].placeId, 'a');
    const reranked = identifyPlaceEvents([{ ...raw[0], offset: 99, placeId: 'b', date: { text: 'corrected date' }, quote: 'you reached the first port.' }, raw[1]], history);
    const bound = applyPlaceBindings(reranked, reloaded.placeBindings, atlas);
    assert.equal(bound[0].placeId, 'a');
    assert.equal(bound[0].date.text, 'corrected date');
    assert.equal(bound[1].manualPlace, undefined);
    const edited = { evidence: [{ ...history.evidence[0], text: text.replace('first port', 'different port') }] };
    assert.equal(applyPlaceBindings(identifyPlaceEvents(raw, edited), reloaded.placeBindings, atlas)[0].manualPlace, undefined);
    const different = identifyPlaceEvents([{ ...raw[1], offset: 0 }], history);
    assert.equal(applyPlaceBindings(different, reloaded.placeBindings, atlas)[0].manualPlace, undefined);
    assert.equal(JSON.stringify({ raw, history }), before);
    assert.ok(JSON.stringify(state).length < 450);
});

test('change, remove and undo affect one calendar link and preserve original dates, text and sources', () => {
    const events = identified(), original = JSON.stringify(events);
    const first = changePlaceBinding({}, events[0], 'a');
    const second = changePlaceBinding(first, events[1], 'a');
    const changed = changePlaceBinding(second, events[0], 'b');
    const removed = changePlaceBinding(changed, events[0], null);
    const undone = changePlaceBinding(removed, events[0], changed.placeBindings[events[0].bindingKey].placeId);
    assert.deepEqual(undone, changed);
    assert.deepEqual(removed.placeBindings[events[1].bindingKey], second.placeBindings[events[1].bindingKey]);
    const linked = applyPlaceBindings(events, changed.placeBindings, atlas);
    // Native imported calendars can filter locations and renumber their rows.
    const rows = raw.map((event, index) => ({ ...event, offset: index + 99, place: event.placeName, clock: { label: 'unknown day' } }));
    const calendar = placeCalendarRows(rows, linked, history, changed.placeBindings, atlas);
    assert.equal(calendar[0].place, 'Первый порт');
    assert.equal(calendar[0].boundPlaceName, 'Beta');
    assert.equal(calendar[0].manualPlace, true);
    assert.deepEqual(calendar[0].date, raw[0].date);
    assert.equal(calendar[0].source, raw[0].source);
    assert.equal(JSON.stringify(events), original);
});

test('a historical correction preserves current arrival; latest arrival correction refines it without adding travel', () => {
    const events = identified();
    const historical = changePlaceBinding({}, events[0], 'a');
    const first = applyPlaceBindings(events, historical.placeBindings, atlas);
    assert.equal(currentEventPlace(first), 'b');
    assert.deepEqual(eventRoute(first), ['a', 'b']);
    const latest = changePlaceBinding(historical, events[1], 'a');
    const second = applyPlaceBindings(events, latest.placeBindings, atlas);
    assert.equal(currentEventPlace(second), 'a');
    assert.equal(second.length, events.length);
    assert.deepEqual(second.map(event => [event.status, event.source, event.date]), events.map(event => [event.status, event.source, event.date]));
    assert.equal(currentEventPlace([{ ...second[1], status: 'departed' }]), null);
    assert.equal(currentEventPlace([{ ...second[1], boundaryUncertain: true }]), null);

    const base = { id: 'same-name', places: atlas.places, context: { points: [{ id: 'source-490', name: 'Andooweel', x: 3, y: 3 }] } };
    const expanded = withBoundSourcePlaces(base, ['source-490']);
    const sameNameHistory = { evidence: ['old', 'latest'].map((id, index) => ({ id, index, text: `Arrival ${id}`, revision: id, sourceIds: [id],
        timeline: { locations: [{ place: 'Andooweel', quote: `Arrival ${id}`, status: 'arrived', sourceIds: [id] }] } })) };
    const sameNameEvents = identifyPlaceEvents(liveEvents([], sameNameHistory, expanded), sameNameHistory);
    const historicalLink = changePlaceBinding({}, sameNameEvents[0], 'source-490', 'source-490');
    const boundSameName = applyPlaceBindings(sameNameEvents, historicalLink.placeBindings, expanded);
    assert.equal(boundSameName[0].placeId, 'source-490');
    assert.equal(boundSameName[1].placeId, null);
    assert.equal(currentEventPlace(boundSameName), null);
    assert.equal(findPlace('Andooweel', expanded), undefined);
    assert.equal(searchAtlasPlaces(expanded, 'Andooweel')[0].id, 'source-490');
    const unlinked = changePlaceBinding(historicalLink, sameNameEvents[0], null);
    assert.deepEqual(unlinked.boundSourcePointIds, ['source-490']);
    assert.equal(currentEventPlace(applyPlaceBindings(sameNameEvents, unlinked.placeBindings, expanded)), null);
});
