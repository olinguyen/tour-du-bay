// How a prepared route travels from the content tool to the page. `scripts/prepare-routes.mjs` runs the
// preparation (src/lib/prepare.ts) offline and writes the result into src/data/routes.generated.ts encoded;
// the guide only decodes, and never sees the planned [lat, lng, ft] geometry the preparation started from.
//
// The encoding is the point of the exercise. Written out as decimal triples the eight rides are ~127 KB
// gzipped, about half the page's JavaScript. Scaling each value to an integer and storing its difference
// from the one before turns long decimals into small numbers that gzip tightly: the same geometry is ~49 KB,
// and decoding is a pair of running sums rather than re-deriving the geometry in the browser.
//
// The scales are chosen so nothing on screen moves. 1e-5 degrees is a ~1.1 m grid, well under a pixel at the
// zoom the map reaches (~7 m/px at 14); a decimetre of road distance and a hundredth of a foot of elevation
// are both far below the 10 m hysteresis that decides what counts as a climb.
import type { LatLng, ProfilePoint } from './types';

/** degrees → integer grid */
const COORD = 1e5;
/** kilometres → decimetres */
const CUM = 1e4;
/** feet → hundredths of a foot */
const ELE = 1e2;
const KM_PER_MI = 1.609344;

/** A route as the preparation leaves it: real numbers, before any of the rounding above. */
export interface PreparedRoute {
  /** road length of the planned route (km) */
  span: number;
  /** the drawn route: the planned vertices that keep it within 3 m of the planned line */
  route: LatLng[];
  /** road distance (km) at each drawn vertex, measured along the planned route */
  cum: number[];
  /** elevation (ft) at evenly spaced samples ~25 m apart, from the start of the route to its end */
  heights: number[];
}

/** What ships: the same route as differences between scaled integers. */
export interface EncodedRoute {
  /** road length (km), the one value kept exact: it sets the profile's distance axis */
  span: number;
  /** the drawn route, [lat, lng] × 1e5 interleaved, each ordinate a difference from the vertex before */
  coords: number[];
  /** road distance in decimetres at each drawn vertex, as differences */
  cum: number[];
  /** elevation in hundredths of a foot at each sample, as differences */
  ele: number[];
}

/** differences between consecutive scaled values, the first measured from zero */
function deltas(values: number[], scale: number): number[] {
  const out: number[] = [];
  let previous = 0;
  for (const value of values) {
    const scaled = Math.round(value * scale);
    out.push(scaled - previous);
    previous = scaled;
  }
  return out;
}

export function encodeRoute(p: PreparedRoute): EncodedRoute {
  const coords: number[] = [];
  let lat = 0, lng = 0;
  for (const point of p.route) {
    const a = Math.round(point[0] * COORD), b = Math.round(point[1] * COORD);
    coords.push(a - lat, b - lng);
    lat = a;
    lng = b;
  }
  return { span: p.span, coords, cum: deltas(p.cum, CUM), ele: deltas(p.heights, ELE) };
}

/** the geometry the guide draws: the route, its road distances, and the elevation profile in [miles, feet] */
export function decodeRoute(e: EncodedRoute): { route: LatLng[]; cum: number[]; profile: ProfilePoint[] } {
  if (e.coords.length < 4 || e.coords.length % 2 || e.cum.length * 2 !== e.coords.length || e.ele.length < 2) {
    throw new Error('malformed encoded route');
  }
  const route: LatLng[] = [];
  let lat = 0, lng = 0;
  for (let i = 0; i < e.coords.length; i += 2) {
    lat += e.coords[i];
    lng += e.coords[i + 1];
    route.push([lat / COORD, lng / COORD]);
  }
  const cum: number[] = [];
  let d = 0;
  for (const step of e.cum) cum.push((d += step) / CUM);
  // the samples are evenly spaced by construction, so only the heights are stored; the distances come back
  // from the span, which keeps a fraction of the ride on the same spot on the map and on the profile
  const n = e.ele.length - 1;
  const profile: ProfilePoint[] = [];
  let h = 0;
  for (let i = 0; i <= n; i++) profile.push([(e.span * i) / n / KM_PER_MI, (h += e.ele[i]) / ELE]);
  return { route, cum, profile };
}
