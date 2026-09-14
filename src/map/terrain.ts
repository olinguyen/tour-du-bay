// Terrain: composites public hillshade + a water mask into the site's own palette, per tile, on canvas.
import L from 'leaflet';
import type { MapLabel } from '../data/types';
import { esc } from '../lib/html';

const HILL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}';
const BASE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}';

const rgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
const GROUND_HEX = '#ece3cf';
const GROUND = rgb(GROUND_HEX), TINT = rgb('#6b4f33'), WATER = rgb('#c6d2cb'), COAST = rgb('#8b8574');
const STRENGTH = 1.45;
const SIZE = 256;

function load(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = url;
  });
}

const tileUrl = (tpl: string, c: L.Coords) =>
  tpl.replace('{z}', String(c.z)).replace('{x}', String(c.x)).replace('{y}', String(c.y));

function paint(ctx: CanvasRenderingContext2D, hill: HTMLImageElement, base: HTMLImageElement) {
  ctx.drawImage(hill, 0, 0, SIZE, SIZE);
  const hd = ctx.getImageData(0, 0, SIZE, SIZE).data;
  ctx.drawImage(base, 0, 0, SIZE, SIZE);
  const bd = ctx.getImageData(0, 0, SIZE, SIZE).data;
  const out = ctx.createImageData(SIZE, SIZE), o = out.data;
  const N = SIZE * SIZE, water = new Uint8Array(N);
  // the terrain base's water is distinctly blue-green; everything else is land
  for (let i = 0; i < N; i++) {
    const p = i * 4;
    water[i] = bd[p + 2] - bd[p] > 16 && bd[p + 1] - bd[p] > 10 ? 1 : 0;
  }
  for (let i = 0; i < N; i++) {
    const p = i * 4, x = i & 255, y = i >> 8;
    let r: number, g: number, b: number;
    if (water[i]) {
      const edge =
        (x > 0 && !water[i - 1]) || (x < 255 && !water[i + 1]) || (y > 0 && !water[i - SIZE]) || (y < 255 && !water[i + SIZE]);
      [r, g, b] = edge ? COAST : WATER;
    } else {
      const lum = hd[p] / 248;
      const s = Math.min(1, Math.max(0, 1 - (1 - lum) * STRENGTH));
      r = GROUND[0] * (s + ((1 - s) * TINT[0]) / 255);
      g = GROUND[1] * (s + ((1 - s) * TINT[1]) / 255);
      b = GROUND[2] * (s + ((1 - s) * TINT[2]) / 255);
    }
    o[p] = r;
    o[p + 1] = g;
    o[p + 2] = b;
    o[p + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
}

const TerrainLayer = L.GridLayer.extend({
  options: { tileSize: SIZE, maxNativeZoom: 13, maxZoom: 15, minZoom: 7, updateWhenZooming: false, keepBuffer: 2 },
  createTile(coords: L.Coords, done: L.DoneCallback) {
    const tile = document.createElement('canvas');
    tile.width = tile.height = SIZE;
    tile.className = 'terrain-tile';
    const ctx = tile.getContext('2d', { willReadFrequently: true })!;
    Promise.all([load(tileUrl(HILL, coords)), load(tileUrl(BASE, coords))])
      .then(([hill, base]) => {
        paint(ctx, hill, base);
        done(undefined, tile);
      })
      .catch(err => {
        // offline, or the tiles came back without CORS headers (getImageData throws): plain ground
        ctx.fillStyle = GROUND_HEX;
        ctx.fillRect(0, 0, SIZE, SIZE);
        done(err instanceof Error ? err : new Error('terrain tile failed'), tile);
      });
    return tile;
  },
}) as unknown as new (options?: L.GridLayerOptions) => L.GridLayer;

export const terrainLayer = () =>
  new TerrainLayer({
    // credits as published in each service's copyrightText, plus the "Powered by Esri" Esri asks for
    attribution:
      'Powered by Esri · Relief: Esri, Vantor, Airbus DS, USGS, NGA, NASA, CGIAR, N Robinson, NCEAS, NLS, OS, NMA, Geodatastyrelsen, Rijkswaterstaat, GSA, Geoland, FEMA, Intermap and the GIS user community · Water: Esri, USGS, NOAA',
  });

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
