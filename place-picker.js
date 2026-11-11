const el = (tag, className, text) => {
    const node = document.createElement(tag); node.className = className || '';
    if (text !== undefined) node.textContent = text;
    return node;
};

export function showPlacePicker(panel, row, controls, saved, trigger) {
    const overlay = el('div', 'wa-place-overlay'), sheet = el('section', 'wa-place-sheet');
    sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', row.manualPlace ? 'Изменить привязку' : 'Выбрать планету');
    let selected = row.placeId || null, busy = false;
    const button = (text, action, className = '') => {
        const node = el('button', `wa-place-button ${className}`, text); node.type = 'button';
        node.addEventListener('click', action); return node;
    };
    const close = () => {
        if (busy) return;
        overlay.remove(); panel.inert = false; panel.picker = null;
        trigger?.focus({ preventScroll: true });
    };
    // Calendar/chat teardown may close the view even while a metadata save finishes.
    panel.picker = { close: () => { overlay.remove(); panel.inert = false; panel.picker = null; } };
    const heading = el('header', 'wa-place-header'), title = el('div', 'wa-place-title');
    const back = button('Назад', close);
    title.append(el('h2', '', row.manualPlace ? 'Изменить привязку' : 'Выбрать планету'), back);
    const context = el('p', 'wa-place-context');
    context.append(document.createTextNode('В истории: '), el('strong', '', row.place || row.placeName || 'Место не указано'),
        el('small', '', `${row.clock?.label || row.date?.text || 'Дата не установлена'} · ${row.source || 'Источник не указан'}`));
    const label = el('label', 'wa-place-search-label', 'Название на русском или английском');
    const search = el('input', 'wa-place-search'); search.type = 'search'; search.autocomplete = 'off';
    search.placeholder = 'Поиск по названиям карты'; label.append(search);
    heading.append(title, context, label);
    const options = el('div', 'wa-place-options'); options.setAttribute('role', 'radiogroup'); options.setAttribute('aria-label', 'Планеты');
    const footer = el('footer', 'wa-place-footer'), help = el('p', 'wa-place-help');
    help.setAttribute('role', 'status');
    const confirm = button(row.manualPlace ? 'Сохранить привязку' : 'Привязать запись', () => commit(selected), 'wa-place-primary');
    const remove = row.manualPlace ? button('Снять ручную привязку', () => commit(null), 'wa-place-remove') : null;
    footer.append(help, confirm); if (remove) footer.append(remove);
    sheet.append(el('div', 'wa-cal-handle'), heading, options, footer); overlay.append(sheet);
    panel.parentElement.append(overlay); panel.inert = true;
    let candidates = [];
    function updateFooter() {
        const point = controls.places('').find(place => place.id === selected);
        confirm.disabled = busy || !point || (row.manualPlace && point.id === row.placeId);
        help.textContent = point ? point.sourcePlace && !controls.activePlaceIds().includes(point.id)
            ? `Точка ${point.name} будет добавлена в эту игру. Привяжется только эта запись.`
            : 'Изменится только привязка этой записи.' : 'Выберите точку для этой записи.';
    }
    function renderOptions() {
        options.replaceChildren(); candidates = controls.places(search.value);
        const activeIds = new Set(controls.activePlaceIds());
        let shown = 0;
        for (const active of [true, false]) {
            const group = candidates.filter(place => activeIds.has(place.id) === active);
            if (!group.length) continue;
            options.append(el('h3', 'wa-place-group', `${active ? 'В этой игре' : 'На базовой карте'} · ${group.length}`));
            const list = el('div'); options.append(list);
            let count = 0;
            const more = button('Показать ещё', append, 'wa-place-more');
            function append() {
                for (const point of group.slice(count, count + 50)) {
                    const label = el('label', 'wa-place-option'), input = el('input');
                    input.type = 'radio'; input.name = 'wa-event-place'; input.value = point.id; input.checked = point.id === selected;
                    input.addEventListener('change', () => { selected = point.id; updateFooter(); });
                    const text = el('span', 'wa-place-option-text'); text.append(el('strong', '', point.name));
                    const aliases = (point.aliases || []).filter(name => /[а-яё]/iu.test(name) && name !== point.name);
                    if (aliases.length) text.append(el('span', '', aliases.join(' · ')));
                    text.append(el('small', '', [point.region, point.grid, point.gamePlace ? 'Игровое место' : point.sourcePlace ? 'Базовая карта' : 'Карточка мира'].filter(Boolean).join(' · ')));
                    label.append(input, text); list.append(label);
                }
                count += 50; more.hidden = count >= group.length;
            }
            append(); options.append(more); shown += group.length;
        }
        if (!shown) options.append(el('p', 'wa-place-empty', 'Точка не найдена. Попробуйте название на карте или нажмите «Назад».'));
        updateFooter();
    }
    async function commit(id) {
        if (busy || (id !== null && confirm.disabled)) return;
        busy = true; back.disabled = search.disabled = confirm.disabled = true;
        if (remove) remove.disabled = true;
        for (const input of options.querySelectorAll('input,button')) input.disabled = true;
        help.textContent = 'Сохранение…';
        try {
            const undo = await controls.bind(row, id);
            busy = false; close();
            if (panel.isConnected) saved(id ? 'Привязка сохранена.' : 'Ручная привязка снята.', undo, row.bindingKey);
        } catch (error) {
            busy = false; back.disabled = search.disabled = false; if (remove) remove.disabled = false;
            for (const input of options.querySelectorAll('input,button')) input.disabled = false;
            updateFooter(); help.textContent = error.message || 'Не удалось сохранить привязку.';
        }
    }
    search.addEventListener('input', renderOptions);
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    overlay.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); close(); }
        if (event.key === 'Tab') {
            const nodes = [...sheet.querySelectorAll('button:not(:disabled):not([hidden]),input:not(:disabled)')];
            const first = nodes[0], last = nodes.at(-1);
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
    });
    renderOptions(); back.focus({ preventScroll: true });
}
