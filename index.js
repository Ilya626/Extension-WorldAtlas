import { AtlasView } from './viewer.js';
import { loadAtlas, loadDefaultAtlas } from './atlas-data.js';
import { collectHistory, liveEvents, eventRoute, requestRoute, calendarRows } from './history-route.js';
import { showHistoryPanel } from './history-panel.js';

const OWNER = 'worldAtlas';
const base = new URL('.', import.meta.url);
const context = () => SillyTavern.getContext();
let view;
let pendingOpen;
let syncing;
let modelBusy = false;
let requestController;

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
    return result;
}
function connection() {
    const config = settings();
    const memory = context().extensionSettings.worldMemory;
    if (config.reuseMemory !== false) return { url: memory?.openaiUrl || '', model: memory?.openaiModel || '', key: memory?.openaiKey || '', reasoning: 'medium' };
    return { url: config.url || '', model: config.model || '', key: config.key || '', reasoning: 'medium' };
}
function positionLabel() {
    const state = tracking(), last = state.manual ? null : state.events?.at(-1);
    const source = history();
    const label = state.manual ? 'Ручная отметка' : source.through >= 0 ? `По L0 до сообщения ${source.through + 1}` : 'По L0';
    if (last?.status === 'departed') return `${label}: в пути · прибытие не установлено`;
    if (last && !last.placeId) return `${label}: ${last.placeName} · нет точки на карте`;
    const place = view.atlas.places.find(place => place.id === route().at(-1));
    return place ? `${label}: ${place.name}` : `${label}: место неизвестно`;
}
function displayPoints() {
    const state = tracking();
    if (state.manual) return route().map(id => view.atlas.places.find(place => place.id === id)).filter(Boolean);
    const points = [];
    for (const event of state.events || []) {
        if (event.status === 'departed') continue;
        const place = event.placeId ? view.atlas.places.find(place => place.id === event.placeId) : { id: null, name: event.placeName };
        if (place && (!place.id || points.at(-1)?.id !== place.id)) points.push(place);
    }
    return points;
}
function currentPlaceId() {
    const state = tracking();
    if (state.manual) return route().at(-1);
    const last = state.events?.at(-1);
    return last?.status === 'departed' ? null : last?.placeId || null;
}
async function syncHistory() {
    if (!view || !context().chatId || settings().auto === false || modelBusy || syncing) return;
    syncing = (async () => {
        const state = tracking(), current = history();
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
    })();
    try { await syncing; } finally { syncing = null; }
}
async function updateHistory() {
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
    if (!context().chatId) { toastr.info('Откройте чат для маршрута игрока.', 'World Atlas'); return; }
    showHistoryPanel(view, { settings, history, state: tracking, connection, route,
        busy: () => modelBusy, events: () => liveEvents(tracking().events, history(), view.atlas),
        position: positionLabel,
        setCalendar: async patch => {
            tracking().calendarStart = { ...(tracking().calendarStart || {}), ...patch };
            if (context().chatMetadata.worldMemory) context().chatMetadata.worldMemory.calendarAnchor = structuredClone(tracking().calendarStart);
            await context().saveMetadata();
        },
        configure: patch => { Object.assign(settings(), patch); context().saveSettingsDebounced(); },
        setAuto: async value => { settings().auto = value; context().saveSettingsDebounced(); await syncHistory(); },
        update: updateHistory,
        resume: async () => {
            const state = tracking(); checkpoint(state); state.manual = false;
            state.events = liveEvents(state.events, history(), view.atlas);
            context().chatMetadata[OWNER].routes[view.atlas.id] = eventRoute(state.events);
            await context().saveMetadata(); view.contextChanged();
        },
        undo: async () => {
            const state = tracking(); if (!state.previous) return;
            const previous = state.previous;
            for (const key of Object.keys(state)) delete state[key];
            const { route: points, ...saved } = previous; Object.assign(state, saved);
            // Undo is an explicit player correction; automatic additions pause.
            state.manual = true;
            context().chatMetadata[OWNER].routes[view.atlas.id] = points;
            await context().saveMetadata(); view.contextChanged();
        },
    });
}
async function openAtlas() {
    if (pendingOpen) return pendingOpen;
    pendingOpen = (async () => {
        try {
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
                    onImport: atlas => { settings().atlas = atlas; context().saveSettingsDebounced(); },
                    onHistory: openHistory,
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

jQuery(async () => {
    const button = document.createElement('button');
    button.id = 'world_atlas_open';
    button.className = 'list-group-item flex-container flexGap5 interactable';
    button.type = 'button';
    button.innerHTML = '<i class="fa-solid fa-globe" aria-hidden="true"></i><span>Атлас миров</span>';
    button.addEventListener('click', openAtlas);
    document.querySelector('#extensionsMenu')?.append(button);
    const panel = document.createElement('div');
    panel.className = 'world-atlas-settings';
    panel.innerHTML = '<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>World Atlas · 0.4.1</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content"><p>30 карточек доступны сразу. Координаты и гиперлинии загружаются отдельно кнопкой «Карта из источника». Подключение, источники и календарь — «Обновить маршрут».</p><button type="button" class="menu_button">Открыть атлас</button></div></div>';
    panel.querySelector('button').addEventListener('click', openAtlas);
    document.querySelector('#extensions_settings')?.append(panel);
    const ctx = context();
    ctx.eventSource.on(ctx.eventTypes.CHAT_CHANGED, () => {
        requestController?.abort(); view?.root?.querySelector('.wa-history-panel')?.remove(); view?.contextChanged();
        void syncHistory().catch(error => console.warn('[World Atlas]', error.message));
    });
    let timer;
    ctx.eventSource.on('worldmemory:injection-refresh', () => {
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
        inspectCalendar: () => view ? calendarRows(history(), liveEvents(tracking().events, history(), view.atlas), tracking().calendarStart) : [] });
    if (location.hash === '#world-atlas') void openAtlas();
});
