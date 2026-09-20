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
// named with its extension, like units.mjs, because the route script loads this file under Node
import { hav } from '../lib/geo.ts';
import { KM_PER_MI } from '../lib/units.mjs';
import type { LatLng, ProfilePoint } from './types';

/** degrees → integer grid */
const COORD = 1e5;
/** kilometres → decimetres */
const CUM = 1e4;
/** feet → hundredths of a foot */
const ELE = 1e2;

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

/** A ride's itineraries, as lists of part ids into the shipped parts: the ride as planned, and the same ride reached from its alternative start when it has one. */
export interface Itinerary {
  parts: string[];
  /** the ride in from the start named by `from` in rides.ts: the way there, the ride, the way back */
  transit?: string[];
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

/** A route as the guide reads it, whether one prepared part or a whole trip: the line, its road distances, and the profile. */
export interface DecodedRoute {
  route: LatLng[];
  cum: number[];
  /** [miles, feet], evenly spaced within each prepared part */
  profile: ProfilePoint[];
}

/** the geometry the guide draws: the route, its road distances, and the elevation profile in [miles, feet] */
export function decodeRoute(e: EncodedRoute): DecodedRoute {
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
  // the last sample is the span itself, not a float's width short of it: the profile ends where the route does
  for (let i = 0; i <= n; i++) profile.push([(i === n ? e.span : (e.span * i) / n) / KM_PER_MI, (h += e.ele[i]) / ELE]);
  return { route, cum, profile };
}

/** Parts joined end to end into one trip, and where along it each part begins. */
export interface Trip extends DecodedRoute {
  /** distance (mi) along the trip at which each part starts, followed by the trip's length */
  at: number[];
}

/** how near a trip's last point must come to its first for the trip to count as returning there (km) */
const CLOSES_WITHIN_KM = 0.005;

/**
 * Join prepared parts end to end into one trip. Each part was prepared on its own, so its distances begin at zero;
 * here they carry on from where the part before ended. Consecutive parts meet within 30 m (the generator refuses
 * anything else), and the join is one spot: the part that follows gives up its first vertex and first profile
 * sample, which stand at the same distance as the ones before them, and a few metres of gap in the plan are not
 * road. A trip that comes back to where it began is given one height there, so its climbing and its descending
 * come to the same figure. The parts are left untouched, since one part can be ridden in more than one trip.
 */
export function composeRoute(parts: DecodedRoute[]): Trip {
  if (!parts.length) throw new Error('a trip needs at least one part');
  const route: LatLng[] = [], cum: number[] = [], profile: ProfilePoint[] = [], at: number[] = [];
  for (const part of parts) {
    // where this part begins along the trip: the profile's end is the exact span, so the offset is read there (mi)
    const offset = profile.length ? profile[profile.length - 1][0] : 0, skip = profile.length ? 1 : 0;
    at.push(offset);
    for (let i = skip; i < part.route.length; i++) {
      route.push(part.route[i]);
      cum.push(part.cum[i] + offset * KM_PER_MI);
    }
    for (let i = skip; i < part.profile.length; i++) profile.push([part.profile[i][0] + offset, part.profile[i][1]]);
  }
  const last = profile.length - 1;
  at.push(profile[last][0]);
  if (hav(route[0], route[route.length - 1]) < CLOSES_WITHIN_KM) profile[last] = [profile[last][0], profile[0][1]];
  return { route, cum, profile, at };
}
