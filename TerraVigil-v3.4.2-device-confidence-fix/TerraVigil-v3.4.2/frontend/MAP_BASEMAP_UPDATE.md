# Satellite maps

All TacticalMap instances default to Esri World Imagery. The Basemap control offers Satellite, Street and Grid, and remembers the choice for the browser tab. It does not remove detections, risk overlays, flight tracks or route endpoints.

Default tile template:

```text
https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}
```

Provider attribution remains visible on the map. Source: [Esri World Imagery documentation](https://doc.arcgis.com/en/data-appliance/2023/maps/world-imagery.htm). This basemap is geographic context, not live satellite surveillance or a source of mine detections.

Satellite and street imagery require internet. Failed tile requests display a status notice and Retry imagery button; a coordinate grid and mission overlays remain available. Select Grid to operate without network tiles. An explicit empty `VITE_TILE_URL` also defaults to the grid.

Set `VITE_TILE_URL`, `VITE_TILE_ATTRIBUTION` and `VITE_TILE_MAX_NATIVE_ZOOM` in the appropriate `.env.*.local` file to use another authorized satellite/local provider. Keep its required attribution. Rebuild with `npm run build:all`; the standalone build uses its checked-in default satellite configuration.
