import { loadAtlas, loadReferenceAtlas } from './atlas-data.js';
import { createRouteNetwork, historyRed } from './route-network.js';

let leafletReady;
function loadLeaflet(base) {
    leafletReady ??= new Promise((resolve, reject) => {
        // Keep ST's globals intact if another extension already uses Leaflet.
        const script = document.createElement('script');
        script.src = new URL('vendor/leaflet/leaflet.js', base).href;
        script.onload = () => resolve(window.L.noConflict());
        script.onerror = () => { leafletReady = null; script.remove(); reject(new Error('Не удалось загрузить локальный модуль карты.')); };
        document.head.append(script);
    });
    return leafletReady;
}
const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};
const fold = text => String(text).normalize('NFKC').toLocaleLowerCase('ru').replaceAll('ё', 'е').trim();
const imageColors = new Map();
async function colorFromImage(url) {
    if (imageColors.has(url)) return imageColors.get(url);
    const pending = (async () => {
        const image = new Image();
        image.src = url;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 48;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(image, 0, 0, 48, 48);
        const { data } = ctx.getImageData(0, 0, 48, 48);
        const sum = [0, 0, 0];
        let total = 0;
        for (let i = 0; i < data.length; i += 4) {
            const values = [data[i], data[i + 1], data[i + 2]];
            const high = Math.max(...values), low = Math.min(...values);
            // Exclude transparent pixels, black space and near-white stars.
            if (data[i + 3] < 180 || high < 65 || high - low < 12 || low > 235) continue;
            const weight = (high - low) / 255 * high / 255;
            for (let channel = 0; channel < 3; channel++) sum[channel] += values[channel] * weight;
            total += weight;
        }
        if (!total) return '#b4bcc8';
        const rgb = sum.map(value => value / total);
        // Raise only the display luminance; hue stays tied to the illustration.
        const scale = Math.max(1, 190 / Math.max(...rgb));
        return '#' + rgb.map(value => Math.min(255, Math.round(value * scale)).toString(16).padStart(2, '0')).join('');
    })();
    imageColors.set(url, pending);
    return pending;
}
function assetUrl(value, base) {
    if (!value) return '';
    if (/^data:image\/(png|jpeg|webp);base64,/i.test(value)) return value;
    const url = new URL(value, base);
    if (url.origin !== location.origin || !['http:', 'https:'].includes(url.protocol)) throw new Error('Изображения должны быть локальными или встроенными PNG/JPEG/WebP.');
    return url.href;
}
export function validateAtlas(atlas) {
    if (!atlas || typeof atlas.id !== 'string' || !atlas.id.trim() || typeof atlas.title !== 'string' || !Array.isArray(atlas.places) || !atlas.places.length || atlas.places.length > 2000) throw new Error('Нужен atlas JSON с id, title и places (1–2000).');
    if (!(atlas.width > 0 && atlas.width <= 10000 && atlas.height > 0 && atlas.height <= 10000)) throw new Error('Укажите width/height от 1 до 10000.');
    const ids = new Set();
    for (const place of atlas.places) {
        if (typeof place.id !== 'string' || ids.has(place.id) || typeof place.name !== 'string' || typeof place.shortText !== 'string' || !Number.isFinite(place.x) || !Number.isFinite(place.y) || place.x < 0 || place.x > atlas.width || place.y < 0 || place.y > atlas.height) throw new Error('У точки должны быть уникальный id, name, shortText и x/y внутри карты.');
        ids.add(place.id);
    }
    return atlas;
}

export class AtlasView {
    constructor(options) {
        Object.assign(this, options);
        validateAtlas(this.atlas);
        this.editing = false;
        this.selected = null;
        this.markers = new Map();
    }
    async open() {
        if (!this.root) {
            this.L = await loadLeaflet(this.base);
            await this.prepareColors();
            this.build();
            this.renderMap();
        }
        this.previousFocus = document.activeElement;
        this.root.hidden = false;
        this.previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        requestAnimationFrame(() => {
            this.map.invalidateSize();
            if (!this.initialViewSet) {
                const view = this.atlas.initialView;
                if (view?.fit === 'cover') {
                    const size = this.map.getSize();
                    const zoom = Math.log2(Math.max(size.x / this.atlas.width, size.y / this.atlas.height) * .9);
                    this.map.setView(this.coords(view), Math.max(-3, Math.min(2, zoom)), { animate: false });
                } else if (view && Number.isFinite(view.x) && Number.isFinite(view.y) && Number.isFinite(view.zoom)) this.map.setView(this.coords(view), Math.max(-3, Math.min(2, view.zoom)), { animate: false });
                else this.fitPlaces();
                this.initialViewSet = true;
            }
            this.positionLabels();
            if (this.initialFocus !== false) this.closeButton.focus({ preventScroll: true });
        });
        this.contextChanged();
    }
    close() {
        if (this.root.hidden) return;
        this.editing = false;
        this.root.hidden = true;
        document.body.style.overflow = this.previousOverflow;
        this.previousFocus?.focus({ preventScroll: true });
    }
    button(label, text, handler, className = '') {
        const button = el('button', `wa-button ${className}`, text);
        button.type = 'button';
        button.setAttribute('aria-label', label);
        button.title = label;
        button.addEventListener('click', handler);
        return button;
    }
    build() {
        this.root = el('section', 'world-atlas');
        this.root.hidden = true;
        this.root.setAttribute('role', 'dialog');
        this.root.setAttribute('aria-modal', 'true');
        this.root.setAttribute('aria-label', 'Атлас миров');
        const header = el('header', 'wa-header');
        const titleRow = el('div', 'wa-title-row');
        const branding = el('div', 'wa-brand');
        branding.append(el('span', 'wa-eyebrow', 'WORLD ATLAS'), this.title = el('h1', '', this.atlas.title));
        this.closeButton = this.button('Закрыть атлас', '×', () => this.close(), 'wa-close');
        titleRow.append(branding, this.closeButton);
        const searchRow = el('div', 'wa-search-row');
        const searchIcon = el('span', 'wa-search-icon', '⌕');
        searchIcon.setAttribute('aria-hidden', 'true');
        this.search = el('input', 'wa-search');
        this.search.type = 'search';
        this.search.placeholder = 'Найти планету · RU / EN';
        this.search.setAttribute('aria-label', 'Поиск места на русском или английском');
        this.search.autocomplete = 'off';
        this.search.addEventListener('input', () => this.searchPlaces());
        this.search.addEventListener('focus', () => this.searchPlaces());
        this.search.addEventListener('keydown', event => {
            if (event.key === 'Enter') this.results.querySelector('button')?.click();
            if (event.key === 'Escape') { event.stopPropagation(); this.search.value = ''; this.searchPlaces(); }
        });
        searchRow.append(searchIcon, this.search);
        this.results = el('div', 'wa-results');
        this.results.hidden = true;
        header.append(titleRow, searchRow, this.results);
        this.mapNode = el('div', 'wa-map');
        this.mapNode.setAttribute('aria-label', 'Карта: перемещайте одним пальцем, масштабируйте двумя');
        this.tools = el('nav', 'wa-tools');
        this.tools.setAttribute('aria-label', 'Масштаб карты');
        this.tools.append(this.button('Увеличить', '+', () => this.map.zoomIn()), this.button('Уменьшить', '−', () => this.map.zoomOut()), this.button('Показать всю карту', '⌖', () => this.fit()));
        this.bottom = el('div', 'wa-bottom');
        this.card = el('article', 'wa-card');
        this.card.hidden = true;
        this.card.setAttribute('aria-live', 'polite');
        this.toolbar = el('div', 'wa-toolbar');
        this.editButton = this.button('Редактировать декоративную линию', 'Линия пути', () => this.toggleEdit(), 'wa-route-button');
        this.undoButton = this.button('Убрать последнюю точку линии', '↶', () => this.updateRoute(this.route().slice(0, -1)));
        this.clearButton = this.button('Очистить линию', 'Очистить', () => this.updateRoute([]), 'wa-text-button');
        this.importButton = this.button('Импортировать atlas JSON: заменить карту', 'Карта JSON', () => this.fileInput.click(), 'wa-text-button');
        this.toolbar.append(this.editButton, this.undoButton, this.clearButton, this.importButton);
        if (this.onRouteImport) {
            this.routeFileInput = el('input', 'wa-route-file-input'); this.routeFileInput.type = 'file';
            this.routeFileInput.setAttribute('aria-label', 'Выбрать файл маршрута любого типа');
            // No accept/capture filter: Android must show Telegram/Downloads files.
            this.routeFileInput.addEventListener('change', async () => {
                const file = this.routeFileInput.files?.[0]; this.routeFileInput.value = '';
                if (!file) return;
                await this.submitRouteImport(file);
            });
            this.routeImportButton = this.button('Импорт маршрута и календаря в открытый чат', 'Импорт маршрута и календаря', () => this.showRouteImport(), 'wa-text-button');
            this.toolbar.prepend(this.routeImportButton);
        }
        this.sourceButton = this.button('Отдельно загрузить справочный геослой iSkore / CARTO с raw.githubusercontent.com; права картографии не подтверждены', 'Карта из источника', () => this.loadReference(), 'wa-text-button');
        this.sourceButton.hidden = !this.atlas.schematic;
        this.toolbar.append(this.sourceButton);
        if (this.onHistory) {
            this.historyButton = this.button('Маршрут игрока: обновление, подключение и источники', 'Обновить маршрут', () => this.onHistory(), 'wa-history-button');
            this.toolbar.prepend(this.historyButton);
        }
        this.message = el('p', 'wa-message', 'Условная карта · коснитесь планеты');
        this.message.setAttribute('role', 'status');
        this.bottom.append(this.card, this.toolbar, this.message);
        this.fileInput = el('input');
        this.fileInput.hidden = true;
        this.fileInput.type = 'file';
        this.fileInput.addEventListener('change', () => this.importFile());
        this.root.append(this.mapNode, header, this.tools, this.bottom, this.fileInput);
        this.root.addEventListener('keydown', event => {
            if (event.key === 'Escape') this.close();
            if (event.key === 'Tab') {
                const nodes = [...this.root.querySelectorAll('button,input,textarea,a[href]')].filter(node => !node.hidden && node.getClientRects().length && !node.disabled);
                const first = nodes[0], last = nodes.at(-1);
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
                if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
            }
        });
        document.body.append(this.root);
    }
    showRouteImport() {
        if (!this.onRouteImport) return;
        this.root.querySelector('.wa-history-panel')?.remove();
        this.importPanel?.remove();
        const panel = this.importPanel = el('section', 'wa-import-panel');
        panel.setAttribute('aria-label', 'Импорт маршрута и календаря');
        const heading = el('div', 'wa-history-heading');
        const close = () => { panel.remove(); this.routeImportButton.focus({ preventScroll: true }); };
        heading.append(el('h2', '', 'Импорт в открытый чат'), this.button('Закрыть импорт маршрута', '×', close));
        panel.append(heading, el('p', '', 'Короткий файл WorldAtlas: маршрут и календарь. Сообщения, карточка и WI не заменяются. После импорта доступна отмена.'));
        const fileLabel = el('label', '', 'Выберите файл любого типа');
        fileLabel.append(this.routeFileInput);
        const pasteLabel = el('label', '', 'Или вставьте JSON текстом');
        const text = this.importText = el('textarea', 'wa-route-json');
        text.setAttribute('aria-label', 'JSON маршрута и календаря');
        text.placeholder = 'Откройте короткий JSON как текст, скопируйте всё содержимое и вставьте сюда.';
        text.spellcheck = false;
        pasteLabel.append(text);
        this.importStatus = el('p', 'wa-import-status');
        this.importStatus.setAttribute('role', 'alert');
        const submit = this.button('Импортировать вставленный JSON', 'Импортировать JSON', () => this.submitRouteImport(new File([text.value], 'pasted-route.json', { type: 'application/json' })), 'wa-text-button');
        panel.append(fileLabel, el('p', '', 'Если Android показывает только фото, используйте вставку JSON ниже. Разрешение на буфер обмена не требуется.'), pasteLabel, submit, this.importStatus);
        panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } });
        this.root.append(panel);
        if (!this.canEdit()) this.importStatus.textContent = 'Сначала откройте нужный чат в SillyTavern.';
        heading.querySelector('button').focus({ preventScroll: true });
    }
    async submitRouteImport(file) {
        if (this.importBusy) return;
        this.importBusy = true;
        const panel = this.importPanel, status = this.importStatus;
        if (status) status.textContent = 'Проверка JSON…';
        try {
            await this.onRouteImport(file);
            panel?.remove();
        } catch (error) {
            const message = `Импорт маршрута: ${error.message}`;
            if (status) status.textContent = message;
            else this.message.textContent = message;
        } finally { this.importBusy = false; }
    }
    coords(point) { return [this.atlas.height - point.y, point.x]; }
    async prepareColors() {
        await Promise.all(this.atlas.places.map(async place => {
            const url = assetUrl(place.image || 'assets/landscape-card.svg', this.base);
            try { place.imageColor = await colorFromImage(url); }
            catch { place.imageColor = '#b4bcc8'; }
        }));
    }
    renderMap() {
        const { L } = this;
        this.map?.remove();
        this.map = L.map(this.mapNode, { crs: L.CRS.Simple, zoomControl: false, attributionControl: false, minZoom: -3, maxZoom: 5, zoomSnap: 0.25, touchZoom: true, maxBoundsViscosity: 0.8 });
        const bounds = [[0, 0], [this.atlas.height, this.atlas.width]];
        this.map.setMaxBounds([[-this.atlas.height * .3, -this.atlas.width * .3], [this.atlas.height * 1.3, this.atlas.width * 1.3]]);
        if (this.atlas.background) L.imageOverlay(assetUrl(this.atlas.background, this.base), bounds, { interactive: false, opacity: this.atlas.backgroundOpacity ?? 1 }).addTo(this.map);
        this.renderReference();
        this.network = this.atlas.context?.paths?.length ? createRouteNetwork(this.atlas.context.paths, this.atlas.places) : null;
        this.routeLayer = L.layerGroup().addTo(this.map);
        this.markers.clear();
        for (const place of this.atlas.places) {
            const node = el('div', 'wa-pin-content');
            node.style.setProperty('--wa-planet', place.imageColor);
            const dot = el('span', 'wa-pin-dot');
            const name = el('span', 'wa-pin-name', place.name);
            node.append(dot, name);
            const marker = L.marker(this.coords(place), { icon: L.divIcon({ className: 'wa-pin', html: node, iconSize: [48, 48], iconAnchor: [24, 24] }), title: place.name, keyboard: true, riseOnHover: true });
            marker.on('click', () => this.select(place));
            marker.addTo(this.map);
            marker.getElement()?.setAttribute('aria-label', `Открыть: ${place.name}`);
            this.markers.set(place.id, marker);
        }
        this.map.on('zoomend', () => this.mapNode.classList.toggle('wa-distant', this.map.getZoom() < -1.6));
        this.map.on('moveend', () => this.positionLabels());
        this.drawRoute();
    }
    renderReference() {
        const { L } = this;
        const context = this.atlas.context;
        if (!context) return;
        this.map.createPane('wa-reference').style.zIndex = '250';
        const renderer = L.canvas({ pane: 'wa-reference', padding: .2 });
        const foreground = new Set(this.atlas.places.map(place => place.sourcePointId).filter(Boolean));
        this.referenceLayer = L.layerGroup().addTo(this.map);
        for (const path of context.paths ?? []) {
            L.polyline(path.points.map(([x, y]) => this.coords({ x, y })), {
                renderer, interactive: false, color: path.tier === 1 ? '#8cb5bf' : '#7799a6',
                opacity: path.tier === 1 ? .37 : .21, weight: path.tier === 1 ? 1 : .65,
                smoothFactor: .65,
            }).addTo(this.referenceLayer);
        }
        for (const point of context.points ?? []) {
            if (foreground.has(point.id)) continue;
            L.circleMarker(this.coords(point), { renderer, interactive: false, radius: 1.15,
                stroke: false, fillColor: '#b0c0ce', fillOpacity: .35 }).addTo(this.referenceLayer);
        }
    }
    fit() {
        this.map.fitBounds([[0, 0], [this.atlas.height, this.atlas.width]], { paddingTopLeft: [22, 118], paddingBottomRight: [22, 100], animate: false });
    }
    fitPlaces() {
        this.map.fitBounds(this.atlas.places.map(place => this.coords(place)), { paddingTopLeft: [36, 145], paddingBottomRight: [105, 110], animate: false });
    }
    positionLabels() {
        const occupied = [];
        const priority = [...this.markers].sort(([a], [b]) => (b === this.selected) - (a === this.selected)
            || (this.atlas.places.find(p => p.id === a)?.labelPriority ?? 99) - (this.atlas.places.find(p => p.id === b)?.labelPriority ?? 99));
        let count = 0;
        const limit = this.map.getZoom() >= 1 ? 30 : (this.mapNode.clientWidth < 700 ? 10 : 18);
        for (const [id, marker] of priority) {
            const point = this.map.latLngToContainerPoint(marker.getLatLng());
            const node = marker.getElement();
            node?.classList.remove('wa-label-hidden');
            const label = node?.querySelector('.wa-pin-name');
            const width = label?.getBoundingClientRect().width || 70;
            const left = point.x + width + 10 > this.mapNode.clientWidth - 12;
            node?.classList.toggle('wa-label-left', left);
            const rect = { x: left ? point.x - width - 10 : point.x + 10, y: point.y - 10, width, height: 22 };
            const overlap = occupied.some(r => rect.x < r.x + r.width && rect.x + rect.width > r.x && rect.y < r.y + r.height && rect.y + rect.height > r.y);
            const underTools = rect.x + rect.width > this.mapNode.clientWidth - 73 && rect.y < 310 && rect.y + rect.height > 135;
            const inBounds = rect.x >= 10 && rect.x + rect.width <= this.mapNode.clientWidth - 10;
            const visible = id === this.selected || (!overlap && !underTools && inBounds && count < limit && point.y > 130 && point.y < this.mapNode.clientHeight - 80 && point.x > 12 && point.x < this.mapNode.clientWidth - 12);
            node?.classList.toggle('wa-label-hidden', !visible);
            if (visible) { occupied.push(rect); count++; }
        }
    }
    select(place, center = false) {
        this.selected = place.id;
        for (const [id, marker] of this.markers) marker.getElement()?.classList.toggle('wa-selected', id === place.id);
        this.search.value = '';
        this.results.hidden = true;
        this.card.replaceChildren();
        const image = el('div', 'wa-card-image');
        image.style.backgroundImage = `url("${assetUrl(place.image || 'assets/landscape-card.svg', this.base)}")`;
        const imageOverlay = el('div', 'wa-card-image-overlay');
        imageOverlay.append(el('span', 'wa-eyebrow', place.region || 'КАРТОЧКА МИРА'), el('h2', '', place.name));
        const hide = this.button('Свернуть карточку', '⌄', () => { this.card.hidden = true; this.root.classList.remove('wa-has-card'); }, 'wa-card-close');
        image.append(imageOverlay, hide);
        const body = el('div', 'wa-card-body');
        if (place.subtitle || this.atlas.era) body.append(el('p', 'wa-card-meta', [place.subtitle, this.atlas.era].filter(Boolean).join(' · ')));
        const nearby = this.atlas.places.filter(other => other.id !== place.id && this.map.latLngToContainerPoint(this.coords(other)).distanceTo(this.map.latLngToContainerPoint(this.coords(place))) < 20);
        if (nearby.length) {
            const row = el('div', 'wa-nearby');
            row.append(el('span', '', 'Рядом на карте:'));
            for (const other of nearby.slice(0, 4)) row.append(this.button(`Открыть ${other.name}`, other.name, () => this.select(other), 'wa-nearby-button'));
            body.append(row);
        }
        body.append(el('p', 'wa-card-text', place.shortText));
        if (place.eraNote) body.append(el('p', 'wa-era-note', place.eraNote));
        if (place.continuityNote) body.append(el('p', 'wa-era-note', place.continuityNote));
        if (place.mapNote) body.append(el('p', 'wa-era-note', place.mapNote));
        if (place.detailText) {
            const details = el('details', 'wa-details');
            details.append(el('summary', '', 'Подробнее'), el('p', 'wa-card-text', place.detailText));
            details.addEventListener('toggle', () => this.keepSelectedVisible());
            body.append(details);
        }
        if (this.editing) body.append(this.button('Добавить выбранную планету в линию', '+ В линию пути', () => this.addSelected(), 'wa-add-point'));
        const links = el('div', 'wa-sources');
        for (const source of place.sourceUrls ?? []) {
            try {
                const url = new URL(source);
                if (!['http:', 'https:'].includes(url.protocol)) continue;
                const link = el('a', '', 'Источник ↗'); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; links.append(link);
            } catch { /* An optional malformed source never prevents reading. */ }
        }
        if (links.childElementCount) body.append(links);
        this.card.append(image, body);
        this.card.hidden = false;
        this.root.classList.add('wa-has-card');
        this.positionLabels();
        if (center) this.map.setView(this.coords(place), Math.max(this.map.getZoom(), -0.7), { animate: false });
        this.keepSelectedVisible();
    }
    keepSelectedVisible() {
        const place = this.atlas.places.find(point => point.id === this.selected);
        if (!place || this.card.hidden) return;
        const bottom = this.root.getBoundingClientRect().bottom - this.card.getBoundingClientRect().top + 35;
        this.map.panInside(this.coords(place), { paddingTopLeft: [50, 155], paddingBottomRight: [65, bottom], animate: false });
    }
    searchPlaces() {
        const query = fold(this.search.value);
        this.results.replaceChildren();
        if (!query && document.activeElement !== this.search) { this.results.hidden = true; return; }
        const matches = this.atlas.places.filter(place => [place.name, ...(place.aliases ?? [])].some(name => fold(name).includes(query))).slice(0, query ? 8 : 100);
        for (const place of matches) {
            const button = this.button(`Открыть ${place.name}`, place.name, () => { this.search.blur(); this.select(place, true); }, 'wa-search-result');
            button.append(el('span', '', (place.aliases ?? []).find(name => /[a-z]/i.test(name)) || place.region || ''));
            this.results.append(button);
        }
        if (!matches.length) this.results.append(el('p', '', 'Пока нет такой точки.'));
        this.results.hidden = false;
    }
    contextChanged() {
        if (!this.root) return;
        this.editing = false;
        this.renderEdit();
        this.card.querySelector('.wa-add-point')?.remove();
        this.drawRoute();
    }
    toggleEdit() {
        if (!this.canEdit()) { this.message.textContent = 'Откройте чат для своей линии пути.'; return; }
        this.editing = !this.editing;
        this.renderEdit();
        if (this.selected) this.select(this.atlas.places.find(place => place.id === this.selected));
    }
    renderEdit() {
        this.root.classList.toggle('wa-editing', this.editing);
        this.editButton.textContent = this.editing ? '✓ Готово' : 'Линия пути';
        this.editButton.setAttribute('aria-pressed', String(this.editing));
        this.undoButton.hidden = this.clearButton.hidden = !this.editing;
        this.message.textContent = this.editing ? 'Выберите планету → «В линию пути»' : this.routeStatus();
    }
    addSelected() {
        const points = this.route();
        if (points.at(-1) === this.selected) return;
        this.updateRoute([...points, this.selected]);
    }
    async updateRoute(points) {
        if (!this.editing) return;
        try { await this.saveRoute(points); this.drawRoute(); this.message.textContent = this.routeStatus(); }
        catch (error) { this.message.textContent = error.message; }
    }
    drawRoute() {
        if (!this.routeLayer) return;
        this.routeLayer.clearLayers();
        this.routeGaps = [];
        this.unmappedRouteStops = false;
        const points = this.displayPoints?.() || this.route().map(id => this.atlas.places.find(place => place.id === id)).filter(Boolean);
        for (let i = 1; i < points.length; i++) {
            if (!points[i - 1].id || !points[i].id) { this.unmappedRouteStops = true; continue; }
            const age = points.length === 2 ? 1 : (i - 1) / (points.length - 2);
            const resolved = this.network?.resolve(points[i - 1].id, points[i].id);
            if (!resolved || resolved.gap) {
                this.routeGaps.push({ from: points[i - 1], to: points[i] });
                continue;
            }
            const latlngs = resolved.segments.map(segment => segment.points.map(([x, y]) => this.coords({ x, y })));
            const color = historyRed(age);
            this.L.polyline(latlngs, { color, weight: 6, opacity: .08, interactive: false, className: 'wa-route-halo' }).addTo(this.routeLayer);
            this.L.polyline(latlngs, { color, weight: 2.4, opacity: .94, lineCap: 'round', interactive: false, className: 'wa-route-history' }).addTo(this.routeLayer);
        }
        const currentId = this.currentPlaceId ? this.currentPlaceId() : points.at(-1)?.id;
        const current = this.atlas.places.find(place => place.id === currentId);
        if (current) this.L.circleMarker(this.coords(current), { radius: 11, color: current.imageColor, weight: 1.4, fill: false, interactive: false, className: 'wa-player-position' }).addTo(this.routeLayer);
        if (!this.editing && this.message) this.message.textContent = this.routeStatus();
    }
    routeStatus() {
        const current = this.atlas.places.find(place => place.id === this.route().at(-1));
        const position = this.onHistory ? `${this.positionLabel?.() || (current ? `Вы: ${current.name}` : 'Место игрока неизвестно')} · ` : '';
        if (this.routeGaps?.length) {
            const gap = this.routeGaps[0];
            return `${position}Разрыв: ${gap.from.name} → ${gap.to.name} · в исходном слое нет соединения${this.routeGaps.length > 1 ? ` · ещё ${this.routeGaps.length - 1}` : ''}`;
        }
        return position ? `${position}${this.unmappedRouteStops ? 'часть пути вне карты' : `${this.route().length} отмеченных остановок`}` : this.atlas.descriptionShort || 'Коснитесь планеты';
    }
    async importFile() {
        const file = this.fileInput.files?.[0];
        this.fileInput.value = '';
        if (!file) return;
        try {
            if (file.size > 8 * 1024 * 1024) throw new Error('Лимит atlas JSON — 8 МБ.');
            const atlas = validateAtlas(await loadAtlas(JSON.parse(await file.text()), this.base));
            if (atlas.background) assetUrl(atlas.background, this.base);
            for (const place of atlas.places) if (place.image) assetUrl(place.image, this.base);
            await this.replaceAtlas(atlas);
            this.message.textContent = `Загружено мест: ${atlas.places.length}`;
        } catch (error) { this.message.textContent = `Импорт: ${error.message}`; }
    }
    async replaceAtlas(atlas) {
        this.atlas = atlas;
        await this.prepareColors();
        this.title.textContent = atlas.title;
        this.sourceButton.hidden = !atlas.schematic;
        this.selected = null;
        this.card.hidden = true;
        this.root.classList.remove('wa-has-card');
        this.renderMap(); this.fit(); this.contextChanged();
        await this.onImport(atlas);
    }
    async loadReference() {
        if (this.sourceButton.disabled) return;
        this.sourceButton.disabled = true;
        this.message.textContent = 'Загружаем геослой напрямую из внешнего источника…';
        try {
            await this.replaceAtlas(validateAtlas(await loadReferenceAtlas(this.base)));
            this.message.textContent = 'Справочная карта загружена отдельно; источник и ограничения — в README.';
        } catch (error) { this.message.textContent = `${error.message} Каталог и импорт JSON доступны.`; }
        finally { this.sourceButton.disabled = false; }
    }
}
