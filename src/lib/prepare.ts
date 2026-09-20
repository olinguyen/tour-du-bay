// Content preparation, not app code: `scripts/prepare-routes.mjs` imports this to turn a planned,
// road-following route into the geometry the guide draws, then writes it out encoded
// (src/data/routeCodec.ts). The page used to do this on every load — resampling and simplifying 15,000
// points took ~45 ms on a desktop and ~150 ms on a phone before the list could paint — so it runs once,
// offline, and the result is committed.
//
// The imports below name their .ts extension because Node loads this file directly (type stripping,
// Node 22.18+); the rest of src/ uses the extensionless form Vite resolves.
import type { LatLng } from '../data/types';
import { encodeRoute, type EncodedRoute, type PreparedRoute } from '../data/routeCodec.ts';
import { cum, hav, segmentAt, simplifyIndices } from './geo.ts';

/** a planned route point: [lat, lng, elevation in feet] */
export type RoutePoint = [lat: number, lng: number, eleFt: number];

/** profile sample spacing (km) */
const SAMPLE_KM = 0.025;
/** how far the drawn route may stray from the planned one (m) */
const DRAW_TOLERANCE_M = 3;
/** height (ft) at distance d (km) along the points, linear between the two nearest by binary search */
function heightAt(dist: number[], heights: number[], d: number): number {
  const i = segmentAt(dist, d);
  const t = Math.max(0, Math.min(1, (d - dist[i - 1]) / (dist[i] - dist[i - 1] || 1)));
  return heights[i - 1] + (heights[i] - heights[i - 1]) * t;
}

/**
 * Prepare one planned part's [lat, lng, ft] points for the guide: drop a repeated point, measure it, and sample the
 * elevation every ~25 m with a short 1-2-1 smoothing window so terrain-model noise is not counted as hundreds of
 * tiny climbs. Parts are prepared one by one and joined into trips on the page (composeRoute in routeCodec.ts),
 * which is also where a trip that returns to its start is given one height there. The generator validates every
 * point, so a bad one here is a broken file, not a data gap.
 */
export function prepareRoute(points: RoutePoint[]): PreparedRoute {
  const pts: RoutePoint[] = [];
  for (const p of points) {
    if (!(Array.isArray(p) && p.length === 3 && p.every(Number.isFinite) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180)) {
      throw new Error(`invalid route point ${JSON.stringify(p)}`);
    }
    const l = pts[pts.length - 1];
    if (l && hav([l[0], l[1]], [p[0], p[1]]) < 1e-5) continue;
    pts.push(p);
  }
  if (pts.length < 2) throw new Error('route has no usable points');
  const full: LatLng[] = pts.map(p => [p[0], p[1]]);
  // the terrain model dips a foot or two below sea level along the shore; the guide never shows a negative height
  const fullCum = cum(full), elevations = pts.map(p => Math.max(0, p[2]));
  const span = fullCum[fullCum.length - 1], n = Math.max(1, Math.ceil(span / SAMPLE_KM));
  // the last sample lands exactly at the end of the route, not a rounding error short of it
  const at = (i: number) => (i === n ? span : (span * i) / n);
  const samples = Array.from({ length: n + 1 }, (_, i) => heightAt(fullCum, elevations, at(i)));
  const heights = samples.map((h, i) => (i === 0 || i === n ? h : (samples[i - 1] + 2 * h + samples[i + 1]) / 4));
  // what the map draws: BRouter's every-few-metres vertices are far below what zoom 14 (~7 m/px) can show, and the
  // preview re-projects the line every frame. The profile above keeps the full data, and the drawn vertices keep
  // their road distances so a fraction of the ride lands on the same spot on the map and the profile.
  const keep = simplifyIndices(full, DRAW_TOLERANCE_M);
  return { span, route: keep.map(i => full[i]), cum: keep.map(i => fullCum[i]), heights };
}

/** every part, prepared and encoded, ready to be written out */
export function prepareCollection(points: Record<string, RoutePoint[]>): Record<string, EncodedRoute> {
  return Object.fromEntries(Object.entries(points).map(([id, p]) => [id, encodeRoute(prepareRoute(p))]));
}
