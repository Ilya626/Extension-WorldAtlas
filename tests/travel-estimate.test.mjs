import test from 'node:test';
import assert from 'node:assert/strict';
import { travelRegion, estimateTravel, travelDeparture, projectedArrival, travelPhrase } from '../travel-estimate.js';
import { formatCalendar } from '../../Extension-WorldMemory/timeline-calendar.js';
import { readRouteSnapshot } from '../route-import.js';

test('current or selected endpoints, drive class and arrival phrase leave played history unchanged', () => {
    const atlas = { id: 'example', places: [{ id: 'a', name: 'Alpha', aliases: ['Anchor'], region: 'Внешнее Кольцо' },
        { id: 'b', name: 'Beta', region: 'Ядро' }, { id: 'c', name: 'Gamma', region: 'Среднее Кольцо' }] };
    const current = { id: 'game:current', name: 'Current', gamePlace: true, anchorNames: ['Anchor'] };
    const state = { route: [current.id], events: [{ placeId: current.id, status: 'arrived' }],
        now: { elapsedHours: 108, gameDay: 5, hour: 12, minute: 0, hourKnown: true, incomplete: false } };
    const before = structuredClone(state);
    const origin = travelRegion(current, atlas), target = travelRegion(atlas.places[1], atlas);
    const imported = readRouteSnapshot({ format: 'world-atlas-route', version: 1, atlasId: atlas.id,
        coverage: { throughMessage: 1, messageCount: 1 }, events: [{ placeName: 'Beta', placeId: 'b', status: 'arrived' }],
        calendar: { rows: [], now: { label: 'Day 5', elapsedHours: 108 } }, travelDefaults: { hyperdriveClass: 2 } }, atlas);
    assert.equal(JSON.parse(JSON.stringify(imported)).travelDefaults.hyperdriveClass, 2);
    const estimate = estimateTravel(origin.id, target.id, imported.travelDefaults.hyperdriveClass);
    assert.equal(estimate.hours, 192);
    assert.equal(estimateTravel(origin.id, target.id, 0.75).hours, 72);
    assert.equal(estimateTravel(origin.id, target.id, 12).hours, 1152);
    const arrival = projectedArrival(state.now, estimate.hours);
    assert.equal(arrival.gameDay, 13); assert.equal(arrival.hour, 12);
    const phrase = travelPhrase(current.name, 'Beta', estimate, formatCalendar(arrival));
    assert.match(phrase, /192 ч/); assert.match(phrase, /класс 2/); assert.match(phrase, /День 13/);
    const selected = estimateTravel(target.id, travelRegion(atlas.places[2], atlas).id, 0.5);
    assert.equal(selected.hours, 42);
    assert.deepEqual(state, before);
});

test('unknown regions and retrospective estimates retain uncertainty and explicit played timestamps', () => {
    const unknown = travelRegion({ name: 'Unlocated', gamePlace: true }, { places: [] });
    assert.equal(unknown.id, null); assert.equal(unknown.approximate, true);
    assert.equal(estimateTravel(unknown.id, 'core', 1), null);
    const played = Object.freeze({ elapsedHours: 195, gameDay: 9, hour: 3, minute: 0, hourKnown: true, incomplete: false });
    const legacy = Object.freeze({ elapsedHours: 97, incomplete: true });
    const unchanged = travelDeparture(legacy, { day: '5', time: '' });
    assert.equal(unchanged.elapsedHours, 97); assert.equal(unchanged.hourKnown, false);
    assert.equal(projectedArrival(unchanged, 6).elapsedHours, 103);
    const oldDeparture = Object.freeze({ elapsedHours: 24, hourKnown: false, incomplete: true });
    const estimate = estimateTravel('outer-rim', 'core', 1);
    const arrival = projectedArrival(oldDeparture, estimate.hours);
    assert.equal(arrival.approximate, true); assert.equal(arrival.incomplete, true); assert.equal(arrival.hourKnown, false);
    assert.match(formatCalendar(arrival), /^Не ранее: ≈ /);
    assert.equal(oldDeparture.elapsedHours, 24); assert.equal(played.elapsedHours, 195);
    assert.equal(played.hour, 3); assert.equal(played.incomplete, false);
});
