// The map's look, as a MapLibre style. Relief is shaded by MapLibre from the same public-domain elevation tiles the
// canvas hillshade used before; water is the vector overlay from OpenStreetMap (src/data/bay-water.json, built by
// scripts/fetch-water.mjs) drawn over the relief so the shaded sea floor never shows through; parks are its green
// counterpart (src/data/bay-parks.json, scripts/fetch-parks.mjs), laid under the relief.
import type { Feature, FeatureCollection, LineString, Polygon, Position } from 'geojson';
import type { FilterSpecification, StyleSpecification } from 'maplibre-gl';
import MAP_BOUNDS from '../data/map-bounds.json';

/** AWS Terrain Tiles, Terrarium encoding: elev_m = R*256 + G + B/256 − 32768. USGS 3DEP/SRTM + NOAA ETOPO1, CORS *. */
const DEM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const ATTRIBUTION =
  'Terrain: USGS 3DEP/SRTM &amp; NOAA ETOPO1 via AWS Terrain Tiles · Water &amp; parks © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** a colour from the stylesheet's palette (guide.css :root), so the style and the CSS cannot drift apart */
const swatch = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
/** the paper palette the canvas hillshade mixed by hand, handed to MapLibre's own hillshade instead */
const SHADOW_HEX = '#6b4f33', HIGHLIGHT_HEX = '#fff8e8', ACCENT_HEX = '#9c8b70';
/** sun from the north-west, matching the shading this replaces */
const ILLUMINATION = 315;

/** source ids, shared with GuideMap so it can push data into them after the style loads */
export const SRC = {
  /** the DEM the hillshade reads; a separate instance from the terrain mesh so the two can be toggled apart */
  relief: 'relief-dem',
  /** the DEM the 3D terrain mesh reads */
  terrain: 'terrain-dem',
  parks: 'parks',
  water: 'water',
  coast: 'coast',
  routes: 'routes',
  /** the way in from a ride's alternative start, drawn apart from the ride itself */
  approach: 'approach',
  climbs: 'climbs',
  progress: 'progress',
  leg: 'leg',
} as const;

export const LYR = {
  paper: 'paper',
  parks: 'park-fill',
  relief: 'relief',
  water: 'water-fill',
  waterEdge: 'water-edge',
  coast: 'coast-line',
  routeHalo: 'route-halo',
  route: 'route-line',
  routeHit: 'route-hit',
  climb: 'route-climb',
  approachHalo: 'route-approach-halo',
  approach: 'route-approach',
  progress: 'route-progress',
  leg: 'route-leg',
} as const;

const empty = () => ({ type: 'FeatureCollection' as const, features: [] });

const dem = (attribution?: string) => ({
  type: 'raster-dem' as const,
  tiles: [DEM],
  encoding: 'terrarium' as const,
  tileSize: 256,
  // the DEM is read to zoom 14; 2D is capped there, 3D zooms on to 16 over the same tiles, stretched
  maxzoom: 14,
  ...(attribution ? { attribution } : {}),
});

/** the sea polygons close along the data's bbox; their outline is drawn from SRC.coast instead, skipping those edges */
const NOT_SEA: FilterSpecification = ['!=', ['get', 'kind'], 'sea'];

export function mapStyle(): StyleSpecification {
  return {
    version: 8,
    // every glyph on the map is an HTML marker, so the style needs no font or sprite server
    sources: {
      [SRC.relief]: dem(ATTRIBUTION),
      [SRC.terrain]: dem(),
      [SRC.parks]: { type: 'geojson', data: empty() },
      [SRC.water]: { type: 'geojson', data: empty() },
      [SRC.coast]: { type: 'geojson', data: empty() },
      [SRC.routes]: { type: 'geojson', data: empty(), promoteId: 'slug' },
      [SRC.approach]: { type: 'geojson', data: empty() },
      [SRC.climbs]: { type: 'geojson', data: empty() },
      [SRC.progress]: { type: 'geojson', data: empty() },
      [SRC.leg]: { type: 'geojson', data: empty() },
    },
    layers: [
      { id: LYR.paper, type: 'background', paint: { 'background-color': swatch('--ground') } },
      // under the relief, opaque: the hills shade the green as they shade the paper, and overlapping parks don't stack
      { id: LYR.parks, type: 'fill', source: SRC.parks, paint: { 'fill-color': swatch('--park'), 'fill-antialias': false } },
      {
        id: LYR.relief,
        type: 'hillshade',
        source: SRC.relief,
        paint: {
          'hillshade-shadow-color': SHADOW_HEX,
          'hillshade-highlight-color': HIGHLIGHT_HEX,
          'hillshade-accent-color': ACCENT_HEX,
          'hillshade-illumination-direction': ILLUMINATION,
          // the hills read at zoom 9–10 and settle down close in, where 10 m 3DEP detail gets rough
          'hillshade-exaggeration': ['interpolate', ['linear'], ['zoom'], 9, 0.55, 12, 0.42, 14, 0.3],
        },
      },
      { id: LYR.water, type: 'fill', source: SRC.water, paint: { 'fill-color': swatch('--water') } },
      { id: LYR.waterEdge, type: 'line', source: SRC.water, filter: NOT_SEA, paint: { 'line-color': swatch('--coast'), 'line-width': 1 } },
      { id: LYR.coast, type: 'line', source: SRC.coast, paint: { 'line-color': swatch('--coast'), 'line-width': 1 } },
    ],
  };
}

/**
 * The shoreline of a sea ring: its edges except the ones that run along the water data's bbox. The sea is closed along
 * that bbox, and drawing those edges would put a coastline through open water at the map's limit.
 */
export function coastlines(fc: FeatureCollection<Polygon, { kind: string }>): FeatureCollection {
  const EPS = 1e-6;
  // the file states the bbox its rings were closed along; the map's own bounds are the fallback for an older file
  const [w, s, e, n] = fc.bbox ?? [MAP_BOUNDS.w, MAP_BOUNDS.s, MAP_BOUNDS.e, MAP_BOUNDS.n];
  const onEdge = ([x, y]: Position) =>
    Math.abs(x - w) < EPS || Math.abs(x - e) < EPS || Math.abs(y - s) < EPS || Math.abs(y - n) < EPS;
  const features: Feature<LineString>[] = [];
  const keep = (run: Position[]) => {
    if (run.length > 1) features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: run } });
  };
  for (const f of fc.features) {
    if (f.properties.kind !== 'sea') continue;
    for (const ring of f.geometry.coordinates) {
      let run: Position[] = [];
      for (let i = 0; i < ring.length; i++) {
        // an edge is on the bbox when both its ends are (a coast vertex can sit on the bbox too, so runs still join there)
        if (i && onEdge(ring[i]) && onEdge(ring[i - 1])) {
          keep(run);
          run = [];
        }
        run.push(ring[i]);
      }
      keep(run);
    }
  }
  return { type: 'FeatureCollection', features };
}
