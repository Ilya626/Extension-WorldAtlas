async function readLocalJson(path, base) {
    const url = new URL(path, base);
    if (url.origin !== location.origin) throw new Error('Пакет карты должен находиться на этом ST-сервере.');
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Не удалось загрузить ${path} (${response.status}).`);
    return response.json();
}

const fold = value => String(value).normalize('NFKC').toLocaleLowerCase('ru').replaceAll('ё', 'е').trim();
function sourcePlace(atlas, point) {
    return { ...point, sourcePlace: true, sourcePointId: point.id, aliases: point.aliases || [],
        shortText: 'Точка загруженного справочного геослоя. Развёрнутая карточка мира пока не добавлена.',
        image: atlas.defaultPlaceImage || 'assets/landscape-card.svg', imageColor: '#b4bcc8',
        mapNote: atlas.coordinateNote || 'Координаты и гиперлинии из загруженной карты; доступность маршрута в эпоху игры не подтверждена.' };
}
// Search the whole loaded source, while only selected source worlds become pins.
export function searchAtlasPlaces(atlas, query) {
    const ids = new Set(atlas.places.map(place => place.sourcePointId).filter(Boolean));
    const candidates = [...atlas.places];
    for (const point of atlas.context?.points || []) {
        if (ids.has(point.id) || !String(point.name || '').trim()) continue;
        candidates.push(sourcePlace(atlas, point));
        ids.add(point.id);
    }
    const needle = fold(query);
    return candidates.filter(place => [place.name, ...(place.aliases || [])].some(name => fold(name).includes(needle)));
}
export function activateSourcePlace(atlas, id) {
    const point = atlas.context?.points?.find(point => point.id === id);
    if (!point || atlas.places.some(place => place.id === id || place.sourcePointId === id)) return atlas;
    return { ...atlas, activeSourcePointIds: [...new Set([...(atlas.activeSourcePointIds || []), id])],
        places: [...atlas.places, sourcePlace(atlas, point)] };
}
// Visible per-chat pins created by an event link are not new name aliases for
// automatic chronology. Keep them searchable without resolving other episodes.
export function withBoundSourcePlaces(atlas, ids = []) {
    const existing = new Set(atlas.places.map(place => place.id));
    const expanded = ids.reduce(activateSourcePlace, atlas);
    if (expanded === atlas) return atlas;
    return { ...expanded, places: expanded.places.map(place => existing.has(place.id) ? place : { ...place, bindingOnly: true }) };
}

// Data references keep the reader independent of any particular fictional world.
export async function loadAtlas(input, base) {
    const atlas = structuredClone(input);
    if (atlas.contextFile) atlas.context = await readLocalJson(atlas.contextFile, base);
    if (atlas.cardsFile) {
        const cards = await readLocalJson(atlas.cardsFile, base);
        atlas.places = cards.places;
    }
    const points = new Map();
    for (const point of atlas.context?.points ?? []) if (!points.has(point.name)) points.set(point.name, point);
    atlas.places = (atlas.places ?? []).map((place, index) => {
        const sourceId = place.sourcePointId || (place.sourceFeatureId !== undefined ? `source-${place.sourceFeatureId}` : null);
        const source = sourceId
            ? atlas.context?.points?.find(point => point.id === sourceId)
            : (place.sourceName ? points.get(place.sourceName) : null);
        if (place.sourceName && !source && !atlas.schematic) throw new Error(`Нет координат для ${place.sourceName}.`);
        return {
            ...place,
            ...(source ? { x: source.x, y: source.y, sourcePointId: source.id } : {}),
            ...(atlas.schematic ? { x: 220 + (index % 6) * 230, y: 230 + Math.floor(index / 6) * 260 } : {}),
            image: place.image || atlas.imageKinds?.[place.imageKind] || atlas.defaultPlaceImage,
        };
    });
    // cardsFile reloads the shipped catalogue; restore selected source worlds after it.
    return (atlas.activeSourcePointIds || []).reduce(activateSourcePlace, atlas);
}

export async function loadReferenceAtlas(base) {
    const { downloadReference } = await import('./reference-geometry.js');
    const atlas = await readLocalJson('data/star-wars-22bby.json', base);
    delete atlas.schematic;
    atlas.context = await downloadReference();
    atlas.coordinateSpace = 'reference-cartography-pixels-top-left';
    atlas.initialView.fit = 'cover';
    atlas.title = 'Галактика · 30 миров';
    atlas.descriptionShort = '30 карточек · 2436 фоновых миров · справочные гиперлинии';
    atlas.coordinateNote = 'Геослой отдельно загружен из iSkore / Henry Bernberg / CARTO. Смешанная хронология; не проверенная сеть22ДБЯ. Права на исходную картографию не подтверждены; WorldAtlas её не распространяет.';
    return loadAtlas(atlas, base);
}

export async function loadDefaultAtlas(base) {
    return loadAtlas(await readLocalJson('data/star-wars-22bby.json', base), base);
}
