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
key is used; tiles are requested directly and shaded with a Horn hillshade in `src/map/terrain.ts`.

**Water.** `src/data/bay-water.json` holds the Pacific, San Francisco Bay, San Pablo Bay, Suisun Bay and the larger
lakes and reservoirs inside the map's bounds, built by `scripts/fetch-water.mjs` from OpenStreetMap
(`natural=coastline` ways, `natural=water` ways and multipolygon relations) via the Overpass API, simplified to about
50 m. Data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the
[Open Database License](https://opendatacommons.org/licenses/odbl/1-0/) (ODbL). Retrieved September 13, 2026.
