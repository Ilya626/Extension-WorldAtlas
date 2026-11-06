// Private, per-chat game geography stays separate from the installed atlas pack.
export function readGamePlaces(input = []) {
    if (!Array.isArray(input) || input.length > 100) throw new Error('Допустимо до 100 игровых мест.');
    const text = (value, limit, required = false) => {
        if (typeof value !== 'string' || value.length > limit || (required && !value.trim())) throw new Error('Некорректное описание игрового места. Данные не изменены.');
        return value.trim();
    };
    const ids = new Set();
    return input.map(place => {
        const id = text(place.id, 100, true);
        if (!id.startsWith('game:') || ids.has(id)) throw new Error('Игровым местам нужны уникальные id с префиксом game:.');
        ids.add(id);
        const names = (values, max) => {
            if (!Array.isArray(values) || values.length > max) throw new Error('Некорректный список названий игрового места.');
            return values.map(value => text(value, 300, true));
        };
        return { id, name: text(place.name, 300, true), aliases: names(place.aliases || [], 20),
            region: text(place.region || 'Игровой мир', 300), shortText: text(place.shortText || '', 2000),
            source: text(place.source || '', 300), mapNote: text(place.mapNote || '', 1000),
            anchorNames: names(place.anchorNames || [], 10) };
    });
}
const fold = value => String(value).normalize('NFKC').toLowerCase().replaceAll('ё', 'е').trim();
export function withGamePlaces(atlas, places = []) {
    if (!places.length) return atlas;
    const candidates = [...atlas.places.filter(place => !place.gamePlace), ...(atlas.context?.points || [])];
    const extra = places.map((place, index) => {
        const anchor = place.anchorNames.map(name => candidates.find(candidate =>
            [candidate.id, candidate.name, ...(candidate.aliases || [])].some(alias => fold(alias) === fold(name)))).find(Boolean);
        const located = Boolean(anchor && !atlas.schematic);
        return { ...place, gamePlace: true, gamePlacement: atlas.schematic ? 'catalog' : located ? 'sector' : 'unlocated',
            ...(atlas.schematic ? { x: 220 + (index % 6) * 230, y: 1500 } : located ? {
                x: Math.min(atlas.width - 10, Math.max(10, anchor.x + atlas.width * .018)),
                y: Math.min(atlas.height - 10, Math.max(10, anchor.y - atlas.height * .012)),
                gameAnchor: { x: anchor.x, y: anchor.y, name: anchor.name } } : {}),
            imageColor: '#e4b973', image: 'assets/landscape-card.svg', labelPriority: 0,
            continuityNote: 'Игровая география этого чата. Каноническая точка и точный гипермаршрут не установлены.',
            mapNote: `${place.mapNote}${located ? ` Условная отметка у ориентира «${anchor.name}»; это не координаты системы.` : atlas.schematic ? ' Позиция на сетке каталога условная.' : ' Координат нет: карточка доступна в игровых местах и поиске.'}` };
    });
    return { ...atlas, places: [...atlas.places.filter(place => !place.gamePlace), ...extra] };
}
