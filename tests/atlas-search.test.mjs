import test from 'node:test';
import assert from 'node:assert/strict';
import { activateSourcePlace, loadAtlas, searchAtlasPlaces } from '../atlas-data.js';
import { AtlasView, validateAtlas } from '../viewer.js';
import { withGamePlaces } from '../game-places.js';
import { createRouteNetwork, sourcePathsAt } from '../route-network.js';

function fixture() {
    const places = Array.from({ length: 30 }, (_, i) => ({ id: `card-${i}`, name: `World ${i}`,
        shortText: 'Existing card', x: i + 1, y: 10, sourcePointId: `point-${i}` }));
    return { id: 'example', title: 'Example', width: 100, height: 100, places,
        context: { points: [...places.map(p => ({ id: p.sourcePointId, name: p.name, x: p.x, y: p.y })),
            { id: 'point-extra', name: 'Extra World', aliases: ['Extra alias'], region: 'Core', x: 40, y: 10 }],
        paths: [{ id: 'source-line', name: 'Source line', points: [[1, 10], [40, 10]] }] } };
}

test('search outside the thirty cards activates the source world on its existing hyperspace lines', () => {
    const atlas = fixture(), before = structuredClone(atlas);
    const [match] = searchAtlasPlaces(atlas, 'extra ALIAS');
    assert.equal(match.id, 'point-extra'); assert.equal(match.sourcePlace, true);
    const active = activateSourcePlace(atlas, match.sourcePointId);
    assert.equal(active.places.length, 31); assert.equal(atlas.places.length, 30);
    assert.deepEqual(atlas, before); assert.equal(active.context, atlas.context);
    assert.deepEqual(active.places.at(-1), match);
    assert.deepEqual(sourcePathsAt(active.context.paths, match), active.context.paths);
    const path = createRouteNetwork(active.context.paths, active.places).resolve('card-0', match.id);
    assert.equal(path.gap, false); assert.ok(path.segments.length > 0);
    assert.ok(path.segments.every(segment => segment.name === 'Source line'));
    assert.equal(searchAtlasPlaces(active, 'extra world').length, 1);
});

test('selected source worlds survive catalogue reload and game-place composition without changing route or calendar', async () => {
    const base = fixture(), active = activateSourcePlace(base, 'point-extra');
    const state = { route: ['card-0', 'game:home'], current: 'game:home',
        calendar: [{ day: 8, elapsedHours: 192 }], events: [{ placeId: 'game:home', status: 'arrived' }] };
    const before = structuredClone(state);
    const game = [{ id: 'game:home', name: 'Home', aliases: [], anchorNames: ['World 0'] }];
    const fetchBefore = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ places: base.places }) });
    globalThis.location = { origin: 'http://localhost' };
    let reloaded;
    try {
        reloaded = validateAtlas(await loadAtlas(JSON.parse(JSON.stringify({ ...active, cardsFile: 'cards.json' })), new URL('http://localhost/')));
    } finally { globalThis.fetch = fetchBefore; delete globalThis.location; }
    const composed = withGamePlaces(reloaded, game);
    assert.equal(reloaded.places.length, 31); assert.equal(composed.places.length, 32);
    assert.equal(composed.places.filter(p => p.id === 'point-extra').length, 1);
    assert.deepEqual(composed.context.paths, base.context.paths);
    assert.deepEqual(composed.places.find(p => p.gamePlace), withGamePlaces(base, game).places.find(p => p.gamePlace));
    assert.equal(searchAtlasPlaces(composed, 'home')[0].id, 'game:home');
    // Exercise the actual viewer selection and its map-only persistence callback.
    const ui = { ...state, atlas: withGamePlaces(base, game), baseAtlas: base, gamePlaces: game,
        map: { getCenter: () => ({}), getZoom: () => 0 }, renderMap() { this.map.setView = () => {}; },
        onActivate(saved) { assert.equal(saved.places.length, 31); assert.ok(!saved.places.some(p => p.gamePlace)); },
        highlightSourcePaths: AtlasView.prototype.highlightSourcePaths,
        markers: new Map(), search: {}, results: {}, card: { replaceChildren() { throw stop; } } };
    const stop = new Error('selection reached the unchanged card renderer');
    assert.throws(() => AtlasView.prototype.select.call(ui, searchAtlasPlaces(ui.atlas, 'extra world')[0]), error => error === stop);
    assert.equal(ui.atlas.places.length, 32); assert.equal(ui.selected, 'point-extra');
    assert.deepEqual({ route: ui.route, current: ui.current, calendar: ui.calendar, events: ui.events }, before);
    assert.deepEqual(state, before);
});
