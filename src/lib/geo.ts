import type { LatLng } from '../data/types';

const rad = (deg: number) => (deg * Math.PI) / 180;

/** great-circle distance in km */
export function hav(a: LatLng, b: LatLng): number {
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(s));
}

/** cumulative distance at each vertex of a polyline */
export function cum(route: LatLng[]): number[] {
  const c = [0];
  for (let i = 1; i < route.length; i++) c.push(c[i - 1] + hav(route[i - 1], route[i]));
  return c;
}

/** index of the first entry at or past distance d, by binary search; `key` reads the distance of an entry */
export function segmentAt<T>(xs: readonly T[], d: number, key: (x: T) => number = x => x as unknown as number): number {
  let lo = 1, hi = xs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (key(xs[mid]) < d) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** the point a fraction f of the way along the route */
export function pointAt(route: LatLng[], c: number[], f: number): LatLng {
  const d = f * c[c.length - 1];
  const i = segmentAt(c, d);
  const t = (d - c[i - 1]) / Math.max(1e-9, c[i] - c[i - 1]);
  return [
    route[i - 1][0] + (route[i][0] - route[i - 1][0]) * t,
    route[i - 1][1] + (route[i][1] - route[i - 1][1]) * t,
  ];
}

/** the stretch of route between fractions f0 and f1 */
export function sliceBetween(route: LatLng[], c: number[], f0: number, f1: number): LatLng[] {
  const L = c[c.length - 1], d0 = f0 * L, d1 = f1 * L;
  const out = [pointAt(route, c, f0)];
  for (let i = 1; i < route.length; i++) if (c[i] > d0 && c[i] < d1) out.push(route[i]);
  out.push(pointAt(route, c, f1));
  return out;
}

/** the route from its start up to fraction f */
export function sliceTo(route: LatLng[], c: number[], f: number): LatLng[] {
  const d = f * c[c.length - 1];
  const out = [route[0]];
  for (let i = 1; i < route.length; i++) {
    if (c[i] <= d) out.push(route[i]);
    else {
      out.push(pointAt(route, c, f));
      break;
    }
  }
  return out;
}

export function bounds(routes: LatLng[][]): [LatLng, LatLng] {
  let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
  for (const route of routes) {
    for (const [lat, lng] of route) {
      if (lat < s) s = lat;
      if (lat > n) n = lat;
      if (lng < w) w = lng;
      if (lng > e) e = lng;
    }
  }
  return [[s, w], [n, e]];
}

/** Douglas-Peucker: the indices of the vertices that keep every point within `metres` of the simplified line */
export function simplifyIndices(route: LatLng[], metres: number): number[] {
  if (route.length < 3) return route.map((_, i) => i);
  // planar metres, good enough for tolerances of a few metres
  const k = Math.cos(rad(route[0][0])) * 111320, m = 111320;
  const keep = new Uint8Array(route.length);
  keep[0] = keep[route.length - 1] = 1;
  const stack: [number, number][] = [[0, route.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = route[a][1] * k, ay = route[a][0] * m, dx = route[b][1] * k - ax, dy = route[b][0] * m - ay;
    const len2 = dx * dx + dy * dy;
    let far = -1, farD = metres * metres;
    for (let i = a + 1; i < b; i++) {
      const px = route[i][1] * k - ax, py = route[i][0] * m - ay;
      const t = len2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / len2)) : 0;
      const ex = px - t * dx, ey = py - t * dy, d = ex * ex + ey * ey;
      if (d > farD) (far = i), (farD = d);
    }
    if (far > 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < route.length; i++) if (keep[i]) out.push(i);
  return out;
}

export const simplify = (route: LatLng[], metres: number): LatLng[] => simplifyIndices(route, metres).map(i => route[i]);
