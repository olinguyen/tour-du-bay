// What fetch-water.mjs and fetch-parks.mjs share: the map's bounds, planar geometry over them, ring assembly for
// OpenStreetMap relations, and the Overpass request. Node >= 18, no dependencies.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
/** where the generated polygons live */
export const DATA = resolve(HERE, '../../src/data');
/** the map's bounds, shared with GuideMap's MAX_BOUNDS */
export const { s: S, w: W, n: N, e: E } = JSON.parse(await readFile(resolve(DATA, 'map-bounds.json'), 'utf8'));
export const BBOX = `${S},${W},${N},${E}`;

export const arg = (name, dflt) => (process.argv.find(a => a.startsWith(`--${name}=`)) || '').split('=')[1] || dflt;

// ---- geometry helpers (planar, in metres; good enough at this scale)
const M_LAT = 111_320, M_LON = 111_320 * Math.cos((((S + N) / 2) * Math.PI) / 180);
const toM = ([lon, lat]) => [(lon - W) * M_LON, (lat - S) * M_LAT];
export const round5 = v => Math.round(v * 1e5) / 1e5;
export const same = (a, b) => a[0] === b[0] && a[1] === b[1];

/** signed area in km² (planar); positive = counter-clockwise */
export function area(ring) {
  let a = 0;
  for (let i = 0, n = ring.length - 1; i < n; i++) {
    const [x1, y1] = toM(ring[i]), [x2, y2] = toM(ring[i + 1]);
    a += x1 * y2 - x2 * y1;
  }
  return a / 2e6;
}

export function pointInRing([px, py], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Douglas-Peucker, iterative; keeps the end points */
function simplify(pts, tol) {
  if (pts.length <= 2) return pts;
  const m = pts.map(toM), keep = new Uint8Array(pts.length), stack = [[0, pts.length - 1]];
  keep[0] = keep[pts.length - 1] = 1;
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    const [ax, ay] = m[a], [bx, by] = m[b], dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    let best = -1, bestD = tol;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = m[i];
      const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > bestD) (best = i), (bestD = d);
    }
    if (best >= 0) (keep[best] = 1), stack.push([a, best], [best, b]);
  }
  return pts.filter((_, i) => keep[i]);
}

/** Simplify a closed ring; drops rings that collapse to nothing. */
export function simplifyRing(ring, tol) {
  const out = simplify(ring, tol);
  if (out.length < 4) return null;
  return out;
}

/**
 * A GeoJSON polygon feature from an outer ring and its holes, simplified to `tol` metres, wound outer-CCW and rounded
 * to 5 decimals; null when the outer ring collapses. Holes smaller than `minHoleKm2` are filled in.
 */
export function polygonFeature(outer, holes, props, tol, minHoleKm2) {
  const o = simplifyRing(outer, tol);
  if (!o) return null;
  const hs = holes.map(h => simplifyRing(h, tol)).filter(h => h && Math.abs(area(h)) >= minHoleKm2);
  const orient = (ring, ccw) => ((area(ring) > 0) === ccw ? ring : ring.slice().reverse());
  return {
    type: 'Feature',
    properties: props,
    geometry: { type: 'Polygon', coordinates: [orient(o, true), ...hs.map(h => orient(h, false))].map(r => r.map(p => p.map(round5))) },
  };
}

// ---- relations: assemble member ways of a role into rings
/** `role` is one role or a list of them (boundary relations often leave their outer ways' role empty) */
export function relationRings(rel, role) {
  const roles = [].concat(role);
  const members = rel.members.filter(m => m.type === 'way' && roles.includes(m.role) && m.geometry);
  // members carry no node ids with `out geom` and run in either direction, so join on coordinates, flipping as needed
  const pool = new Set(members), rings = [];
  while (pool.size) {
    const [w] = pool;
    pool.delete(w);
    const pts = w.geometry.map(p => [p.lon, p.lat]);
    let progressed = true;
    while (!same(pts[0], pts[pts.length - 1]) && progressed) {
      progressed = false;
      const tail = pts[pts.length - 1];
      for (const c of pool) {
        const g = c.geometry.map(p => [p.lon, p.lat]);
        if (same(g[0], tail)) pts.push(...g.slice(1));
        else if (same(g[g.length - 1], tail)) pts.push(...g.reverse().slice(1));
        else continue;
        pool.delete(c);
        progressed = true;
        break;
      }
    }
    if (same(pts[0], pts[pts.length - 1]) && pts.length >= 4) rings.push(pts);
  }
  return rings;
}

// ---- Overpass
const OVERPASS = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';

/** Runs a query; with a `cache` path the raw response is kept there so tuning runs don't refetch tens of MB. */
export async function overpass(query, cache) {
  if (cache) {
    const cached = await readFile(cache, 'utf8').catch(() => null);
    if (cached) return JSON.parse(cached);
  }
  const res = await fetch(OVERPASS, {
    method: 'POST',
    // the public instance answers 406 to a request without a form content type and a User-Agent naming its sender
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'tour-du-bay data scripts (github.com/olinguyen/tour-du-bay)',
      Accept: 'application/json',
    },
    body: 'data=' + encodeURIComponent(query),
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const text = await res.text();
  if (cache) await writeFile(cache, text);
  return JSON.parse(text);
}
