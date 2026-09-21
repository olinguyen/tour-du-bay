// Fog coming in off the Pacific: a small canvas of drifting noise, anchored to the map as a MapLibre canvas source and
// drawn under the routes. It is thickest over the ocean, reaches through the Golden Gate into the Bay and is gone by
// the East Bay hills; it thins out as the reader zooms in, so an open ride is read on a clear map.
import type { CanvasSource, Map as MlMap } from 'maplibre-gl';
import { reducedMotion } from '../lib/html';
import { LYR } from './style';

export const FOG_SRC = 'fog', FOG_LYR = 'fog';

/** the ground the canvas covers: the ocean, the Gate and the Bay as far as the East Bay hills */
const W = -123.3, E = -121.9, N = 38.25, S = 37.15;
const SIZE = 512, TILE = 256;
/** frames a second: fog is slow, and every frame is a repaint of the whole map */
const FPS = 12;
/** the zoom by which the fog has lifted; nothing is drawn past it */
const CLEAR_ZOOM = 12.5;

/**
 * Tileable fractal gradient noise, TILE × TILE, roughly centred on 0. Gradient rather than value noise: value noise
 * keeps the grain of its lattice, and the fog's banks came out with straight sides.
 */
function noise(seed: number): Float32Array {
  let s = seed;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const out = new Float32Array(TILE * TILE);
  for (let cells = 4, amp = 1; cells <= 32; cells *= 2, amp *= 0.5) {
    const angles = Float32Array.from({ length: cells * cells }, () => rand() * Math.PI * 2);
    // the lattice wraps, so the tile repeats without a seam
    const dot = (cx: number, cy: number, dx: number, dy: number) => {
      const a = angles[(cy % cells) * cells + (cx % cells)];
      return Math.cos(a) * dx + Math.sin(a) * dy;
    };
    const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const gx = (x / TILE) * cells, gy = (y / TILE) * cells, x0 = Math.floor(gx), y0 = Math.floor(gy);
        const fx = gx - x0, fy = gy - y0, u = fade(fx), v = fade(fy);
        const top = dot(x0, y0, fx, fy) * (1 - u) + dot(x0 + 1, y0, fx - 1, fy) * u;
        const bottom = dot(x0, y0 + 1, fx, fy - 1) * (1 - u) + dot(x0 + 1, y0 + 1, fx - 1, fy - 1) * u;
        out[y * TILE + x] += (top * (1 - v) + bottom * v) * amp;
      }
    }
  }
  return out;
}

/** a fog-coloured tile whose alpha is the noise, pushed through a soft threshold and kept above `floor` */
function tile(seed: number, rgb: [number, number, number], floor: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = TILE;
  const ctx = c.getContext('2d')!, img = ctx.createImageData(TILE, TILE), n = noise(seed);
  // the ramp is set from the noise itself, and wide (its 5th percentile to its 97th): a narrow one gives banks with
  // firm edges and flat tops, which is cloud, not fog
  const sorted = Float32Array.from(n).sort(), lo = sorted[Math.floor(n.length * 0.05)], hi = sorted[Math.floor(n.length * 0.97)];
  for (let i = 0; i < n.length; i++) {
    const t = Math.max(0, Math.min(1, (n[i] - lo) / (hi - lo))), a = t * t * (3 - 2 * t);
    img.data.set([rgb[0], rgb[1], rgb[2], 255 * (floor + (1 - floor) * a)], i * 4);
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** where the fog lies, as alpha: the ocean, a tongue through the Gate, nothing past the East Bay hills or at the edges */
function mask(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d')!;
  const x = (lon: number) => ((lon - W) / (E - W)) * SIZE, y = (lat: number) => ((N - lat) / (N - S)) * SIZE;
  const sea = ctx.createLinearGradient(0, 0, SIZE, 0);
  sea.addColorStop(0, 'rgba(0,0,0,1)');
  sea.addColorStop(x(-122.6) / SIZE, 'rgba(0,0,0,.95)');
  sea.addColorStop(x(-122.4) / SIZE, 'rgba(0,0,0,.65)');
  sea.addColorStop(x(-122.22) / SIZE, 'rgba(0,0,0,.3)');
  sea.addColorStop(x(-122.02) / SIZE, 'rgba(0,0,0,0)');
  ctx.fillStyle = sea;
  ctx.fillRect(0, 0, SIZE, SIZE);
  // through the Golden Gate and out across the Bay towards Berkeley
  const gx = x(-122.38), gy = y(37.83), gate = ctx.createRadialGradient(gx, gy, 0, gx, gy, SIZE * 0.2);
  gate.addColorStop(0, 'rgba(0,0,0,.7)');
  gate.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gate;
  ctx.fillRect(0, 0, SIZE, SIZE);
  // no hard edge where the canvas ends
  ctx.globalCompositeOperation = 'destination-in';
  const ends = ctx.createLinearGradient(0, 0, 0, SIZE);
  ends.addColorStop(0, 'rgba(0,0,0,0)');
  ends.addColorStop(0.14, 'rgba(0,0,0,1)');
  ends.addColorStop(0.86, 'rgba(0,0,0,1)');
  ends.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = ends;
  ctx.fillRect(0, 0, SIZE, SIZE);
  return c;
}

/**
 * Fill the canvas with a tile at `scale`, turned by `turn` degrees and scrolled by (dx, dy) px. As a repeating
 * pattern, not as drawn tiles: a tile drawn at a fractional position has antialiased edges, and those showed as a
 * faint cross drifting with the fog. Turned, so that what grain the noise has left runs along neither screen axis.
 */
function spread(ctx: CanvasRenderingContext2D, t: HTMLCanvasElement, scale: number, turn: number, dx: number, dy: number) {
  const pattern = ctx.createPattern(t, 'repeat')!;
  pattern.setTransform(new DOMMatrix().translateSelf(dx, dy).rotateSelf(turn).scaleSelf(scale));
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, SIZE, SIZE);
}

/** Adds the fog under the routes and starts it drifting. Returns what stops it. */
export function addFog(map: MlMap): () => void {
  const css = getComputedStyle(document.documentElement).getPropertyValue('--fog').trim() || '#eef1f1';
  const rgb = [1, 3, 5].map(i => parseInt(css.slice(i, i + 2), 16)) as [number, number, number];
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  // two sheets of noise at different sizes and speeds, one multiplied into the other, so the wisps change as they drift
  const body = tile(7, rgb, 0), breakup = tile(1913, rgb, 0.5), lie = mask();

  // destination-in keeps only what each draw covers, so the tiled sheet is laid out whole before it is multiplied in
  const sheet = document.createElement('canvas');
  sheet.width = sheet.height = SIZE;
  const sheetCtx = sheet.getContext('2d')!;

  const draw = (t: number) => {
    sheetCtx.clearRect(0, 0, SIZE, SIZE);
    spread(sheetCtx, breakup, 1.5, -37, t * 11, -t * 2);
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, SIZE, SIZE);
    spread(ctx, body, 2.4, 23, t * 5, t * 1.2);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(sheet, 0, 0);
    ctx.drawImage(lie, 0, 0);
  };
  draw(0);

  map.addSource(FOG_SRC, { type: 'canvas', canvas, animate: false, coordinates: [[W, N], [E, N], [E, S], [W, S]] });
  map.addLayer(
    {
      id: FOG_LYR,
      type: 'raster',
      source: FOG_SRC,
      paint: {
        'raster-opacity': ['interpolate', ['linear'], ['zoom'], 9, 1, 11, 0.75, CLEAR_ZOOM, 0],
        'raster-fade-duration': 0,
      },
    },
    LYR.approachHalo,
  );
  if (reducedMotion()) return () => {};

  // the source uploads its canvas only while it plays, and repaints the map for as long as it does: play for one
  // frame at a time, so the map is redrawn FPS times a second rather than sixty
  const source = map.getSource(FOG_SRC) as CanvasSource;
  const timer = setInterval(() => {
    if (document.hidden || map.getZoom() >= CLEAR_ZOOM) return;
    draw(performance.now() / 1000);
    source.play();
    map.once('render', () => source.pause());
  }, 1000 / FPS);
  return () => clearInterval(timer);
}
