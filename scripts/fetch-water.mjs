#!/usr/bin/env node
// Builds src/data/bay-water.json: the sea, the Bay and the larger lakes/reservoirs inside the map's bounds, as a
// GeoJSON FeatureCollection of polygons drawn under the routes (Terrarium elevation tiles carry no water).
//
// Sources (OpenStreetMap via Overpass, ODbL):
//   natural=coastline ways  — the Pacific, SF Bay, San Pablo Bay, Suisun Bay and the tidal sloughs. OSM draws these
//                             with land on the left / water on the right, so after chaining the ways and clipping them
//                             to the bbox, walking the bbox edge clockwise from each exit to the next entry closes
//                             the water side into rings.
//   natural=water ways + multipolygon relations — lakes, reservoirs, wide rivers; kept when larger than MIN_AREA_KM2.
//
// Usage: node scripts/fetch-water.mjs [--tolerance=50] [--min-area=0.2] [--cache=/tmp/overpass.json]
//   (Node >= 18, no dependencies; --cache keeps the raw Overpass response so tuning runs don't refetch ~50 MB)

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../src/data/bay-water.json');
const OVERPASS = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
/** map bounds, as in GuideMap's MAX_BOUNDS */
const S = 36.95, W = -123.3, N = 38.45, E = -121.15;
const arg = (name, dflt) => (process.argv.find(a => a.startsWith(`--${name}=`)) || '').split('=')[1] || dflt;
const TOLERANCE_M = Number(arg('tolerance', 50));
const MIN_AREA_KM2 = Number(arg('min-area', 0.2));
const CACHE = arg('cache', '');
const MAX_BYTES = 400 * 1024;

// ---- geometry helpers (planar, in metres; good enough at this scale)
const M_LAT = 111_320, M_LON = 111_320 * Math.cos((((S + N) / 2) * Math.PI) / 180);
const toM = ([lon, lat]) => [(lon - W) * M_LON, (lat - S) * M_LAT];
const round5 = v => Math.round(v * 1e5) / 1e5;
const same = (a, b) => a[0] === b[0] && a[1] === b[1];

/** signed area in km² (planar); positive = counter-clockwise */
function area(ring) {
  let a = 0;
  for (let i = 0, n = ring.length - 1; i < n; i++) {
    const [x1, y1] = toM(ring[i]), [x2, y2] = toM(ring[i + 1]);
    a += x1 * y2 - x2 * y1;
  }
  return a / 2e6;
}

function pointInRing([px, py], ring) {
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
function simplifyRing(ring, tol) {
  const out = simplify(ring, tol);
  if (out.length < 4) return null;
  return out;
}

// ---- chaining ways into linestrings by shared end nodes
/** Joins ways (arrays of {nodes, geometry}) end to start. Returns {rings, lines} of [lon, lat] arrays. */
function chain(ways) {
  const byFirst = new Map();
  for (const w of ways) {
    const k = w.nodes[0];
    (byFirst.get(k) || byFirst.set(k, []).get(k)).push(w);
  }
  const used = new Set(), rings = [], lines = [];
  const hasPrev = new Set(ways.map(w => w.nodes[w.nodes.length - 1]));
  // start from ways nothing leads into first so open chains are walked from their true start
  const starts = [...ways.filter(w => !hasPrev.has(w.nodes[0])), ...ways];
  for (const start of starts) {
    if (used.has(start.id)) continue;
    const pts = [], nodes = [];
    let w = start;
    while (w && !used.has(w.id)) {
      used.add(w.id);
      const g = w.geometry.map(p => [p.lon, p.lat]);
      pts.push(...(pts.length ? g.slice(1) : g));
      nodes.push(...(nodes.length ? w.nodes.slice(1) : w.nodes));
      w = (byFirst.get(w.nodes[w.nodes.length - 1]) || []).find(x => !used.has(x.id));
    }
    if (nodes[0] === nodes[nodes.length - 1]) rings.push(pts);
    else lines.push(pts);
  }
  return { rings, lines };
}

// ---- clipping to the bbox
const inside = ([x, y]) => x >= W && x <= E && y >= S && y <= N;

/** Liang-Barsky: the part of segment a-b inside the bbox, or null */
function clipSeg(a, b) {
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0] - W], [dx, E - a[0]], [-dy, a[1] - S], [dy, N - a[1]]]) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  return [[a[0] + t0 * dx, a[1] + t0 * dy], [a[0] + t1 * dx, a[1] + t1 * dy]];
}

/** Splits a linestring into the pieces that lie inside the bbox. */
function clipLine(pts) {
  const pieces = [];
  let cur = null;
  for (let i = 0; i + 1 < pts.length; i++) {
    const seg = clipSeg(pts[i], pts[i + 1]);
    if (!seg) {
      cur = null;
      continue;
    }
    if (!cur || !same(cur[cur.length - 1], seg[0])) pieces.push((cur = [seg[0]]));
    if (!same(seg[0], seg[1])) cur.push(seg[1]);
    if (!inside(pts[i + 1]) || !same(seg[1], pts[i + 1])) cur = null;
  }
  return pieces.filter(p => p.length >= 2);
}

// ---- closing the water side along the bbox edge (clockwise: interior on the right)
const H = N - S, WD = E - W, PERIM = 2 * (H + WD);
/** position along the bbox edge, clockwise from the SW corner; null when not on the edge */
function edgePos([x, y]) {
  const eps = 1e-7; // ~1 cm: clipped end points carry float error
  if (Math.abs(x - W) < eps) return y - S; // west edge, northbound
  if (Math.abs(y - N) < eps) return H + (x - W); // north edge, eastbound
  if (Math.abs(x - E) < eps) return H + WD + (N - y); // east edge, southbound
  if (Math.abs(y - S) < eps) return 2 * H + WD + (E - x); // south edge, westbound
  return null;
}
const CORNERS = [
  [H, [W, N]],
  [H + WD, [E, N]],
  [2 * H + WD, [E, S]],
  [PERIM, [W, S]],
];
/** the corner points passed walking clockwise from edge position a to b, in walking order */
function cornersBetween(a, b) {
  const span = (b - a + PERIM) % PERIM || PERIM;
  return CORNERS.map(([t, c]) => [(t - a + PERIM) % PERIM, c])
    .filter(([d]) => d > 0 && d < span)
    .sort(([d1], [d2]) => d1 - d2)
    .map(([, c]) => c);
}

function closeCoast(pieces) {
  const open = pieces.map(p => ({ p, entry: edgePos(p[0]), exit: edgePos(p[p.length - 1]) }));
  const dangling = open.filter(o => o.entry == null || o.exit == null);
  if (dangling.length) console.warn(`  ${dangling.length} coastline piece(s) end inside the bbox (data gap); dropped`);
  const ok = open.filter(o => o.entry != null && o.exit != null);
  const used = new Set(), rings = [];
  for (const start of ok) {
    if (used.has(start)) continue;
    const ring = [];
    let cur = start, complete = false;
    for (let guard = 0; guard <= ok.length; guard++) {
      used.add(cur);
      ring.push(...cur.p);
      // next piece: the smallest entry position after this exit, going clockwise
      let next = null, best = Infinity;
      for (const o of ok) {
        const d = (o.entry - cur.exit + PERIM) % PERIM;
        if (d < best) (best = d), (next = o);
      }
      ring.push(...cornersBetween(cur.exit, next.entry));
      if (next === start) {
        complete = true;
        break;
      }
      if (used.has(next)) break;
      cur = next;
    }
    if (!complete) {
      console.warn('  coastline walk could not close a ring (inconsistent way directions?); dropped');
      continue;
    }
    ring.push(ring[0]);
    rings.push(ring);
  }
  return rings;
}

// ---- water relations: assemble outer/inner member ways into rings
function relationRings(rel, role) {
  const members = rel.members.filter(m => m.type === 'way' && m.role === role && m.geometry);
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

// ---- main
async function overpass(query) {
  if (CACHE) {
    const cached = await readFile(CACHE, 'utf8').catch(() => null);
    if (cached) return JSON.parse(cached);
  }
  const res = await fetch(OVERPASS, { method: 'POST', body: 'data=' + encodeURIComponent(query) });
  if (!res.ok) throw new Error(`Overpass ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const text = await res.text();
  if (CACHE) await writeFile(CACHE, text);
  return JSON.parse(text);
}

const bbox = `${S},${W},${N},${E}`;
console.log('fetching coastline + water from Overpass…');
const data = await overpass(`[out:json][timeout:300];
(
  way[natural=coastline](${bbox});
  way[natural=water](${bbox});
  relation[natural=water][type=multipolygon](${bbox});
);
out geom;`);
const els = data.elements;
const coastWays = els.filter(e => e.type === 'way' && e.tags?.natural === 'coastline');
const waterWays = els.filter(e => e.type === 'way' && e.tags?.natural === 'water');
const waterRels = els.filter(e => e.type === 'relation');
console.log(`  ${coastWays.length} coastline ways, ${waterWays.length} water ways, ${waterRels.length} water relations`);

// sea: chained coastline → clipped → closed along the bbox
const { rings: coastRings, lines: coastLines } = chain(coastWays);
const pieces = [];
const seaOuters = [], islands = [];
for (let r of [...coastRings, ...coastLines]) {
  const closed = same(r[0], r[r.length - 1]);
  if (closed && r.every(inside)) {
    // CCW = land on the left going round = an island (hole in the sea); CW = an enclosed water body
    (area(r) > 0 ? islands : seaOuters).push(r);
    continue;
  }
  if (closed) {
    // a ring straddling the bbox must be clipped from an outside vertex, or its first and last pieces stop mid-bbox
    const k = r.findIndex(p => !inside(p));
    r = [...r.slice(k), ...r.slice(1, k + 1)];
  }
  pieces.push(...clipLine(r));
}
seaOuters.push(...closeCoast(pieces));
console.log(`  sea: ${seaOuters.length} outer ring(s), ${islands.length} island(s)`);

const features = [];
const orient = (ring, ccw) => ((area(ring) > 0) === ccw ? ring : ring.slice().reverse());
const polygon = (outer, holes, props) => {
  const o = simplifyRing(outer, TOLERANCE_M);
  if (!o) return;
  const hs = holes.map(h => simplifyRing(h, TOLERANCE_M)).filter(h => h && Math.abs(area(h)) >= MIN_AREA_KM2 / 4);
  features.push({
    type: 'Feature',
    properties: props,
    geometry: { type: 'Polygon', coordinates: [orient(o, true), ...hs.map(h => orient(h, false))].map(r => r.map(p => p.map(round5))) },
  });
};
for (const outer of seaOuters) {
  const holes = islands.filter(i => pointInRing(i[0], outer));
  polygon(outer, holes, { kind: 'sea' });
}

// lakes and reservoirs
let lakes = 0;
const lake = (outer, holes, tags) => {
  if (Math.abs(area(outer)) < MIN_AREA_KM2) return;
  // salt ponds and other tidal basins already sit inside the coastline polygon; skip anything the sea covers
  if (seaOuters.some(s => pointInRing(outer[0], s) && !islands.some(i => pointInRing(outer[0], i)))) return;
  lakes++;
  polygon(outer, holes, { kind: tags.water || 'water', name: tags.name });
};
for (const w of waterWays) {
  if (w.nodes[0] !== w.nodes[w.nodes.length - 1]) continue;
  lake(w.geometry.map(p => [p.lon, p.lat]), [], w.tags);
}
for (const rel of waterRels) {
  const inners = relationRings(rel, 'inner');
  for (const outer of relationRings(rel, 'outer')) lake(outer, inners.filter(i => pointInRing(i[0], outer)), rel.tags);
}
console.log(`  ${lakes} lake/reservoir polygon(s) ≥ ${MIN_AREA_KM2} km²`);

const fc = { type: 'FeatureCollection', features };
const json = JSON.stringify(fc);
console.log(`  ${features.length} features, ${(json.length / 1024).toFixed(0)} KB`);
if (json.length > MAX_BYTES) throw new Error(`output exceeds ${MAX_BYTES / 1024} KB; raise --tolerance or --min-area`);
await writeFile(OUT, json + '\n');
console.log(`wrote ${OUT}`);
