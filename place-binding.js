// Per-chat links are an overlay: never rewrite extracted chronology or aliases.
// A model's array position, date and chosen planet are deliberately not identity.
// Two independent 32-bit streams keep metadata compact; this is an identity
// fingerprint for local data, not a security boundary or a copy of the sources.
export function bindingFingerprint(value) {
    let first = 2166136261, second = 0x9e3779b9;
    for (const char of String(value)) {
        const code = char.codePointAt(0);
        first = Math.imul(first ^ code, 16777619);
        second = Math.imul(second ^ code, 0x85ebca6b);
    }
    return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}
function quoteAnchor(event, source) {
    const quote = event.quote?.trim();
    if (!quote) return null;
    const texts = [...(source.originals || []).filter(item => (event.sourceIds || []).includes(item.id)), { id: 'l0', text: source.text }];
    for (const item of texts) {
        const start = item.text.indexOf(quote);
        if (start >= 0 && start === item.text.lastIndexOf(quote)) return { source: source.id, text: item.id, start, end: start + quote.length,
            status: event.status || 'arrived' };
    }
    return null;
}
export function samePlaceEpisode(first, second) {
    return Boolean(first && second && first.source === second.source && first.text === second.text && first.status === second.status
        && Math.max(first.start, second.start) < Math.min(first.end, second.end));
}
export function changePlaceBinding(state, row, placeId, sourcePointId = null) {
    const placeBindings = { ...(state.placeBindings || {}) };
    if (placeId) placeBindings[row.bindingKey] = { placeId, guard: row.bindingGuard, anchor: row.bindingAnchor };
    else delete placeBindings[row.bindingKey];
    return { placeBindings, boundSourcePointIds: [...new Set([...(state.boundSourcePointIds || []), ...(sourcePointId ? [sourcePointId] : [])])] };
}
export function currentEventPlace(events) {
    const last = events.at(-1);
    return last?.status === 'departed' || last?.boundaryUncertain ? null : last?.placeId || null;
}
export function identifyPlaceEvents(events, history) {
    const evidence = history.bindingEvidence || history.evidence || [];
    const identified = events.map(event => {
        const source = evidence.find(source => source.id === event.source);
        let key, guard, anchor;
        if (event.method === 'import' && history.bindingImport) {
            key = JSON.stringify(['import', event.id, event.source]);
            guard = bindingFingerprint(JSON.stringify([history.bindingImport.events, history.bindingImport.calendar.rows]));
        } else if (source && event.quote?.trim()) {
            key = JSON.stringify(['evidence', source.id, bindingFingerprint(event.quote.trim()), event.status || 'arrived', [...(event.sourceIds || [])].sort()]);
            guard = bindingFingerprint(JSON.stringify([source.text, (source.originals || []).map(item => [item.id, item.text])]));
            anchor = quoteAnchor(event, source);
        }
        return { ...event, bindingKey: key || null, bindingGuard: guard || null, bindingAnchor: anchor || null };
    });
    const counts = new Map();
    for (const event of identified) if (event.bindingKey) counts.set(event.bindingKey, (counts.get(event.bindingKey) || 0) + 1);
    // Indistinguishable evidence must not attach a choice to an arbitrary episode.
    return identified.map(event => counts.get(event.bindingKey) > 1 ? { ...event, bindingKey: null } : event);
}

export function applyPlaceBindings(events, bindings = {}, atlas) {
    return events.map(event => {
        const matches = Object.entries(bindings).filter(([key, binding]) => event.bindingKey && binding.guard === event.bindingGuard
            && (key === event.bindingKey || (samePlaceEpisode(binding.anchor, event.bindingAnchor)
                && events.filter(other => samePlaceEpisode(binding.anchor, other.bindingAnchor)).length === 1)));
        const [key, binding] = matches.length === 1 ? matches[0] : [];
        const place = binding?.guard === event.bindingGuard && atlas.places.find(place => place.id === binding.placeId);
        return place ? { ...event, bindingKey: key, placeId: place.id, boundPlaceName: place.name, manualPlace: true } : event;
    });
}

export function placeCalendarRows(rows, events, history, bindings, atlas) {
    const calendarTargets = applyPlaceBindings(identifyPlaceEvents(rows, history), bindings, atlas);
    return rows.map((row, index) => {
        const matches = events.filter(event => event.source === row.source && (row.quote
            ? event.quote === row.quote && event.status === row.status : event.offset === row.offset));
        const event = matches.length === 1 ? matches[0] : null;
        let target = event;
        if (!event && row.quote) target = calendarTargets[index];
        // A timing-only row can be linked for viewing, but is never an arrival.
        if (!event && row.offset === -1) {
            const source = (history.bindingEvidence || history.evidence || []).find(source => source.id === row.source);
            if (source) target = { bindingKey: JSON.stringify(['calendar', source.id]),
                bindingGuard: bindingFingerprint(JSON.stringify([source.text, (source.originals || []).map(item => [item.id, item.text])])) };
            else if (history.bindingImport && rows.filter(other => other.source === row.source && other.offset === row.offset).length === 1)
                target = { bindingKey: JSON.stringify(['calendar-import', row.source, row.offset]),
                    bindingGuard: bindingFingerprint(JSON.stringify(history.bindingImport.calendar.rows)) };
        }
        const bound = !event && row.offset === -1 && !row.quote && target ? applyPlaceBindings([target], bindings, atlas)[0] : target;
        const placeId = bound?.placeId || row.placeId;
        const place = atlas.places.find(place => place.id === placeId);
        return { ...row, bindingKey: target?.bindingKey || null, bindingGuard: target?.bindingGuard || null,
            bindingAnchor: target?.bindingAnchor || null,
            placeId: place?.id || null, hasCoordinates: Number.isFinite(place?.x) && Number.isFinite(place?.y),
            manualPlace: Boolean(bound?.manualPlace), boundPlaceName: bound?.manualPlace ? place.name : null };
    });
}
