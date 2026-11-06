import { calendarRows, calendarNow } from './history-route.js';
const el = (tag, text, className) => {
    const node = document.createElement(tag); if (text !== undefined) node.textContent = text;
    if (className) node.className = className; return node;
};
export function showHistoryPanel(view, controls) {
    view.root.querySelector('.wa-history-panel')?.remove();
    const panel = el('section', undefined, 'wa-history-panel');
    panel.setAttribute('aria-label', 'Маршрут игрока');
    const heading = el('div', undefined, 'wa-history-heading');
    const close = view.button('Закрыть маршрут', '×', () => { panel.remove(); view.historyButton.focus(); });
    heading.append(el('h2', 'Маршрут игрока'), close); panel.append(heading);
    const status = el('p', undefined, 'wa-history-status'); status.setAttribute('role', 'status'); panel.append(status);
    const explanation = el('p', 'Дата и реальные места игрока сохраняются вместе с новым L0 WorldMemory, без дополнительного вызова. Несжатый хвост ещё не меняет маркер и календарь. Кнопка модели нужна только для старых L0 без этих полей. Планы и упоминания не становятся поездками.');
    panel.append(explanation);
    const autoLabel = el('label', undefined, 'wa-history-check');
    const auto = el('input'); auto.type = 'checkbox'; auto.checked = controls.settings().auto !== false;
    auto.addEventListener('change', async () => { await controls.setAuto(auto.checked); render(); });
    autoLabel.append(auto, document.createTextNode('Автоматически обновлять по сохранённым L0')); panel.append(autoLabel);
    const connection = el('details', undefined, 'wa-connection'); connection.append(el('summary', 'Подключение'));
    const reuseLabel = el('label', undefined, 'wa-history-check');
    const reuse = el('input'); reuse.type = 'checkbox'; reuse.checked = controls.settings().reuseMemory !== false;
    reuseLabel.append(reuse, document.createTextNode('Использовать подключение WorldMemory')); connection.append(reuseLabel);
    const inherited = el('p'); connection.append(inherited);
    const own = el('div'); connection.append(own);
    const fields = {};
    for (const [key, title, type] of [['url', 'OpenAI-compatible URL', 'url'], ['model', 'Модель', 'text'], ['key', 'API key', 'password']]) {
        const label = el('label', title); const input = el('input'); input.type = type; input.className = 'text_pole';
        input.autocomplete = 'off'; input.value = controls.settings()[key] || ''; input.setAttribute('aria-label', title);
        input.addEventListener('change', () => { controls.configure({ [key]: input.value.trim() }); render(); });
        label.append(input); own.append(label); fields[key] = input;
    }
    reuse.addEventListener('change', () => { controls.configure({ reuseMemory: reuse.checked }); render(); });
    panel.append(connection);
    const estimate = el('p'); panel.append(estimate);
    const actions = el('div', undefined, 'wa-history-actions');
    const update = view.button('Обновить маршрут одним вызовом модели', 'Обновить маршрут · 1 вызов', async () => {
        update.disabled = true; status.textContent = 'Один запрос; прежний маршрут сохраняется до готового результата…';
        try { await controls.update(); render(); }
        catch (error) { status.textContent = error.message; }
        finally { update.disabled = false; }
    });
    const undo = view.button('Отменить последнее обновление маршрута', 'Отменить обновление', async () => { await controls.undo(); render(); });
    const resume = view.button('Заменить ручной маршрут историей', 'Использовать историю', async () => { await controls.resume(); render(); });
    actions.append(update, undo, resume); panel.append(actions);
    const usage = el('p'); panel.append(usage);
    const notes = el('p'); panel.append(notes);
    const list = el('ol', undefined, 'wa-history-events'); panel.append(list);
    const tabs = el('div', undefined, 'wa-history-actions');
    const calendar = el('div', undefined, 'wa-calendar'); calendar.hidden = true;
    const info = el('details', undefined, 'wa-connection wa-history-info'); info.append(el('summary', 'Настройки и сведения'));
    const secondaryActions = el('div', undefined, 'wa-history-actions'); secondaryActions.append(undo, resume);
    for (const node of [explanation, autoLabel, connection, usage, notes, secondaryActions]) info.append(node);
    actions.replaceChildren(update);
    const routeTab = view.button('Показать маршрут', 'Маршрут', () => selectTab(false));
    const calendarTab = view.button('Показать календарь истории', 'Календарь', () => selectTab(true));
    function selectTab(showCalendar) {
        list.hidden = showCalendar; calendar.hidden = !showCalendar;
        routeTab.setAttribute('aria-pressed', String(!showCalendar)); calendarTab.setAttribute('aria-pressed', String(showCalendar));
    }
    tabs.append(routeTab, calendarTab);
    panel.insertBefore(tabs, list); panel.insertBefore(actions, list); panel.insertBefore(estimate, list); panel.insertBefore(info, list); panel.append(calendar);
    selectTab(false);
    function render() {
        const state = controls.state(), history = controls.history(), effective = controls.connection();
        status.textContent = `${controls.position()} · ${history.imported ? history.importBlocked ? 'срез требует внимания' : history.importExtended ? `хвост: ${history.tailMessages}, ещё не учтён` : 'исторический срез, новые L0 добавятся автоматически'
            : state.manual ? 'ручной маршрут, автоматическое добавление приостановлено' : `хвост: ${history.tailMessages} сообщений, ещё не учтён`}`;
        own.hidden = reuse.checked;
        inherited.hidden = !reuse.checked;
        inherited.textContent = effective.url && effective.model ? `WorldMemory · ${effective.model}. Его настройки не меняются.` : 'Нужен OpenAI-compatible URL и модель в WorldMemory; или снимите флажок и укажите свои здесь.';
        const chars = history.sources.reduce((sum, source) => sum + source.text.length + (source.originals || []).reduce((n, original) => n + original.text.length, 0), 0);
        const unchanged = !history.sources.length || state.modelSignature === history.signature;
        estimate.textContent = !history.evidence.length ? 'Нет L0 WorldMemory: сначала сохраните историю в памяти.' : unchanged ? 'История разобрана · обновление без API'
            : `${history.sources.length} источников · ${chars.toLocaleString('ru')} символов + инструкция/список миров. Один запрос, ответ до 8192 токенов. Денежная цена зависит от провайдера; тариф атласу неизвестен.`;
        update.textContent = unchanged ? 'Обновить маршрут · без API' : 'Обновить маршрут · 1 вызов';
        update.disabled = controls.busy() || !history.evidence.length; undo.disabled = !state.previous; resume.hidden = !state.manual;
        if (history.imported) {
            const imported = state.importedSnapshot;
            const baseEvents = history.importEvents.slice(0, imported.events.length);
            const mapped = new Set(baseEvents.filter(event => event.placeId).map(event => event.placeId)).size;
            const unknown = new Set(baseEvents.filter(event => !event.placeId).map(event => event.placeName)).size;
            estimate.textContent = `Импортировано событий: ${imported.events.length}; мест на карте: ${mapped}, без точки: ${unknown}. Срез источника: ${imported.coverage.throughMessage} из ${imported.coverage.messageCount} сообщений; хвост ${imported.coverage.tailMessages} не учтён. Новые L0 после границы добавляются автоматически; их откат убирает добавления.${history.importBlocked ? ` Внимание: ${history.importBlocked}.` : ''}`;
            update.textContent = 'Обновить по новым L0 · без API'; update.disabled = controls.busy();
            undo.textContent = 'Отменить импорт'; resume.textContent = 'Использовать местные L0'; resume.hidden = false;
            actions.append(undo);
        } else {
            undo.textContent = 'Отменить обновление'; resume.textContent = 'Использовать историю'; secondaryActions.prepend(undo);
        }
        auto.disabled = Boolean(history.imported); if (history.imported) auto.checked = true;
        const u = state.usage;
        usage.textContent = u ? `Последний вызов: вход ${u.prompt_tokens ?? u.input_tokens ?? '?'}, выход ${u.completion_tokens ?? u.output_tokens ?? '?'} токенов${u.cost !== undefined ? `; стоимость провайдера ${u.cost}` : '; денежная стоимость не возвращена'}.` : 'Автоматическое чтение истории и ручная правка не вызывают модель.';
        notes.textContent = state.note || '';
        list.replaceChildren();
        const wasCalendarSettingsOpen = Boolean(calendar.querySelector('details')?.open);
        calendar.replaceChildren();
        const table = el('table'); const head = el('tr');
        for (const title of ['Игровая дата', 'Место']) head.append(el('th', title));
        table.append(head);
        const events = controls.events();
        const start = state.importedSnapshot?.calendarStart || state.calendarStart || {};
        const datedRows = calendarRows(history, events, start);
        for (const event of events) {
            const item = el('li'); const title = event.placeName || event.placeId;
            const clock = datedRows.find(row => row.source === event.source && row.offset === event.offset)?.clock;
            const details = el('details'); details.append(el('summary', `${title}${event.status === 'departed' ? ' · отбытие' : ''} · ${clock ? formatClock(clock) : event.date?.text || 'дата неизвестна'}`));
            details.append(el('blockquote', event.quote), el('small', `Источник ${event.source} · ревизия ${event.revision}`));
            item.append(details); list.append(item);
        }
        for (const entry of datedRows) {
            const c = entry.clock;
            const calculated = formatClock(c, false);
            const row = el('tr'); row.append(el('td', `${calculated}${entry.date?.text ? ` (${entry.date.text})` : ''}`), el('td', `${entry.place || 'Место не установлено'}${entry.status === 'departed' ? ' · отбытие' : ''}`));
            table.append(row);
        }
        const calendarSettings = el('details', undefined, 'wa-connection'); calendarSettings.open = wasCalendarSettingsOpen; calendarSettings.append(el('summary', 'Начало календаря этой игры'));
        const anchorLabel = el('label', 'Опорное событие / начало'); const anchorInput = el('input'); anchorInput.className = 'text_pole'; anchorInput.value = start.label || ''; anchorInput.placeholder = 'Начало игры';
        anchorInput.addEventListener('change', async () => { await controls.setCalendar({ label: anchorInput.value.trim() }); render(); }); anchorLabel.append(anchorInput);
        const offsetLabel = el('label', 'Смещение старта от события, суток (необязательно)'); const offsetInput = el('input'); offsetInput.className = 'text_pole'; offsetInput.type = 'number'; offsetInput.step = 'any'; offsetInput.value = start.offsetDays ?? '';
        offsetInput.addEventListener('change', async () => { await controls.setCalendar({ offsetDays: offsetInput.value === '' ? null : Number(offsetInput.value) }); render(); }); offsetLabel.append(offsetInput);
        const approxLabel = el('label', undefined, 'wa-history-check'); const approxInput = el('input'); approxInput.type = 'checkbox'; approxInput.checked = Boolean(start.approximate);
        approxInput.addEventListener('change', async () => { await controls.setCalendar({ approximate: approxInput.checked }); render(); }); approxLabel.append(approxInput, document.createTextNode('Старт приблизительный'));
        calendarSettings.append(anchorLabel, offsetLabel, approxLabel);
        const displayLabel = el('label', 'Основной календарь'); const display = el('select'); display.className = 'text_pole';
        for (const [value, title] of [['game', 'Игровые дни'], ['sw-legends', 'ЗВ · Legends · 10×35 + 18 дней · 368 дней']]) {
            const option = el('option', title); option.value = value; display.append(option);
        }
        display.value = start.display || 'game'; display.addEventListener('change', async () => { await controls.setCalendar({ display: display.value }); render(); }); displayLabel.append(display);
        calendarSettings.append(displayLabel);
        for (const [key, title, type] of [['swYear', 'Год старта ДБЯ (ЗВ)', 'number'], ['swDay', 'Стандартный день года на старте (условная опора)', 'number']]) {
            const label = el('label', title), input = el('input'); input.type = type; input.className = 'text_pole'; input.value = start[key] ?? '';
            input.addEventListener('change', async () => { await controls.setCalendar({ [key]: type === 'number' ? Number(input.value) : input.value }); render(); }); label.append(input); calendarSettings.append(label);
        }
        calendarSettings.append(el('p', 'В скобках — привычные названия тех же игровых дней/месяцев, год остаётся ДБЯ/ПБЯ. Это не Gregorian: неделя5дней, месяц35дней. Профиль Legends368, не Canon365. Три местных праздника условно стоят в конце года; точный месяц/день Геонозиса не утверждается.'));
        if (history.imported) {
            for (const input of calendarSettings.querySelectorAll('input,select')) input.disabled = true;
            calendarSettings.append(el('p', 'Это опора импортированного снимка. Настройки календаря местной игры не изменялись.'));
        }
        calendar.append(el('p', formatClock(calendarNow(history, start)), 'wa-history-status'), calendarSettings, table);
    }
    view.root.append(panel); render(); close.focus({ preventScroll: true });
    return panel;
}
function formatClock(c, includeAnchor = true) {
    if (c.label) return c.label;
    return `${c.incomplete ? 'Не ранее: ' : c.approximate ? '≈ ' : ''}День ${c.gameDay}, ${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}${includeAnchor && c.anchorDay !== null ? ` · ${c.anchorDay >= 0 ? '+' : ''}${c.anchorDay.toFixed(2)} сут. от ${c.anchorLabel}` : ''}${c.incomplete ? includeAnchor ? ' · часть интервалов неизвестна' : ' · время неполно' : ''}`;
}
