// Connect stops using existing line geometry only. No travel time or world simulation.
export function createRouteNetwork(paths, places, snapDistance = 1) {
    const graph = new Map(), segments = [], anchors = new Map(), cache = new Map();
    const key = point => `${point[0].toFixed(2)},${point[1].toFixed(2)}`;
    const link = (a, b, points, name) => {
        if (!graph.has(a)) graph.set(a, []);
        if (!graph.has(b)) graph.set(b, []);
        const length = Math.hypot(points[1][0] - points[0][0], points[1][1] - points[0][1]);
        graph.get(a).push({ to: b, length, points, name });
        graph.get(b).push({ to: a, length, points: [...points].reverse(), name });
    };
    for (const path of paths ?? []) for (let i = 1; i < path.points.length; i++) {
        const a = path.points[i - 1], b = path.points[i];
        segments.push({ a, b, name: path.name, stops: [] });
    }
    for (const place of places) {
        let closest;
        for (const segment of segments) {
            const { a, b } = segment;
            const dx = b[0] - a[0], dy = b[1] - a[1];
            const t = Math.max(0, Math.min(1, ((place.x - a[0]) * dx + (place.y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
            const point = [a[0] + t * dx, a[1] + t * dy];
            const distance = Math.hypot(place.x - point[0], place.y - point[1]);
            if (!closest || distance < closest.distance) closest = { segment, point, distance, t };
        }
        if (!closest || closest.distance > snapDistance) continue;
        const anchor = `stop:${place.id}`;
        anchors.set(place.id, { node: anchor, snapDistance: closest.distance });
        closest.segment.stops.push({ node: anchor, point: closest.point, t: closest.t });
    }
    for (const segment of segments) {
        // Split at every stop projection in order. Stops on the same source segment
        // connect directly to their neighbours, without a detour via its endpoints.
        const chain = [{ node: key(segment.a), point: segment.a, t: 0 },
            ...segment.stops.sort((a, b) => a.t - b.t),
            { node: key(segment.b), point: segment.b, t: 1 }];
        for (let i = 1; i < chain.length; i++) link(chain[i - 1].node, chain[i].node,
            [chain[i - 1].point, chain[i].point], segment.name);
    }
    function resolve(from, to) {
        const pair = `${from}>${to}`;
        if (cache.has(pair)) return cache.get(pair);
        const start = anchors.get(from)?.node, end = anchors.get(to)?.node;
        if (!start || !end) return { gap: true, reason: 'В исходной карте нет линии у выбранного мира.' };
        const distances = new Map([[start, 0]]), previous = new Map(), heap = [];
        const push = item => {
            heap.push(item);
            let i = heap.length - 1;
            while (i > 0) { const parent = (i - 1) >> 1; if (heap[parent].distance <= item.distance) break; heap[i] = heap[parent]; i = parent; }
            heap[i] = item;
        };
        const pop = () => {
            const first = heap[0], last = heap.pop();
            if (heap.length) {
                let i = 0;
                while (i * 2 + 1 < heap.length) {
                    let child = i * 2 + 1;
                    if (child + 1 < heap.length && heap[child + 1].distance < heap[child].distance) child++;
                    if (heap[child].distance >= last.distance) break;
                    heap[i] = heap[child]; i = child;
                }
                heap[i] = last;
            }
            return first;
        };
        push({ node: start, distance: 0 });
        while (heap.length) {
            const current = pop();
            if (current.distance !== distances.get(current.node)) continue;
            if (current.node === end) break;
            for (const edge of graph.get(current.node) ?? []) {
                const distance = current.distance + edge.length;
                if (distance >= (distances.get(edge.to) ?? Infinity)) continue;
                distances.set(edge.to, distance); previous.set(edge.to, { from: current.node, edge });
                push({ node: edge.to, distance });
            }
        }
        if (!distances.has(end)) { const result = { gap: true, reason: 'В исходной карте эти части сети не соединены.' }; cache.set(pair, result); return result; }
        const edges = [];
        for (let node = end; node !== start;) {
            const step = previous.get(node); edges.push(step.edge); node = step.from;
        }
        const result = { gap: false, segments: edges.reverse(), length: distances.get(end) };
        cache.set(pair, result);
        return result;
    }
    return { resolve, anchors, nodeCount: graph.size, segmentCount: segments.length };
}

export function historyRed(age) {
    const oldest = [136, 43, 49], newest = [239, 91, 91];
    return '#' + oldest.map((value, i) => Math.round(value + (newest[i] - value) * age).toString(16).padStart(2, '0')).join('');
}
