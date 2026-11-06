import { dateValue, findPlace, revision, liveEvents } from './history-route.js';

// A portable baseline, followed only by non-overlapping, source-bound new L0.
export function readRouteSnapshot(value, atlas) {
    let input;
    try { input = typeof value === 'string' ? JSON.parse(value.replace(/^\uFEFF/, '')) : value; }
    catch { throw new Error('Не удалось прочитать JSON маршрута. Выберите короткий файл WorldAtlas, не полный экспорт игры.'); }
    if (input?.format !== 'world-atlas-route' || input.version !== 1)
        throw new Error('Это не файл маршрута WorldAtlas (world-atlas-route, версия 1). Игра не изменена.');
    if (input.atlasId !== atlas.id) throw new Error('Файл предназначен для другой карты. Сначала откройте нужную карту.');
    const coverage = input.coverage;
    if (!Number.isInteger(coverage?.throughMessage) || coverage.throughMessage < 1
        || !Number.isInteger(coverage.messageCount) || coverage.messageCount < coverage.throughMessage)
        throw new Error('В файле нет корректного среза истории. Игра не изменена.');
    if (!Array.isArray(input.events) || !input.events.length || input.events.length > 2000
        || !Array.isArray(input.calendar?.rows) || input.calendar.rows.length > 4000)
        throw new Error('В файле нет допустимого списка событий и календаря.');
    const text = (value, limit = 2000) => {
        if (typeof value !== 'string') return '';
        if (value.length > limit) throw new Error(`Поле файла длиннее ${limit} символов. Данные не обрезались; прежний маршрут сохранён.`);
        return value;
    };
    const clock = value => {
        if (!text(value?.label)) throw new Error('В файле отсутствует подпись игровой даты.');
        return { label: text(value.label), ...(Number.isFinite(value.elapsedHours) ? { elapsedHours: value.elapsedHours } : {}),
            incomplete: Boolean(value.incomplete), approximate: Boolean(value.approximate), hourKnown: value.hourKnown !== false };
    };
    const events = input.events.map((event, index) => {
        if (!text(event.placeName, 300).trim() || !['arrived', 'departed'].includes(event.status))
            throw new Error(`Некорректное место или перемещение в событии ${index + 1}.`);
        const place = findPlace(event.placeId, atlas) || findPlace(event.placeName, atlas);
        return { id: `import:${index}`, placeId: place?.id || null, placeHint: text(event.placeId, 100), placeName: text(event.placeName, 300), status: event.status,
            source: text(event.source, 100) || 'импортированный срез', offset: Number.isInteger(event.offset) ? event.offset : index,
            index, date: dateValue(event.date), method: 'import', quote: 'Переносимый снимок маршрута; оригиналы и L0 не импортировались.' };
    });
    const rows = input.calendar.rows.map(row => ({ place: row.place === null ? null : text(row.place, 300),
        source: text(row.source, 100), offset: Number.isInteger(row.offset) ? row.offset : -1,
        date: dateValue(row.date), status: row.status === 'departed' ? 'departed' : 'arrived', clock: clock(row.clock) }));
    const anchor = input.calendarStart || {};
    const calendarStart = { label: text(anchor.label, 300), approximate: Boolean(anchor.approximate),
        display: anchor.display === 'sw-legends' ? 'sw-legends' : 'game' };
    for (const key of ['offsetDays', 'swYear', 'swDay']) if (Number.isFinite(anchor[key])) calendarStart[key] = anchor[key];
    if (input.boundary?.length > 5) throw new Error('В файле слишком много опорных сообщений. Прежний маршрут сохранён.');
    const boundary = Array.isArray(input.boundary) ? input.boundary.map(value => text(value, 100)) : [];
    return { format: input.format, version: 1, atlasId: atlas.id, calendarStart, boundary,
        coverage: { throughMessage: coverage.throughMessage, messageCount: coverage.messageCount,
            tailMessages: coverage.messageCount - coverage.throughMessage }, events,
        calendar: { rows, now: clock(input.calendar.now) } };
}

export function snapshotBinding(context, history) {
    return { chat: revision(JSON.stringify((context.chat || []).map(message => [Boolean(message.is_user), Boolean(message.is_system), message.mes]))),
        history: revision(JSON.stringify(history.evidence.map(source => [source.id, source.revision, source.through]))) };
}

export const messageRevision = message => revision(`${Boolean(message.is_user)}:${String(message.mes || '').replace(/\r\n/g, '\n').trim()}`);
export function resolveImportedPlaces(events, atlas) {
    return events.map(event => ({ ...event, placeId: (findPlace(event.placeId || event.placeHint, atlas) || findPlace(event.placeName, atlas))?.id || null }));
}

export function snapshotHistory(snapshot, context, local, atlas, resolver, savedEvents = []) {
    const changed = JSON.stringify(snapshot.binding) !== JSON.stringify(snapshotBinding(context, local));
    const hashes = (context.chat || []).map(messageRevision), matches = [];
    for (let end = snapshot.boundary.length - 1; snapshot.boundary.length && end < hashes.length; end++)
        if (snapshot.boundary.every((value, i) => hashes[end - snapshot.boundary.length + 1 + i] === value)) matches.push(end);
    const boundary = matches.length === 1 ? matches[0] : null;
    const fresh = boundary === null ? [] : local.evidence.filter(source => source.index > boundary);
    const oldEvents = resolveImportedPlaces(snapshot.events, atlas);
    const extraEvents = liveEvents(savedEvents, { evidence: fresh }, atlas);
    let calendar = snapshot.calendar, blocked = boundary === null ? 'граница среза не найдена однозначно в открытом чате' : '';
    if (boundary !== null && local.through > boundary && !fresh.length)
        blocked = 'новый L0 перекрывает границу импорта; его часть не добавлена, чтобы не дублировать время и события';
    if (fresh.length) {
        if (resolver && Number.isFinite(snapshot.calendar.now.elapsedHours)) {
            const base = snapshot.calendar.now;
            const seed = (id, order, elapsedHours) => ({ id, text: 'imported clock seed', textRevision: id, order, orderKnown: true,
                timeline: { textRevision: id, elapsedHours, timePrecision: base.approximate ? 'approximate' : 'exact', locations: [] } });
            const packets = [seed('import-baseline', -2, base.elapsedHours)];
            if (base.incomplete || !base.hourKnown) packets.push(seed('import-uncertainty', -1, null));
            packets.push(...fresh.map(source => {
                const info = source.timeline || source.timing;
                return { id: source.id.replace(/^l0:/, ''), text: source.text, textRevision: source.id,
                    order: source.index, orderKnown: true, timeline: info ? { ...info, textRevision: source.id,
                        locations: extraEvents.filter(event => event.source === source.id) } : undefined };
            }));
            const continuation = resolver(packets, {}, snapshot.calendarStart);
            calendar = { rows: [...snapshot.calendar.rows, ...continuation.rows.filter(row => !row.source.startsWith('l0:import-'))], now: continuation.now };
        } else blocked = 'места новых L0 добавлены; расчёт новой даты недоступен, показана дата импортированного среза';
    }
    return { ...local, sources: [], evidence: [], calendar, imported: true, importChanged: changed, importBlocked: blocked,
        importExtended: fresh.length, importBoundaryMissing: boundary === null, importEvents: [...oldEvents, ...extraEvents],
        coverage: snapshot.coverage, through: snapshot.coverage.throughMessage - 1,
        localThrough: fresh.length ? Math.max(...fresh.map(source => source.through)) : null,
        tailMessages: fresh.length ? local.tailMessages : snapshot.coverage.tailMessages, signature: 'portable-import' };
}

export function applyRouteSnapshot(state, snapshot, binding, previousRoute) {
    const { previous: _previous, ...saved } = state;
    return { ...saved, manual: false, importedSnapshot: { ...snapshot, binding },
        previous: { ...structuredClone(state), route: structuredClone(previousRoute) } };
}

export function undoRouteChange(state) {
    if (!state.previous) return null;
    const { route, ...saved } = structuredClone(state.previous);
    if (!state.importedSnapshot && !saved.importedSnapshot) saved.manual = true;
    return { state: saved, route };
}
