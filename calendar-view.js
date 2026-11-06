const node = (tag, className, text) => {
    const result = document.createElement(tag);
    if (className) result.className = className;
    if (text !== undefined) result.textContent = text;
    return result;
};
const nativeDays = ['Primeday', 'Centaxday', 'Taungsday', 'Zhellday', 'Benduday'];
const familiarDays = ['пн', 'вт', 'ср', 'чт', 'пт'];
const familiarMonths = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь'];
const yearName = year => year > 0 ? `${year} ДБЯ` : `${1 - year} ПБЯ`;
const eventCount = count => `${count} ${count % 100 >= 11 && count % 100 <= 14 ? 'событий' : count % 10 === 1 ? 'событие' : count % 10 >= 2 && count % 10 <= 4 ? 'события' : 'событий'}`;
const gameDay = row => Number.isFinite(row.clock?.elapsedHours) ? Math.floor(row.clock.elapsedHours / 24) + 1
    : Number.isFinite(row.clock?.gameDay) ? row.clock.gameDay : null;

export function calendarSelection(rows, start, end = start, unknownOnly = false) {
    const first = Math.min(start, end), last = Math.max(start, end);
    return rows.filter(row => {
        const day = gameDay(row);
        return unknownOnly ? day === null : day !== null && day >= first && day <= last;
    });
}

function segments() {
    const result = [{ title: 'New Year Fete', familiar: 'Новогодний период', length: 5 }];
    for (let month = 1; month <= 10; month++) {
        result.push({ title: `Месяц ${month}`, familiar: familiarMonths[month - 1], length: 35 });
        if (month === 6) result.push({ title: 'Festival of Life', familiar: 'Праздник жизни', length: 5 });
        if (month === 9) result.push({ title: 'Festival of Stars', familiar: 'Праздник звёзд', length: 5 });
    }
    result.push({ title: 'Local holidays', familiar: 'Местные праздники', length: 3 });
    let start = 0;
    return result.map(segment => { const value = { ...segment, start }; start += segment.length; return value; });
}
const swSegments = segments();

// Date placement follows timeline-calendar.js's declared Legends 368-day profile.
// This view never changes the anchor, source dates, elapsed time, or route state.
export function showCalendar(view, controls) {
    view.root.querySelector('.wa-calendar-panel')?.close?.();
    const panel = node('section', 'wa-calendar-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Календарь игры');
    const backdrop = node('button', 'wa-calendar-backdrop');
    backdrop.type = 'button'; backdrop.tabIndex = -1;
    backdrop.setAttribute('aria-label', 'Вернуться к карте');
    const close = () => {
        panel.remove(); backdrop.remove();
        view.calendarButton?.focus({ preventScroll: true });
    };
    panel.close = close;
    backdrop.addEventListener('click', close);
    const button = (text, action, className = '', label = text) => {
        const result = node('button', `wa-cal-button ${className}`, text);
        result.type = 'button'; result.setAttribute('aria-label', label);
        result.addEventListener('click', action); return result;
    };
    const handle = node('div', 'wa-cal-handle'); handle.setAttribute('aria-hidden', 'true');
    const heading = node('header', 'wa-cal-heading');
    const title = node('div'); title.append(node('span', 'wa-cal-eyebrow', 'МАРШРУТ ВО ВРЕМЕНИ'), node('h2', '', 'Календарь'));
    const closeButton = button('×', close, 'wa-cal-close', 'Закрыть календарь');
    heading.append(title, closeButton);
    const body = node('div', 'wa-cal-body');
    panel.append(handle, heading, body);
    view.root.append(backdrop, panel);
    let selectedStart = null, selectedEnd = null, rangeMode = false, rangePending = false;
    let unknownOnly = false, page = null;

    function render() {
        const rows = controls.rows() || [], anchor = controls.anchor?.() || {};
        const known = rows.filter(row => gameDay(row) !== null), unknown = rows.filter(row => gameDay(row) === null);
        const lastDay = known.length ? Math.max(...known.map(gameDay)) : 1;
        if (selectedStart === null) selectedStart = selectedEnd = lastDay;
        const sw = anchor.display === 'sw-legends' && Number.isFinite(anchor.swYear) && Number.isFinite(anchor.swDay);
        const base = sw ? anchor.swDay - 1 : 0;
        const ordinalFor = day => base + day - 1;
        function pageFor(day) {
            const absolute = ordinalFor(day);
            if (!sw) return { year: 0, segment: Math.floor((day - 1) / 35) };
            const year = Math.floor(absolute / 368), ordinal = ((absolute % 368) + 368) % 368;
            return { year, segment: swSegments.findIndex(segment => ordinal >= segment.start && ordinal < segment.start + segment.length) };
        }
        if (page === null) page = pageFor(selectedStart);
        const segment = sw ? swSegments[page.segment] : { title: 'Дни игры', familiar: '', length: 35, start: page.segment * 35 };
        const firstDay = sw ? page.year * 368 + segment.start - base + 1 : segment.start + 1;
        const dayTitle = day => {
            if (!sw) return `День ${day}`;
            const location = pageFor(day), part = swSegments[location.segment];
            const ordinal = ordinalFor(day) - location.year * 368 - part.start + 1;
            return `${ordinal} · ${part.title} (${part.familiar}) · ${yearName(anchor.swYear - location.year)}`;
        };
        const focusedLabel = body.contains(document.activeElement) ? document.activeElement.getAttribute('aria-label') : null;
        body.replaceChildren();
        const modes = node('nav', 'wa-cal-modes'); modes.setAttribute('aria-label', 'Выбор времени');
        for (const [text, value] of [['День', false], ['Период', true]]) {
            const mode = button(text, () => { rangeMode = value; rangePending = false; selectedEnd = selectedStart; unknownOnly = false; render(); });
            mode.setAttribute('aria-pressed', String(rangeMode === value)); modes.append(mode);
        }
        modes.append(button('К последнему', () => { selectedStart = selectedEnd = lastDay; page = pageFor(lastDay); rangePending = false; unknownOnly = false; render(); }, 'wa-cal-latest'));
        body.append(modes);
        const monthRow = node('div', 'wa-cal-month');
        function move(direction) {
            if (sw) {
                page.segment += direction;
                if (page.segment < 0) { page.segment = swSegments.length - 1; page.year--; }
                if (page.segment >= swSegments.length) { page.segment = 0; page.year++; }
            } else page.segment = Math.max(0, page.segment + direction);
            render();
        }
        const previous = button('‹', () => move(-1), 'wa-cal-arrow', 'Предыдущий месяц / период');
        if (firstDay <= 1) previous.disabled = true;
        const monthLabel = node('div', 'wa-cal-month-label');
        monthLabel.append(node('strong', '', `${segment.title}${segment.familiar ? ` (${segment.familiar})` : ''}`),
            node('small', '', sw ? `${yearName(anchor.swYear - page.year)}${anchor.approximate ? ' · опора ≈' : ''}` : `Дни ${firstDay}–${firstDay + 34} · календарная опора не задана`));
        monthRow.append(previous, monthLabel, button('›', () => move(1), 'wa-cal-arrow', 'Следующий месяц / период'));
        body.append(monthRow);
        const weekdays = node('div', 'wa-cal-weekdays');
        const showWeekdays = sw && segment.length === 35;
        if (showWeekdays) for (let i = 0; i < 5; i++) {
            const label = node('abbr', '', `${nativeDays[i].slice(0, 3)} (${familiarDays[i]})`);
            label.title = `${nativeDays[i]} (${['понедельник', 'вторник', 'среда', 'четверг', 'пятница'][i]})`; weekdays.append(label);
        }
        if (showWeekdays) body.append(weekdays);
        const grid = node('div', 'wa-cal-grid'); grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', 'Выберите день');
        for (let index = 0; index < segment.length; index++) {
            const day = firstDay + index, dayRows = known.filter(row => gameDay(row) === day);
            const minDate = dayRows.some(row => row.clock?.incomplete), approximate = dayRows.some(row => row.clock?.approximate);
            const cell = button(String(sw ? index + 1 : day), () => {
                unknownOnly = false;
                if (!rangeMode || !rangePending) { selectedStart = selectedEnd = day; rangePending = rangeMode; }
                else { selectedEnd = Math.max(selectedStart, day); selectedStart = Math.min(selectedStart, day); rangePending = false; }
                render();
                if (!rangePending) body.querySelector('.wa-cal-selection')?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
            }, 'wa-cal-day', `${dayTitle(day)}${minDate ? ', не ранее' : approximate ? ', приблизительно' : ''}; событий ${dayRows.length}`);
            cell.disabled = day < 1;
            const selected = !unknownOnly && day >= selectedStart && day <= selectedEnd;
            cell.setAttribute('aria-pressed', String(selected));
            if (day === selectedStart || day === selectedEnd) cell.classList.add('wa-cal-edge');
            if (dayRows.length) {
                cell.classList.add('wa-cal-has-events');
                const mark = node('span', 'wa-cal-dot', minDate ? '≥' : approximate ? '≈' : '');
                mark.setAttribute('aria-hidden', 'true'); cell.append(mark);
            }
            grid.append(cell);
        }
        body.append(grid);
        const caption = node('div', 'wa-cal-legend');
        caption.append(node('span', '', '● события'), node('span', '', '≈ приблизительно'), node('span', '', '≥ не ранее'));
        body.append(caption);
        if (rangePending) body.append(node('p', 'wa-cal-hint', 'Выберите последний день периода'));
        const unknownButton = button(`Без определённого дня · ${unknown.length}`, () => { unknownOnly = !unknownOnly; render(); }, 'wa-cal-undated');
        unknownButton.setAttribute('aria-pressed', String(unknownOnly));
        if (unknown.length) body.append(unknownButton);
        const filtered = calendarSelection(rows, selectedStart, selectedEnd, unknownOnly);
        const selection = node('section', 'wa-cal-selection'); selection.setAttribute('aria-live', 'polite');
        const selectionTitle = node('div', 'wa-cal-selection-title');
        selectionTitle.append(node('h3', '', unknownOnly ? 'День не установлен' : selectedStart === selectedEnd ? `День игры ${selectedStart}` : `Дни игры ${selectedStart}–${selectedEnd}`), node('span', '', eventCount(filtered.length)));
        selection.append(selectionTitle);
        if (!unknownOnly) selection.append(node('p', 'wa-cal-date', selectedStart === selectedEnd ? dayTitle(selectedStart) : `${dayTitle(selectedStart)} → ${dayTitle(selectedEnd)}`));
        if (filtered.some(row => row.clock?.incomplete)) selection.append(node('p', 'wa-cal-warning', '≥ Показан минимальный день. Есть интервал неизвестной длительности; фактическая дата может быть позже.'));
        else if (filtered.some(row => row.clock?.approximate) || anchor.approximate) selection.append(node('p', 'wa-cal-hint', '≈ Даты приблизительные: календарная опора или длительность событий не точны.'));
        if (!filtered.length) selection.append(node('p', 'wa-cal-empty', rows.length ? 'В выбранном времени нет сохранённых событий.' : 'Сохранённых событий пока нет. Календарь появится вместе с хронологией игры.'));
        for (const row of filtered) {
            const canLocate = Boolean(row.placeId && controls.onSelect);
            const card = node(canLocate ? 'button' : 'article', `wa-cal-event${canLocate ? ' wa-cal-locatable' : ''}`);
            if (canLocate) {
                card.type = 'button'; card.addEventListener('click', () => { close(); controls.onSelect(row); });
            }
            const text = node('div', 'wa-cal-event-text');
            text.append(node('strong', '', row.place || row.placeName || 'Место не установлено'));
            const clock = row.clock;
            const fallback = clock ? `${clock.incomplete ? 'Не ранее: ' : clock.approximate ? '≈ ' : ''}День ${gameDay(row) ?? 'не установлен'}` : 'День не установлен';
            text.append(node('span', 'wa-cal-event-time', clock?.label || (clock ? fallback : row.date?.text || fallback)));
            if (row.status === 'departed') text.append(node('span', 'wa-cal-event-status', 'Отбытие'));
            if (row.date?.text && row.date.text !== clock?.label) text.append(node('small', '', row.date.text));
            text.append(node('small', 'wa-cal-source', row.source ? `Источник: ${row.source}${row.offset !== undefined ? ` · событие ${row.offset + 1}` : ''}` : 'Источник не указан'));
            card.append(text, node('span', 'wa-cal-event-action', canLocate ? 'На карте ↗' : row.place || row.placeName ? 'Без точки\nна карте' : ''));
            selection.append(card);
        }
        body.append(selection);
        const settings = node('details', 'wa-cal-profile'); settings.append(node('summary', '', 'Календарная опора и точность'));
        settings.append(node('p', '', anchor.label || 'Начало игры не задано. Показан отсчёт игровых дней.'));
        if (anchor.note) settings.append(node('p', '', anchor.note));
        if (sw) settings.append(node('p', '', 'Legends: 5 дней в неделе, 35 дней в месяце, 368 дней в году. Названия в скобках — подсказки, не перевод в земной календарь. Праздники вне месяцев; местные праздники в конце года — условность опоры этой игры.'));
        settings.append(node('p', '', 'Выбор дня меняет просмотр. Текущее положение игрока и сохранённый маршрут не изменяются.'));
        body.append(settings);
        if (focusedLabel) [...body.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === focusedLabel)?.focus({ preventScroll: true });
    }
    panel.refresh = render;
    panel.addEventListener('worldatlas:history-changed', render);
    panel.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.stopPropagation(); close(); }
        if (event.key === 'Tab') {
            const focusable = [...panel.querySelectorAll('button:not(:disabled),summary')];
            const first = focusable[0], last = focusable.at(-1);
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
    });
    render(); closeButton.focus({ preventScroll: true });
    return panel;
}
