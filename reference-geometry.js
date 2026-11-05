// Coordinate conversion only; no third-party coordinates are bundled here.
export const referenceSource = 'https://github.com/iSkore/star-wars-galaxy/tree/27866d88e6fa8bf6e0ca39d08afadb3a5b49a110/data';
const rawBase = 'https://raw.githubusercontent.com/iSkore/star-wars-galaxy/27866d88e6fa8bf6e0ca39d08afadb3a5b49a110/data/';

export function prepareReference(planets, lanes) {
    const pointFeatures = planets.features.filter(feature => feature.geometry?.type === 'Point'
        && feature.geometry.coordinates.length === 2 && feature.geometry.coordinates.every(Number.isFinite));
    const sourceLines = lanes.features.flatMap((feature, featureIndex) =>
        feature.geometry.coordinates.map((coordinates, index) => ({ feature, featureIndex, index, coordinates })));
    const project = ([longitude, latitude]) => [longitude, 180 / Math.PI * Math.log(Math.tan(Math.PI / 4 + latitude * Math.PI / 360))];
    const coordinates = [...pointFeatures.map(feature => feature.geometry.coordinates), ...sourceLines.flatMap(line => line.coordinates)].map(project);
    const xs = coordinates.map(point => point[0]), ys = coordinates.map(point => point[1]);
    const extent = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    const size = 1600, padding = 80;
    const scale = (size - 2 * padding) / Math.max(extent[2] - extent[0], extent[3] - extent[1]);
    const offsetX = (size - (extent[2] - extent[0]) * scale) / 2;
    const offsetY = (size - (extent[3] - extent[1]) * scale) / 2;
    const round = value => Math.round(value * 1000) / 1000;
    function xy(coordinate) {
        const [x, y] = project(coordinate);
        return [round(offsetX + (x - extent[0]) * scale), round(offsetY + (extent[3] - y) * scale)];
    }
    const points = pointFeatures.map(feature => {
        const [x, y] = xy(feature.geometry.coordinates);
        return { id: `source-${feature.properties.id}`, name: feature.properties.planet, x, y,
            grid: feature.properties.grid, region: feature.properties.region };
    });
    const paths = sourceLines.map(({ feature, featureIndex, index, coordinates }) => ({
        id: `lane-${featureIndex}-${index}`, name: feature.properties.hyperspace,
        tier: Number(feature.properties.zoom_level), points: coordinates.map(xy),
    }));
    const provenance = { source: referenceSource,
        upstream: 'Henry Bernberg / CARTO; upstream software license does not clear underlying cartography.',
        status: 'Obtained separately by the user; not distributed by WorldAtlas. Underlying map rights remain unconfirmed.',
        coordinateTransform: 'Shared inverse WGS84/Mercator, uniform scale and y inversion; no properties.x/y.',
        inputExtentProjected: extent, scale, offsetX, offsetY, padding,
        sourcePlanetRecords: planets.features.length, locatedPoints: points.length,
        unlocatedRecords: planets.features.length - points.length,
        sourceLineFeatures: lanes.features.length, lineStrings: paths.length,
        vertices: paths.reduce((sum, line) => sum + line.points.length, 0),
        distinctRouteNames: new Set(paths.map(line => line.name).filter(Boolean)).size,
        eraNote: 'Mixed source-era Canon/Legends; not a verified 22BBY transport network.' };
    return { version: 1, width: size, height: size, provenance, points, paths };
}

// Runs only after an explicit user click. No proxy, model request or server plugin.
export async function downloadReference() {
    const results = await Promise.all(['planets.geojson', 'hyperspace-lanes.geojson'].map(async file => {
        const response = await fetch(rawBase + file, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(60000) });
        if (!response.ok) throw new Error(`Источник карты: HTTP ${response.status}. Можно импортировать свой atlas JSON через ⋯.`);
        return response.json();
    }));
    return prepareReference(...results);
}
