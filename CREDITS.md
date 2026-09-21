# Credits

## Map

**Terrain.** The relief is shaded in the browser from [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/)
(`s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`, Terrarium encoding), the Mapzen/Tilezen elevation
tileset hosted on the AWS Open Data registry. Over the Bay Area the data is United States 3DEP (formerly NED) and SRTM,
courtesy of the U.S. Geological Survey, with ETOPO1 bathymetry from NOAA offshore. These U.S. government datasets are
public domain in the United States; the USGS asks that they be credited, which the map's attribution line does. The
Tilezen project's documentation, including its
[attribution page](https://github.com/tilezen/joerd/blob/master/docs/attribution.md) and
[data sources](https://github.com/tilezen/joerd/blob/master/docs/data-sources.md), is MIT licensed. No AWS or Mapzen
key is used; tiles are requested directly. The same tileset serves twice, as separate sources declared in
`src/map/style.ts`: one MapLibre shades into the map's paper palette as a `hillshade` layer, the other it reads as
the elevation mesh behind the 3D view.

**Water.** `src/data/bay-water.json` holds the Pacific, San Francisco Bay, San Pablo Bay, Suisun Bay and the larger
lakes and reservoirs inside the map's bounds, built by `scripts/fetch-water.mjs` from OpenStreetMap
(`natural=coastline` ways, `natural=water` ways and multipolygon relations) via the Overpass API, simplified to about
50 m and keeping water bodies of 0.2 km² and up (the script's defaults). Data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the
[Open Database License](https://opendatacommons.org/licenses/odbl/1-0/) (ODbL). Retrieved September 13, 2026.

**Parks.** `src/data/bay-parks.json` holds the parks, preserves and other protected open space inside the map's bounds,
the green under the relief, built by `scripts/fetch-parks.mjs` from OpenStreetMap (`leisure=park` and
`leisure=nature_reserve`, `boundary=protected_area` and `boundary=national_park`, as ways and relations) via the
Overpass API, simplified to about 80 m and keeping areas of 1 km² and up (the script's defaults). Data ©
OpenStreetMap contributors, ODbL, as above. Retrieved September 20, 2026.

## Renderer

**MapLibre GL JS.** The map is drawn by [MapLibre GL JS](https://maplibre.org/), a community fork of Mapbox GL JS,
under the [3-Clause BSD licence](https://github.com/maplibre/maplibre-gl-js/blob/main/LICENSE.txt). It is an ordinary
npm dependency, so its licence ships with the package. The style in `src/map/style.ts` is written from scratch against
the two elevation sources and the local water and park polygons above: the map loads no vector-tile basemap, sprite sheet or
glyph server, and so makes no request to any hosted map service.

**three.js.** The landmarks that stand on the terrain in 3D (`src/map/landmarks3d.ts`) are drawn by
[three.js](https://threejs.org/) under the [MIT licence](https://github.com/mrdoob/three.js/blob/dev/LICENSE), an
ordinary npm dependency that the page loads only once the reader is in 3D. Every model is built in code from published
dimensions (the bridge district's for the Golden Gate Bridge, the National Register descriptions for the rest): no
model file, texture or photograph is downloaded. Where Sutro Tower, the buildings on Alcatraz, the Palace of Fine
Arts, the Transamerica Pyramid and Salesforce Tower stand, the Palace's plan and the outline of its lagoon are measured from OpenStreetMap's building and water
outlines (© OpenStreetMap contributors, ODbL, as above; retrieved September 20, 2026). The small landmark drawings on the
map (`src/map/landmarkMarks.ts`) are drawn in code as inline SVG and stand at coordinates looked up in OpenStreetMap
the same day.
