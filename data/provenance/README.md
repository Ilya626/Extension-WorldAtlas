# Cartography is obtained separately

The public repository and release contain **no iSkore/CARTO coordinates, line geometry, source map image or derivative coordinate table**. The included30 cards open on an original catalogue grid, explicitly not geography. Card order and grid positions do not come from the external map.

**Карта из источника** makes two browser GETs directly to the pinned upstream files, only after the user clicks:

- https://raw.githubusercontent.com/iSkore/star-wars-galaxy/27866d88e6fa8bf6e0ca39d08afadb3a5b49a110/data/planets.geojson
- https://raw.githubusercontent.com/iSkore/star-wars-galaxy/27866d88e6fa8bf6e0ca39d08afadb3a5b49a110/data/hyperspace-lanes.geojson

No model API, mirror, account, server plugin or embedded credentials are involved. Geometry is converted in the browser and saved in this user's ST extension settings. Updates do not remove it. A network failure leaves the catalogue usable; **⋯** can import a local atlas JSON instead. The preview keeps downloads in memory only.

## Rights decision (checked2026-11-06)

The [upstream repository](https://github.com/iSkore/star-wars-galaxy) describes itself as a clone of swgalaxymap.com. Its [NOTES.md](https://github.com/iSkore/star-wars-galaxy/blob/27866d88e6fa8bf6e0ca39d08afadb3a5b49a110/NOTES.md) points to Henry Bernberg's CARTO data. Its [MIT license](https://github.com/iSkore/star-wars-galaxy/blob/27866d88e6fa8bf6e0ca39d08afadb3a5b49a110/LICENSE) is a software grant, not an explicit, independently verified license from all underlying cartographic rights holders. **WorldAtlas does not claim these map data are MIT, CC0 or otherwise cleared for redistribution.** They are excluded from both the public snapshot and its Git ancestry. Local development history remains private.

An external download accesses the existing source; it does not clear redistribution rights. Availability/CORS and the source's own conditions remain external limitations. Users may instead supply a map they own or are licensed to use; the reader accepts any compatible atlas JSON.

## Offline preparation

With local `planets.geojson` and `hyperspace-lanes.geojson`, run:

```sh
node scripts/prepare-reference-data.mjs /path/to/source /path/to/WorldAtlas-reference.local.json
```

Import the resulting JSON with **⋯**. It contains30 cards plus2466 located points and1573 line strings, under one projection;2372 unlocated source records are omitted. It is local user data, ignored by Git, and is not part of a WorldAtlas release. Source-era Canon/Legends metadata are mixed; these lines do not prove a route existed in22BBY.
