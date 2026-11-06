import { TRAVEL_SOURCE, TRAVEL_REGIONS, travelRegion, estimateTravel, travelDeparture, projectedArrival, travelPhrase } from './travel-estimate.js';

const el = (tag, className = '', text) => {
    const node = document.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

export function showTravel(view, destination) {
    view.root.querySelector('.wa-travel-panel')?.close?.();
    view.root.querySelector('.wa-calendar-panel')?.close?.();
    view.root.querySelector('.wa-history-panel')?.remove();
    view.importPanel?.remove();
    const current = view.currentPlaceId ? view.currentPlaceId() : view.route().at(-1);
    const timing = view.travelClock?.() || {};
    const panel = el('section', 'wa-travel-panel');
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', 'Оценка перелёта');
    const backdrop = el('div', 'wa-travel-backdrop');
    const previousFocus = document.activeElement;
    const close = () => { panel.remove(); backdrop.remove(); previousFocus?.focus({ preventScroll: true }); };
    panel.close = close;
    backdrop.addEventListener('click', close);
    for (const type of ['input', 'change']) panel.addEventListener(type, event => event.stopPropagation());
    panel.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.stopPropagation(); close(); }
        if (event.key === 'Tab') {
            event.stopPropagation();
            const controls = [...panel.querySelectorAll('button,input,select,textarea,a[href]')].filter(node => !node.disabled && node.getClientRects().length);
            if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
            if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
        }
    });
    const heading = el('header', 'wa-travel-heading');
    const headingText = el('div'); headingText.append(el('span', 'wa-eyebrow', 'ПЛАН ПОЕЗДКИ'), el('h2', '', 'Оценить перелёт'));
    heading.append(headingText, view.button('Закрыть оценку перелёта', '×', close));
    const body = el('div', 'wa-travel-body');
    body.append(el('p', 'wa-travel-hint', 'Игровая шкала SW5e · для согласования с мастером.'));
    const places = [...view.atlas.places].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    const select = (label, entries, value) => {
        const field = el('label', 'wa-travel-field'); field.append(el('span', '', label));
        const input = el('select'); input.setAttribute('aria-label', label);
        for (const [id, text] of entries) { const option = el('option', '', text); option.value = id; input.append(option); }
        input.value = value || ''; field.append(input); return { field, input };
    };
    const endpoints = [];
    for (const [label, initial] of [['Откуда', current], ['Куда', destination?.id !== current ? destination?.id : null]]) {
        const entries = [['', 'Выберите мир'], ...places.map(place => [place.id, `${place.id === current ? 'Вы сейчас: ' : ''}${place.name}`])];
        const placeField = select(label, entries, initial);
        const regionField = select(`Регион: ${label.toLowerCase()}`, [['', 'Регион не установлен'], ...TRAVEL_REGIONS], '');
        const note = el('small', 'wa-travel-hint');
        const group = el('div', 'wa-travel-endpoint'); group.append(placeField.field, regionField.field, note); body.append(group);
        const endpoint = { place: placeField.input, region: regionField.input, note };
        const locate = () => {
            const place = view.atlas.places.find(place => place.id === endpoint.place.value);
            const region = travelRegion(place, view.atlas);
            endpoint.region.value = region.id || ''; endpoint.note.textContent = region.basis;
        };
        endpoint.place.addEventListener('change', () => { locate(); render(); });
        endpoint.region.addEventListener('change', () => { endpoint.note.textContent = 'Регион выбран вручную · допущение для расчёта'; render(); });
        locate(); endpoints.push(endpoint);
    }
    const importedDrive = timing.defaults?.hyperdriveClass;
    const defaultDrive = Number.isFinite(importedDrive) && importedDrive > 0 ? importedDrive : 1;
    const drive = { field: el('label', 'wa-travel-field'), input: el('input') };
    drive.field.append(el('span', '', 'Класс гипердвигателя'));
    drive.input.type = 'number'; drive.input.min = '0'; drive.input.step = 'any'; drive.input.value = String(defaultDrive);
    drive.input.setAttribute('aria-label', 'Класс гипердвигателя'); drive.input.setAttribute('list', 'wa-travel-drive-classes');
    const driveHints = el('datalist'); driveHints.id = 'wa-travel-drive-classes';
    for (const value of [0.5, 1, 2, 3, 4, 5, 10, 12]) { const option = el('option'); option.value = String(value); driveHints.append(option); }
    drive.field.append(drive.input, driveHints);
    body.append(drive.field, el('p', 'wa-travel-hint', `${importedDrive ? 'Из импортированных данных' : 'По умолчанию ×1'}; можно выбрать другой двигатель. Меньше класс — быстрее.`));
    const departure = el('fieldset', 'wa-travel-departure'); departure.append(el('legend', '', 'Вылет · игровое время'));
    const dayLabel = el('label', 'wa-travel-field', 'День игры'), day = el('input'); day.type = 'number'; day.min = '1'; day.step = '1'; day.setAttribute('aria-label', 'День вылета');
    day.value = Number.isFinite(timing.now?.elapsedHours) ? String(Math.floor(timing.now.elapsedHours / 24) + 1) : '';
    const timeLabel = el('label', 'wa-travel-field', 'Время, если известно'), time = el('input'); time.type = 'time'; time.setAttribute('aria-label', 'Время вылета');
    if (timing.now?.hourKnown === true && Number.isFinite(timing.now.elapsedHours)) {
        const hour = Math.floor(timing.now.elapsedHours % 24), minute = Math.floor((timing.now.elapsedHours * 60) % 60);
        time.value = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }
    let departureEdited = false;
    dayLabel.append(day); timeLabel.append(time); departure.append(dayLabel, timeLabel); body.append(departure);
    const output = el('section', 'wa-travel-result'); output.setAttribute('aria-live', 'polite');
    const details = el('details', 'wa-travel-details');
    details.append(el('summary', '', 'Допущения и источник'));
    const assumptions = el('div'); details.append(assumptions);
    const text = el('textarea', 'wa-travel-phrase'); text.readOnly = true; text.setAttribute('aria-label', 'Фраза для мастера'); text.rows = 4;
    const copy = view.button('Скопировать фразу мастеру', 'Скопировать мастеру', async () => {
        try { await navigator.clipboard.writeText(text.value); copy.textContent = 'Скопировано'; }
        catch { text.focus(); text.select(); copy.textContent = 'Выделено · скопируйте текст'; }
    });
    const source = el('a', 'wa-travel-source', 'Шкала SW5e · источник ↗'); source.href = TRAVEL_SOURCE; source.target = '_blank'; source.rel = 'noopener noreferrer';
    details.append(source);
    body.append(output, text, copy, el('p', 'wa-travel-hint', 'Только план · сыгранные даты и путь не меняются.'), details);
    function render() {
        output.replaceChildren(); assumptions.replaceChildren(); copy.textContent = 'Скопировать мастеру';
        const [from, to] = endpoints.map(endpoint => view.atlas.places.find(place => place.id === endpoint.place.value));
        const estimate = estimateTravel(endpoints[0].region.value, endpoints[1].region.value, Number(drive.input.value));
        const valid = Boolean(from && to && from.id !== to.id && estimate);
        copy.disabled = !valid; text.hidden = !valid; copy.hidden = !valid;
        if (!valid) {
            text.value = '';
            const message = !Number.isFinite(Number(drive.input.value)) || Number(drive.input.value) <= 0 ? 'Укажите положительный класс гипердвигателя.'
                : from?.id && from.id === to?.id ? 'Выберите другой мир назначения.' : 'Выберите два мира и их регионы. Неизвестный регион можно задать вручную.';
            output.append(el('p', '', message)); return;
        }
        output.append(el('h3', '', `≈ ${estimate.hours} ч · ${(estimate.hours / 24).toLocaleString('ru', { maximumFractionDigits: 2 })} сут`));
        output.append(el('p', 'wa-travel-formula', `${from.name} → ${to.name} · ${estimate.baseHours} ч × класс ${estimate.hyperdrive}`));
        const dayNumber = Number(day.value), timeKnown = Boolean(time.value);
        const clock = travelDeparture(timing.now, { day: day.value, time: time.value, edited: departureEdited });
        const arrival = projectedArrival(clock, estimate.hours);
        const label = arrival ? timing.format?.(arrival, timing.anchor) || `${arrival.incomplete ? 'Не ранее: ' : ''}≈ День ${arrival.gameDay}${timeKnown ? ` ${String(arrival.hour).padStart(2, '0')}:${String(arrival.minute).padStart(2, '0')}` : ''}` : null;
        if (label) output.append(el('p', 'wa-travel-arrival', `Ожидаемое прибытие: ${label}`));
        else output.append(el('p', 'wa-travel-hint', 'Дата прибытия неизвестна — задайте день вылета.'));
        if (!timeKnown) output.append(el('p', 'wa-travel-hint', 'Час вылета не задан: показан минимальный день прибытия.'));
        const currentDay = Number.isFinite(timing.now?.elapsedHours) ? Math.floor(timing.now.elapsedHours / 24) + 1 : null;
        if (clock && currentDay !== null && (dayNumber < currentDay || (timeKnown && clock.elapsedHours < timing.now.elapsedHours))) output.append(el('p', 'wa-travel-hint', 'Ретроспективная оценка. Явно сыгранное время имеет приоритет; прошлые события не изменяются.'));
        if (timing.now?.incomplete) assumptions.append(el('p', 'wa-travel-hint', 'В текущей дате есть неуточнённые интервалы; расчёт сохраняет эту неопределённость.'));
        if (from.gamePlace || to.gamePlace) assumptions.append(el('p', 'wa-travel-hint', 'Игровая точка: регион и подъезд к ориентиру условны. Местный подъезд и задержки не включены.'));
        const connection = view.network?.resolve(from.id, to.id);
        assumptions.append(el('p', 'wa-travel-hint', connection && !connection.gap ? 'В справочном геослое есть соединение между ориентирами.' : 'Путь в справочном геослое не подтверждён; оценка только по регионам.'));
        assumptions.append(el('p', 'wa-travel-hint', 'Базовый межрегиональный перелёт без задержек и поправок астрогации. Длина линии карты не используется.'));
        text.value = travelPhrase(from.name, to.name, estimate, label);
        const regionAssumptions = endpoints.flatMap((endpoint, index) => {
            const place = [from, to][index], region = travelRegion(place, view.atlas);
            return region.approximate || region.id !== endpoint.region.value
                ? [`${place.name}: ${TRAVEL_REGIONS.find(([id]) => id === endpoint.region.value)[1]} (${endpoint.note.textContent})`] : [];
        });
        if (regionAssumptions.length) text.value += ` Допущения по регионам: ${regionAssumptions.join('; ')}.`;
    }
    drive.input.addEventListener('input', render);
    for (const input of [day, time]) input.addEventListener('input', () => { departureEdited = true; render(); });
    panel.append(heading, body); view.root.append(backdrop, panel); render();
    requestAnimationFrame(() => endpoints[1].place.focus({ preventScroll: true }));
    return panel;
}
