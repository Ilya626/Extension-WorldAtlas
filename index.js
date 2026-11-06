import { AtlasView } from './viewer.js';
import { loadAtlas, loadDefaultAtlas } from './atlas-data.js';
import { collectHistory, liveEvents, eventRoute, requestRoute, calendarRows, findPlace } from './history-route.js';
import { showHistoryPanel } from './history-panel.js';
import { showCalendar } from './calendar-view.js';
import { readRouteSnapshot, snapshotBinding, snapshotHistory, applyRouteSnapshot, undoRouteChange } from './route-import.js';

const OWNER = 'worldAtlas';
const base = new URL('.', import.meta.url);
const context = () => SillyTavern.getContext();
let view;
let pendingOpen;
let syncing;
let modelBusy = false;
let requestController;
let calendarResolver;
async function prepareImportedCalendar() {
    if (!globalThis.WorldMemory || calendarResolver) return;
    try { calendarResolver = (await import('/scripts/extensions/third-party/Extension-WorldMemory/timeline-calendar.js')).resolveCalendar; }
    catch (error) { console.warn('[World Atlas] Не удалось прочитать календарный модуль WorldMemory:', error.message); }
}

function settings() {
    return context().extensionSettings[OWNER] ??= {};
}
function route() {
    const ctx = context();
    if (!ctx.chatId) return [];
    return ctx.chatMetadata[OWNER]?.routes?.[view.atlas.id] ?? [];
}
async function saveRoute(points) {
    const ctx = context();
    if (!ctx.chatId) throw new Error('Откройте чат для сохранения линии.');
    const state = ctx.chatMetadata[OWNER] ??= { version: 1, routes: {} };
    state.routes ??= {};
    const tracked = tracking();
    checkpoint(tracked);
    state.routes[view.atlas.id] = structuredClone(points);
    tracked.manual = true;
    await ctx.saveMetadata();
}
function tracking() {
    const ctx = context();
    if (!ctx.chatId || !view) return { events: [] };
    const root = ctx.chatMetadata[OWNER] ??= { version: 2, routes: {} };
    root.tracking ??= {};
    return root.tracking[view.atlas.id] ??= { events: [], manual: route().length > 0 };
}
function checkpoint(state) {
    const { previous: _previous, ...saved } = state;
    state.previous = { ...structuredClone(saved), route: structuredClone(route()) };
}
function history() {
    const result = collectHistory(context(), view.atlas, globalThis.WorldMemory?.archive?.snapshot?.() || null);
    const timing = tracking().timing || {};
    for (const source of result.evidence) if (timing[source.id]?.revision === source.revision) source.timing = timing[source.id];
    const imported = tracking().importedSnapshot;
    if (imported) return snapshotHistory(imported, context(), result, view.atlas, calendarResolver, tracking().events);
    return result;
}
function events() {
    const current = history();
    return current.importEvents || liveEvents(tracking().events, current, view.atlas);
}
async function importRoute(file) {
    if (!context().chatId) throw new Error('Откройте чат для импорта маршрута и календаря.');
    if (modelBusy) throw new Error('Дождитесь обновления маршрута.');
    const ctx = context(), metadata = ctx.chatMetadata;
    if (file.size > 1024 * 1024) throw new Error('Короткий файл маршрута должен быть меньше 1 МБ. Полный экспорт игры здесь не нужен.');
    const imported = readRouteSnapshot(await file.text(), view.atlas);
    if (context().chatMetadata !== metadata || context().chatId !== ctx.chatId) throw new Error('Чат изменился. Выберите файл ещё раз в нужном чате.');
    const local = collectHistory(ctx, view.atlas, globalThis.WorldMemory?.archive?.snapshot?.() || null);
    const state = tracking(), next = applyRouteSnapshot(state, imported, snapshotBinding(ctx, local, imported.boundary), route());
    for (const key of Object.keys(state)) delete state[key];
    Object.assign(state, next);
    view.setGamePlaces(imported.gamePlaces);
    metadata[OWNER].routes ??= {};
    metadata[OWNER].routes[view.atlas.id] = eventRoute(imported.events);
    await ctx.saveMetadata(); view.contextChanged(); openHistory();
}
function connection() {
    const config = settings();
    const memory = context().extensionSettings.worldMemory;
    if (config.reuseMemory !== false) return { url: memory?.openaiUrl || '', model: memory?.openaiModel || '', key: memory?.openaiKey || '', reasoning: 'medium' };
    return { url: config.url || '', model: config.model || '', key: config.key || '', reasoning: 'medium' };
}
function positionLabel() {
    const state = tracking(), last = state.manual ? null : events().at(-1);
    const source = history();
    const label = source.imported ? `Импорт до ${source.coverage.throughMessage}${source.importExtended ? ` + L0 до ${source.localThrough + 1}` : ''}${state.manual ? ' · ручная отметка' : ''}`
        : state.manual ? 'Ручная отметка' : source.through >= 0 ? `По L0 до сообщения ${source.through + 1}` : 'По L0';
    if (last?.boundaryUncertain) return `${label}: ${last.placeName} · положение после границы импорта не подтверждено`;
    if (last?.status === 'departed') return `${label}: в пути · прибытие не установлено`;
    if (last && !last.placeId) return `${label}: ${last.placeName} · нет точки на карте`;
    const place = view.atlas.places.find(place => place.id === route().at(-1));
    return place ? `${label}: ${place.name}${place.gamePlace ? place.gamePlacement === 'unlocated' ? ' · игровой мир, координаты не заданы' : ' · игровая отметка, положение условное' : ''}` : `${label}: место неизвестно`;
}
function displayPoints() {
    const state = tracking();
    if (state.manual) return route().map(id => view.atlas.places.find(place => place.id === id)).filter(Boolean);
    const points = [];
    for (const event of events()) {
        if (event.status === 'departed') continue;
        const place = event.placeId && !event.boundaryUncertain ? view.atlas.places.find(place => place.id === event.placeId) : { id: null, name: event.placeName };
        if (place && (!place.id || points.at(-1)?.id !== place.id)) points.push(place);
    }
    return points;
}
function currentPlaceId() {
    const state = tracking();
    if (state.manual) return route().at(-1);
    if (state.importedSnapshot && history().importBoundaryMissing) return null;
    const last = events().at(-1);
    return last?.status === 'departed' || last?.boundaryUncertain ? null : last?.placeId || null;
}
async function syncHistory() {
    if (!view || !context().chatId || (settings().auto === false && !tracking().importedSnapshot) || modelBusy || syncing) return;
    syncing = (async () => {
        await prepareImportedCalendar();
        view.setGamePlaces(tracking().importedSnapshot?.gamePlaces);
        const state = tracking(), current = history();
        if (state.importedSnapshot) {
            const next = eventRoute(current.importEvents);
            if (!state.manual && JSON.stringify(next) !== JSON.stringify(route())) {
                context().chatMetadata[OWNER].routes[view.atlas.id] = next; await context().saveMetadata();
            }
            view.drawRoute(); view.root.querySelector('.wa-history-panel')?.dispatchEvent(new Event('worldatlas:history-changed')); view.root.querySelector('.wa-calendar-panel')?.refresh?.(); return;
        }
        const events = liveEvents(state.events, current, view.atlas);
        const changed = JSON.stringify(events) !== JSON.stringify(state.events);
        if (changed) {
            state.events = events;
            if (!state.manual) {
                const root = context().chatMetadata[OWNER]; root.routes ??= {};
                root.routes[view.atlas.id] = eventRoute(events);
            }
            await context().saveMetadata();
        }
        view.drawRoute();
        view.root.querySelector('.wa-history-panel')?.dispatchEvent(new Event('worldatlas:history-changed'));
        view.root.querySelector('.wa-calendar-panel')?.refresh?.();
    })();
    try { await syncing; } finally { syncing = null; }
}
async function updateHistory() {
    if (tracking().importedSnapshot) { await syncHistory(); view.contextChanged(); return; }
    if (modelBusy) throw new Error('Обновление уже выполняется.');
    if (!context().chatId) throw new Error('Откройте чат.');
    const ctx = context(), state = tracking(), current = history();
    if (!current.evidence.length) throw new Error('Нет L0 WorldMemory: сначала сохраните историю в памяти.');
    if (!current.sources.length || state.modelSignature === current.signature) {
        checkpoint(state); state.manual = false; state.events = liveEvents(state.events, current, view.atlas);
        ctx.chatMetadata[OWNER].routes ??= {};
        ctx.chatMetadata[OWNER].routes[view.atlas.id] = eventRoute(state.events);
        await ctx.saveMetadata(); view.contextChanged(); return;
    }
    modelBusy = true;
    requestController = new AbortController();
    try {
        const result = await requestRoute(current, view.atlas, connection(), async body => {
            const response = await fetch('/api/backends/chat-completions/generate', { method: 'POST',
                headers: ctx.getRequestHeaders(), body: JSON.stringify(body), signal: requestController.signal });
            if (!response.ok) throw new Error(`Модель: HTTP ${response.status}. Прежний маршрут сохранён; повторных запросов нет.`);
            return response.json();
        });
        if (context().chatId !== ctx.chatId || context().chatMetadata !== ctx.chatMetadata || history().signature !== current.signature)
            throw new Error('Чат или история изменились во время запроса. Результат не применён.');
        checkpoint(state);
        Object.assign(state, result, { manual: false, modelSignature: current.signature });
        state.events = liveEvents(result.events, current, view.atlas);
        ctx.chatMetadata[OWNER].routes ??= {};
        ctx.chatMetadata[OWNER].routes[view.atlas.id] = eventRoute(state.events);
        await ctx.saveMetadata(); view.contextChanged();
    } finally { modelBusy = false; requestController = null; void syncHistory().catch(error => console.warn('[World Atlas]', error.message)); }
}
function openHistory() {
    view.root.querySelector('.wa-calendar-panel')?.close?.();
    if (!context().chatId) { toastr.info('Откройте чат для маршрута игрока.', 'World Atlas'); return; }
    showHistoryPanel(view, { settings, history, state: tracking, connection, route,
        busy: () => modelBusy, events,
        position: positionLabel,
        setCalendar: async patch => {
            if (tracking().importedSnapshot) throw new Error('Календарь импортированного снимка зафиксирован. Сначала переключитесь на местные L0.');
            tracking().calendarStart = { ...(tracking().calendarStart || {}), ...patch };
            if (context().chatMetadata.worldMemory) context().chatMetadata.worldMemory.calendarAnchor = structuredClone(tracking().calendarStart);
            await context().saveMetadata();
        },
        configure: patch => { Object.assign(settings(), patch); context().saveSettingsDebounced(); },
        setAuto: async value => { settings().auto = value; context().saveSettingsDebounced(); await syncHistory(); },
        update: updateHistory,
        resume: async () => {
            const state = tracking(); checkpoint(state); state.manual = false;
            delete state.importedSnapshot;
            view.setGamePlaces([]);
            state.events = liveEvents(state.events, history(), view.atlas);
            context().chatMetadata[OWNER].routes[view.atlas.id] = eventRoute(state.events);
            await context().saveMetadata(); view.contextChanged();
        },
        undo: async () => {
            const state = tracking(), previous = undoRouteChange(state); if (!previous) return;
            for (const key of Object.keys(state)) delete state[key];
            Object.assign(state, previous.state);
            view.setGamePlaces(state.importedSnapshot?.gamePlaces);
            context().chatMetadata[OWNER].routes[view.atlas.id] = previous.route;
            await context().saveMetadata(); view.contextChanged();
        },
    });
}
function openCalendar() {
    view.root.querySelector('.wa-history-panel')?.remove();
    view.importPanel?.remove();
    const anchor = () => tracking().importedSnapshot?.calendarStart || tracking().calendarStart || {};
    showCalendar(view, {
        rows: () => {
            const routeEvents = events();
            return calendarRows(history(), routeEvents, anchor()).map(row => {
                const event = routeEvents.find(event => event.source === row.source && event.offset === row.offset);
                const place = findPlace(event?.placeId || row.place, view.atlas);
                return { ...row, placeId: Number.isFinite(place?.x) && Number.isFinite(place?.y) ? place.id : null };
            });
        }, anchor,
        onSelect: row => {
            const event = events().find(event => event.source === row.source && event.offset === row.offset);
            const place = findPlace(event?.placeId || row.place, view.atlas);
            if (!place) { view.message.textContent = `${row.place || 'Место не установлено'} · координат для этой сцены нет`; return; }
            view.root.querySelector('.wa-calendar-panel')?.close?.();
            view.select(place, true);
            const note = document.createElement('p'); note.className = 'wa-era-note wa-calendar-selection';
            const date = (row.clock?.label || row.date?.text || 'Дата неизвестна').replace(/ · есть неуточнённые интервалы$/, '');
            note.textContent = `${date} · Исторический просмотр`;
            view.card.querySelector('.wa-card-body').prepend(note);
        },
    });
}
async function openAtlas() {
    if (pendingOpen) return pendingOpen;
    pendingOpen = (async () => {
        try {
            await prepareImportedCalendar();
            if (!view) {
                const saved = settings().atlas;
                // The former built-in seven-card snapshot must not mask the new data pack.
                const oldStarter = saved?.id === 'star-wars-22bby' && Number(saved.version) < 2;
                const atlas = saved && !oldStarter ? await loadAtlas(saved, base) : await loadDefaultAtlas(base);
                view = new AtlasView({
                    base,
                    atlas,
                    route,
                    saveRoute,
                    canEdit: () => Boolean(context().chatId),
                    onImport: async atlas => {
                        settings().atlas = atlas; context().saveSettingsDebounced();
                        if (syncing) await syncing;
                        await syncHistory();
                    },
                    onHistory: openHistory,
                    onCalendar: openCalendar,
                    onRouteImport: importRoute,
                    positionLabel,
                    displayPoints,
                    currentPlaceId,
                });
            }
            await view.open();
            await syncHistory();
        } catch (error) {
            console.error('[World Atlas]', error);
            toastr.error(error.message, 'World Atlas');
        }
    })();
    try { await pendingOpen; } finally { pendingOpen = null; }
}
async function openRouteImport() {
    await openAtlas();
    view?.showRouteImport();
}

jQuery(async () => {
    const button = document.createElement('button');
    button.id = 'world_atlas_open';
    button.className = 'list-group-item flex-container flexGap5 interactable';
    button.type = 'button';
    button.innerHTML = '<i class="fa-solid fa-globe" aria-hidden="true"></i><span>Атлас миров</span>';
    button.addEventListener('click', openAtlas);
    document.querySelector('#extensionsMenu')?.append(button);
    const importButton = document.createElement('button');
    importButton.id = 'world_atlas_import';
    importButton.className = button.className;
    importButton.type = 'button';
    importButton.innerHTML = '<i class="fa-solid fa-file-import" aria-hidden="true"></i><span>World Atlas: импорт маршрута / JSON</span>';
    importButton.addEventListener('click', openRouteImport);
    document.querySelector('#extensionsMenu')?.append(importButton);
    const panel = document.createElement('div');
    panel.className = 'world-atlas-settings';
    panel.innerHTML = '<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>World Atlas · 0.4.4</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content"><p>30 карточек доступны сразу. Координаты и гиперлинии — «Карта из источника». Для короткого файла маршрута откройте нужный чат и нажмите кнопку ниже: можно выбрать любой файл или вставить JSON текстом. Календарь открывается прямо из строки поиска карты.</p><button type="button" class="menu_button">Открыть атлас</button><button type="button" class="menu_button world-atlas-import">Импорт маршрута и календаря · файл / JSON</button></div></div>';
    panel.querySelector('button').addEventListener('click', openAtlas);
    panel.querySelector('.world-atlas-import').addEventListener('click', openRouteImport);
    document.querySelector('#extensions_settings')?.append(panel);
    const ctx = context();
    ctx.eventSource.on(ctx.eventTypes.CHAT_CHANGED, () => {
        requestController?.abort(); view?.root?.querySelector('.wa-history-panel')?.remove(); view?.root?.querySelector('.wa-calendar-panel')?.close?.(); view?.importPanel?.remove(); view?.contextChanged();
        void syncHistory().catch(error => console.warn('[World Atlas]', error.message));
    });
    let timer;
    for (const event of ['worldmemory:injection-refresh', 'worldmemory:archive-changed']) ctx.eventSource.on(event, info => {
        if (info?.metadata && info.metadata !== context().chatMetadata) return;
        clearTimeout(timer); timer = setTimeout(() => void syncHistory().catch(error => console.warn('[World Atlas]', error.message)), 250);
    });
    for (const event of ['MESSAGE_RECEIVED', 'MESSAGE_SENT', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED', 'CHARACTER_MESSAGE_RENDERED', 'GENERATION_ENDED']) {
        if (!ctx.eventTypes[event]) continue;
        ctx.eventSource.on(ctx.eventTypes[event], () => {
            clearTimeout(timer); timer = setTimeout(() => void syncHistory().catch(error => console.warn('[World Atlas]', error.message)), 250);
        });
    }
    globalThis.WorldAtlas = Object.freeze({ open: openAtlas, sync: syncHistory,
        inspect: () => structuredClone(tracking()),
        inspectCalendar: () => view ? calendarRows(history(), events(), tracking().calendarStart) : [] });
    if (location.hash === '#world-atlas') void openAtlas();
});
