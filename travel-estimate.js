// SW5e gaming scale, not canonical travel times or a conversion from map pixels.
export const TRAVEL_SOURCE = 'https://sw5e.com/rules/sotg/adventuring';
export const TRAVEL_REGIONS = [
    ['deep-core', 'Глубокое Ядро'], ['core', 'Ядро'], ['colonies', 'Колонии'],
    ['inner-rim', 'Внутреннее Кольцо'], ['expansion', 'Регион Экспансии'],
    ['mid-rim', 'Среднее Кольцо'], ['outer-rim', 'Внешнее Кольцо'],
    ['wild-space', 'Дикий космос'], ['unknown-regions', 'Неизведанные Регионы'],
];
// Rows are origins, columns destinations. Preserve the source's asymmetry.
const hours = [
    [12, 18, 24, 48, 72, 96, 120, 144, 168],
    [24, 6, 24, 36, 60, 84, 96, 120, 144],
    [48, 24, 12, 24, 48, 72, 96, 120, 96],
    [72, 36, 24, 18, 24, 48, 72, 96, 72],
    [96, 60, 48, 24, 24, 24, 48, 72, 96],
    [120, 84, 72, 48, 24, 36, 24, 48, 72],
    [144, 96, 96, 72, 48, 24, 48, 24, 60],
    [168, 120, 120, 96, 72, 48, 24, 12, 120],
    [192, 144, 96, 72, 60, 72, 96, 120, 48],
];
const fold = value => String(value || '').normalize('NFKC').toLowerCase().replaceAll('ё', 'е').trim();
const regionId = value => TRAVEL_REGIONS.find(([id, name]) => fold(id) === fold(value) || fold(name) === fold(value))?.[0] || null;

export function travelRegion(place, atlas) {
    const direct = regionId(place?.region);
    if (direct) return { id: direct, approximate: Boolean(place.gamePlace), basis: place.gamePlace ? 'Регион игровой точки' : 'Регион из карточки' };
    if (place?.gamePlace) {
        for (const name of [place.gameAnchor?.name, ...(place.anchorNames || [])].filter(Boolean)) {
            const reference = atlas.places.find(candidate => !candidate.gamePlace &&
                [candidate.id, candidate.name, candidate.sourceName, ...(candidate.aliases || [])].some(alias => fold(alias) === fold(name)));
            const id = regionId(reference?.region);
            if (id) return { id, approximate: true, basis: `Предположение по ориентиру «${reference.name}»` };
        }
    }
    return { id: null, approximate: true, basis: 'Регион не установлен — выберите вручную' };
}

export function estimateTravel(fromRegion, toRegion, hyperdrive) {
    const from = TRAVEL_REGIONS.findIndex(([id]) => id === fromRegion), to = TRAVEL_REGIONS.findIndex(([id]) => id === toRegion);
    if (from < 0 || to < 0 || !Number.isFinite(hyperdrive) || hyperdrive <= 0) return null;
    return { baseHours: hours[from][to], hours: hours[from][to] * hyperdrive, hyperdrive };
}

export function travelDeparture(now, { day, time, edited = false }) {
    // Keep the accumulated clock, including partial days, until explicitly edited.
    // A legacy clock without hourKnown does not establish a time of day.
    if (!edited && Number.isFinite(now?.elapsedHours)) return { ...now, hourKnown: now.hourKnown === true };
    const dayNumber = Number(day);
    if (!String(day).trim() || !Number.isInteger(dayNumber) || dayNumber < 1) return null;
    const [hour, minute] = time ? time.split(':').map(Number) : [0, 0];
    return { ...now, elapsedHours: (dayNumber - 1) * 24 + hour + minute / 60, hourKnown: Boolean(time), period: null };
}

export function projectedArrival(departure, duration) {
    if (!Number.isFinite(departure?.elapsedHours) || !Number.isFinite(duration) || duration < 0) return null;
    const total = departure.elapsedHours + duration;
    return { ...departure, elapsedHours: total, gameDay: Math.floor(total / 24) + 1,
        hour: Math.floor(total % 24), minute: Math.floor((total * 60) % 60),
        approximate: true, incomplete: Boolean(departure.incomplete || departure.hourKnown === false), period: null };
}

export function travelPhrase(from, to, estimate, arrival) {
    return `Планирую перелёт ${from} → ${to}. Ориентир по игровой шкале SW5e: ≈ ${estimate.hours} ч (база ${estimate.baseHours} ч × класс ${estimate.hyperdrive}).${arrival ? ` Ожидаемое прибытие: ${arrival}.` : ''} Прошу мастера подтвердить срок; это план, не уже сыгранное событие.`;
}
