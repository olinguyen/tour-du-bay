// Terrain: shades public-domain elevation tiles into the site's own palette, per tile, on canvas; water is a vector
// overlay from OpenStreetMap (src/data/bay-water.json, built by scripts/fetch-water.mjs) drawn under the routes.
import L from 'leaflet';
import type { MapLabel } from '../data/types';
import { esc } from '../lib/html';

/** AWS Terrain Tiles, Terrarium encoding: elev_m = R*256 + G + B/256 − 32768. USGS 3DEP/SRTM + NOAA ETOPO1, CORS *. */
const DEM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const ATTRIBUTION =
  'Terrain: USGS 3DEP/SRTM &amp; NOAA ETOPO1 via AWS Terrain Tiles · Water © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
/** the extent of src/data/bay-water.json (the bbox scripts/fetch-water.mjs fetches; matches GuideMap's MAX_BOUNDS) */
const WATER = { s: 36.95, w: -123.3, n: 38.45, e: -121.15 };

const rgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
const GROUND_HEX = '#ece3cf';
const GROUND = rgb(GROUND_HEX), TINT = rgb('#6b4f33');
const WATER_HEX = '#c6d2cb', COAST_HEX = '#8b8574';
const STRENGTH = 1.45;
const SIZE = 256;
/** sun from the north-west, fairly high */
const AZIMUTH = (315 * Math.PI) / 180, ALTITUDE = (45 * Math.PI) / 180;
/** slopes are exaggerated so the Bay's hills read at zoom 9–10, less so close in where 10 m 3DEP detail gets rough */
const exaggeration = (z: number) => Math.max(0.7, 1.6 - 0.25 * Math.max(0, z - 10));
/** unit vector towards the sun: east, north, up */
const SUN_E = Math.sin(AZIMUTH) * Math.cos(ALTITUDE), SUN_N = Math.cos(AZIMUTH) * Math.cos(ALTITUDE), SUN_UP = Math.sin(ALTITUDE);
/** ambient light so shadowed slopes keep some paper; sunlit slopes brighten a touch past flat ground */
const AMBIENT = 0.5, FLAT_LUM = 0.95;
/** equatorial metres per pixel at zoom 0, for the gradient's cell size */
const EQ_M_PER_PX = 40075016.686 / SIZE;
const CACHE_MAX = 100;

function load(url: string, im: HTMLImageElement): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    im.crossOrigin = 'anonymous';
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error(`tile failed: ${url}`));
    im.src = url;
  });
}

const tileKey = (c: L.Coords) => c.toString(); // Leaflet's own 'x:y:z'
const tileUrl = (c: L.Coords) => DEM.replace('{z}', String(c.z)).replace('{x}', String(c.x)).replace('{y}', String(c.y));

/** metres per pixel for a tile: the web-mercator scale at the tile's centre latitude */
function cellSize(c: L.Coords) {
  const n = Math.PI - (2 * Math.PI * (c.y + 0.5)) / 2 ** c.z;
  const lat = Math.atan(Math.sinh(n));
  return (EQ_M_PER_PX * Math.cos(lat)) / 2 ** c.z;
}

/** Decode Terrarium RGB into metres. Sea floor is flattened so bathymetry doesn't shade; `sea` marks those pixels. */
function decode(px: Uint8ClampedArray, sea: Uint8Array): Float32Array {
  const N = SIZE * SIZE, z = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const p = i * 4;
    const m = px[p] * 256 + px[p + 1] + px[p + 2] / 256 - 32768;
    if (m > 0) z[i] = m;
    else sea[i] = 1;
  }
  return z;
}

/** the tile's lat/lng extent, from its web-mercator coordinates */
function tileBounds(c: L.Coords) {
  const n = 2 ** c.z;
  const lat = (y: number) => (Math.atan(Math.sinh(Math.PI - (2 * Math.PI * y) / n)) * 180) / Math.PI;
  return { w: (c.x / n) * 360 - 180, e: ((c.x + 1) / n) * 360 - 180, n: lat(c.y), s: lat(c.y + 1) };
}

/** whether the water polygons cover this tile; beyond them the sea has to come from the tile itself */
function underWaterOverlay(c: L.Coords) {
  const b = tileBounds(c);
  return b.w >= WATER.w && b.e <= WATER.e && b.s >= WATER.s && b.n <= WATER.n;
}

/** Horn hillshade in [0, 1]: surface normal · sun. Edges are clamped so a tile shades without its neighbours (faint seams). */
function shade(z: Float32Array, cell: number, exag: number, out: Float32Array) {
  const k = exag / (8 * cell);
  for (let y = 0; y < SIZE; y++) {
    const yu = Math.max(0, y - 1) * SIZE, yc = y * SIZE, yd = Math.min(SIZE - 1, y + 1) * SIZE;
    for (let x = 0; x < SIZE; x++) {
      const xl = Math.max(0, x - 1), xr = Math.min(SIZE - 1, x + 1);
      const a = z[yu + xl], b = z[yu + x], c = z[yu + xr];
      const d = z[yc + xl], f = z[yc + xr];
      const g = z[yd + xl], h = z[yd + x], i = z[yd + xr];
      // dz/dx east-positive, dz/dy north-positive (rows run south); the normal is (-dx, -dy, 1)
      const dx = (c + 2 * f + i - (a + 2 * d + g)) * k;
      const dy = (a + 2 * b + c - (g + 2 * h + i)) * k;
      out[yc + x] = Math.max(0, (SUN_UP - dx * SUN_E - dy * SUN_N) / Math.sqrt(dx * dx + dy * dy + 1));
    }
  }
}

/** Map hillshade onto the paper ramp: flat ground sits at FLAT_LUM, sunlit faces lift towards plain ground, shadows tint. */
function paint(ctx: CanvasRenderingContext2D, dem: HTMLImageElement, coords: L.Coords): ImageData {
  ctx.drawImage(dem, 0, 0, SIZE, SIZE);
  const sea = new Uint8Array(SIZE * SIZE);
  const z = decode(ctx.getImageData(0, 0, SIZE, SIZE).data, sea);
  const hs = new Float32Array(SIZE * SIZE);
  shade(z, cellSize(coords), exaggeration(coords.z), hs);
  // inside the water polygons' extent the overlay draws the sea; outside it, sea-level pixels are left clear so the
  // map's water-coloured background shows through (the ocean past the map's edge at low zoom)
  const seaClear = !underWaterOverlay(coords);
  const out = ctx.createImageData(SIZE, SIZE), o = out.data;
  for (let i = 0, N = SIZE * SIZE; i < N; i++) {
    // normalise so flat ground (shade = SUN_UP) lands at FLAT_LUM, with an ambient floor under the shadows
    const lit = AMBIENT + (1 - AMBIENT) * (hs[i] / SUN_UP);
    const lum = Math.min(1, lit * FLAT_LUM);
    const s = Math.min(1, Math.max(0, 1 - (1 - lum) * STRENGTH));
    const p = i * 4;
    o[p] = GROUND[0] * (s + ((1 - s) * TINT[0]) / 255);
    o[p + 1] = GROUND[1] * (s + ((1 - s) * TINT[1]) / 255);
    o[p + 2] = GROUND[2] * (s + ((1 - s) * TINT[2]) / 255);
    o[p + 3] = seaClear && sea[i] ? 0 : 255;
  }
  return out;
}

/** painted tiles by z/x/y, insertion-ordered so the oldest entry is first; a hit re-inserts to refresh it */
const cache = new Map<string, ImageData>();
function remember(key: string, img: ImageData) {
  cache.delete(key);
  cache.set(key, img);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
}
/**
 * Fetches under way, so a tile pruned and re-created mid-flight (a zoom, a fly) joins the first request instead of
 * repeating it; `waiters` counts the tiles wanting it, and the request is abandoned once no tile does, freeing one of
 * the browser's few connections to the tile host for tiles that are on screen.
 */
const pending = new Map<string, { job: Promise<ImageData>; img: HTMLImageElement; waiters: number }>();
/** one canvas decodes every tile; the tiles themselves only receive pixels */
let scratch: CanvasRenderingContext2D | null = null;

function shadeTile(coords: L.Coords): Promise<ImageData> {
  const key = tileKey(coords), hit = cache.get(key);
  if (hit) {
    remember(key, hit);
    return Promise.resolve(hit);
  }
  let p = pending.get(key);
  if (!p) {
    const img = new Image();
    const job = load(tileUrl(coords), img)
      .then(dem => {
        if (!scratch) {
          const c = document.createElement('canvas');
          c.width = c.height = SIZE;
          scratch = c.getContext('2d', { willReadFrequently: true })!;
        }
        const out = paint(scratch, dem, coords);
        remember(key, out);
        return out;
      })
      .finally(() => pending.delete(key));
    pending.set(key, (p = { job, img, waiters: 0 }));
  }
  p.waiters++;
  return p.job;
}

/** a tile Leaflet removed no longer needs its fetch; the last waiter leaving cancels it */
function release(coords: L.Coords) {
  const p = pending.get(coords.toString());
  if (!p || --p.waiters > 0) return;
  pending.delete(coords.toString());
  p.img.src = ''; // cancels the request; onerror rejects the job, which no tile is waiting on
}

const TerrainLayer = L.GridLayer.extend({
  options: {
    tileSize: SIZE,
    maxNativeZoom: 14,
    maxZoom: 15,
    minZoom: 7,
    updateWhenZooming: false,
    // one tile beyond the viewport, not Leaflet's two: every tile costs a slow fetch from the DEM host
    keepBuffer: 1,
    attribution: ATTRIBUTION,
  },
  onAdd(map: L.Map) {
    this.on('tileunload', (e: L.TileEvent) => release(e.coords));
    L.GridLayer.prototype.onAdd.call(this, map);
  },
  createTile(coords: L.Coords, done: L.DoneCallback) {
    const tile = document.createElement('canvas');
    tile.width = tile.height = SIZE;
    tile.className = 'terrain-tile';
    const ctx = tile.getContext('2d')!;
    // the promise settles after createTile has returned (Leaflet expects done() then), and a tile pruned meanwhile
    // (perhaps re-created) must not report in for its replacement: a detached canvas is stale
    shadeTile(coords)
      .then(img => {
        if (!tile.isConnected) return;
        ctx.putImageData(img, 0, 0);
        done(undefined, tile);
      })
      .catch(err => {
        if (!tile.isConnected) return;
        // offline, or the tile came back without CORS headers (getImageData throws): plain ground
        ctx.fillStyle = GROUND_HEX;
        ctx.fillRect(0, 0, SIZE, SIZE);
        // leaflet.css keeps tiles hidden until this class, which Leaflet only adds on success; the flat fill should show
        tile.classList.add('leaflet-tile-loaded');
        done(err instanceof Error ? err : new Error('terrain tile failed'), tile);
      });
    return tile;
  },
}) as unknown as new (options?: L.GridLayerOptions) => L.GridLayer;

/** The relief raster plus the water polygons; the water gets its own pane just under the overlay pane (400) so routes draw over it. */
const TerrainGroup = L.LayerGroup.extend({
  onAdd(map: L.Map) {
    if (!map.getPane('water')) map.createPane('water').style.zIndex = '350';
    L.LayerGroup.prototype.onAdd.call(this, map);
  },
}) as unknown as new (layers?: L.Layer[]) => L.LayerGroup;

export function terrainLayer(): L.LayerGroup {
  // its own canvas renderer, drawn well past the viewport so pans and the preview's per-frame moves don't reveal
  // shaded ground where the sea should be before the next redraw
  const renderer = L.canvas({ pane: 'water', padding: 1 });
  const water = L.geoJSON(undefined, {
    pane: 'water',
    interactive: false,
    // the sea is closed along the data's bbox, so its outline is drawn separately, skipping those edges
    style: f => ({ renderer, color: COAST_HEX, weight: 1, opacity: 1, fillColor: WATER_HEX, fillOpacity: 1, stroke: f?.properties.kind !== 'sea' }),
  });
  // the polygons are ~400 KB; loading them as their own chunk keeps them off the app's critical path
  import('../data/bay-water.json')
    .then(m => {
      const fc = m.default as GeoJSON.FeatureCollection<GeoJSON.Polygon, { kind: string }>;
      water.addData(fc);
      for (const f of fc.features) {
        if (f.properties.kind !== 'sea') continue;
        for (const ring of f.geometry.coordinates) water.addLayer(coastline(ring, renderer));
      }
    })
    .catch(err => {
      // offline before the chunk arrived, or a stale page after a redeploy: the Bay would read as land
      console.warn('water polygons failed to load', err);
    });
  return new TerrainGroup([new TerrainLayer(), water]);
}

/** The shoreline of a sea ring: its edges except the ones that run along the water data's bbox. */
function coastline(ring: GeoJSON.Position[], renderer: L.Renderer): L.Layer {
  const EPS = 1e-6;
  const onEdge = ([x, y]: GeoJSON.Position) =>
    Math.abs(x - WATER.w) < EPS || Math.abs(x - WATER.e) < EPS || Math.abs(y - WATER.s) < EPS || Math.abs(y - WATER.n) < EPS;
  const runs: L.LatLngExpression[][] = [];
  let run: L.LatLngExpression[] = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    // an edge is on the bbox when both its ends are (a coast vertex can sit on the bbox too, so runs still join there)
    if (i && onEdge(p) && onEdge(ring[i - 1])) {
      if (run.length > 1) runs.push(run);
      run = [];
    }
    run.push([p[1], p[0]]);
  }
  if (run.length > 1) runs.push(run);
  return L.polyline(runs, { renderer, pane: 'water', interactive: false, color: COAST_HEX, weight: 1, opacity: 1 });
}

/** Labels fade by zoom: water always, peaks + minor towns from ~9.5, major towns always; all fade out during the zoom animation. */
export function addLabels(map: L.Map, labels: MapLabel[]) {
  const markers = labels.map(l => {
    const icon = L.divIcon({ className: `lbl lbl-${l.k}`, html: `<span>${esc(l.t)}</span>`, iconSize: null as unknown as undefined });
    return { l, m: L.marker(l.ll, { icon, interactive: false, keyboard: false }).addTo(map) };
  });
  const update = () => {
    const z = map.getZoom();
    for (const { l, m } of markers) {
      const on = l.k === 'water' || l.major ? z < 12.5 : z >= 9.5 && z < 13.5;
      m.getElement()?.classList.toggle('off', !on);
    }
  };
  map.on('zoomend', update);
  // the first zoomend fires before 'load', when the label elements don't exist yet
  map.whenReady(update);
}
