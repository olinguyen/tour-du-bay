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

/** index i (1 ≤ i < c.length) of the first vertex at or past distance d, by binary search over the cumulative array */
export function segmentAt(c: number[], d: number): number {
  let lo = 1, hi = c.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (c[mid] < d) lo = mid + 1;
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
