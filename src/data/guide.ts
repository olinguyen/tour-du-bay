// The ride collection as the app sees it: editorial inputs (rides.ts) joined to their planned, road-following
// geometry (routes.generated.ts: parts, decoded and joined into each ride's trip) and the figures read off it —
// distance, climbing, high point. A ride with a second start (`from`) has a second trip, composed on first use.
import { pointAt } from '../lib/geo';
import { elevationGain, ridingTime } from '../lib/route';
import { AREAS, RIDE_INPUTS } from './rides';
import { composeRoute, decodeRoute, type DecodedRoute, type Trip } from './routeCodec';
import { PARTS, ROUTES } from './routes.generated';
import type { Area, Ride, RideInput } from './types';

export { AREAS, LABELS } from './rides';

const decoded = new Map<string, DecodedRoute>();
/** a planned part, decoded once however many trips ride it */
function part(id: string): DecodedRoute {
  let d = decoded.get(id);
  if (!d) {
    const e = PARTS[id];
    if (!e) throw new Error(`${id}: no such part in routes.generated.ts (run npm run routes)`);
    d = decodeRoute(e);
    decoded.set(id, d);
  }
  return d;
}

/** the headline figures every trip carries */
function measured(t: Trip) {
  const lengthMi = t.profile[t.profile.length - 1][0];
  let maxElev = -Infinity;
  for (const p of t.profile) if (p[1] > maxElev) maxElev = p[1];
  return { route: t.route, cum: t.cum, profile: t.profile, lengthMi, feet: Math.round(elevationGain(t.profile)), maxElev };
}

export const RIDES: Ride[] = RIDE_INPUTS.map((r, i) => {
  const it = ROUTES[r.slug];
  if (!it) throw new Error(`${r.slug}: no planned route in routes.generated.ts (add it to scripts/route-plans.json and run npm run routes)`);
  // the two files name the second start together, or not at all; `npm run routes` (or its --check) is what
  // catches a plan whose legs have not been generated yet, and the page just offers one start until they are
  if (it.transit && !r.from) throw new Error(`${r.slug}: the plan has a transit itinerary, but rides.ts names no start to ride in from`);
  if (r.from && !it.transit) console.warn(`${r.slug}: rides.ts names a start to ride in from, but its legs are not in routes.generated.ts yet (npm run routes)`);
  return { ...r, ...measured(composeRoute(it.parts.map(part))), num: i + 1 };
});

const BY_SLUG = new Map(RIDES.map(r => [r.slug, r]));

export const findRide = (slug: string | null | undefined) => (slug ? BY_SLUG.get(slug) : undefined);
export const ridesIn = (area: Area) => RIDES.filter(r => r.area === area);
export const areaList: readonly Area[] = AREAS;

/**
 * A fraction of the ride as planned, re-expressed on the trip in from the station: the same spot on the road, found
 * by the part it sits on. The generator refuses a transit itinerary that skips a part of the ride, so every spot
 * has one.
 */
function remap(f: number, from: { ids: string[]; at: number[] }, to: { ids: string[]; at: number[] }): number {
  const d = f * from.at[from.at.length - 1];
  let i = 0;
  while (i + 1 < from.ids.length && from.at[i + 1] <= d) i++;
  const j = to.ids.indexOf(from.ids[i]);
  if (j < 0) throw new Error(`${from.ids[i]}: the ride in from the station skips this part of the ride`);
  return (to.at[j] + (d - from.at[i])) / to.at[to.at.length - 1];
}

/** a stated time like '1½–2 h', stretched by `ratio` and rounded to the half hour */
function scaleHours(hours: string, ratio: number): string {
  return hours.replace(/[\d½]+/g, s => {
    const h = Math.round(parseFloat(s.replace('½', '.5')) * ratio * 2) / 2;
    return `${Math.floor(h)}${h % 1 ? '½' : ''}`.replace(/^0½/, '½');
  });
}

const ridingIn = new Map<string, Ride | null>();

/**
 * The ride from its `from` start: the way there, the ride itself, and the way back, as one trip. The legs that are
 * not the ride are kept apart for the map to draw lighter; photos and waypoints move to where the same road now
 * falls, and the stated hours stretch with the estimated time. Composed on first use and kept, so the app can tell
 * one trip from another by identity. Null for a ride with a single start.
 */
export function rideIn(r: Ride): Ride | null {
  if (ridingIn.has(r.slug)) return ridingIn.get(r.slug)!;
  const it = ROUTES[r.slug];
  let out: Ride | null = null;
  if (r.from && it.transit) {
    const own = composeRoute(it.parts.map(part)), trip = composeRoute(it.transit.map(part));
    const from = { ids: it.parts, at: own.at }, to = { ids: it.transit, at: trip.at };
    const f = (x: number) => remap(x, from, to);
    const first = it.transit.findIndex(id => it.parts.includes(id));
    const last = it.transit.length - 1 - [...it.transit].reverse().findIndex(id => it.parts.includes(id));
    const input: RideInput = {
      ...r, start: r.from.start, transit: r.from.transit, finish: undefined,
      hours: scaleHours(r.hours, ridingTime(trip.profile) / ridingTime(own.profile)),
      photos: r.photos.map(ph => ({ ...ph, f: f(ph.f) })),
      waypoints: r.waypoints?.map(w => ({ ...w, f: f(w.f) })),
    };
    out = {
      ...input, ...measured(trip), num: r.num,
      approach: {
        lines: it.transit.filter(id => !it.parts.includes(id)).map(id => part(id).route),
        outMi: trip.at[first],
        backMi: trip.at[trip.at.length - 1] - trip.at[last + 1],
      },
    };
  }
  ridingIn.set(r.slug, out);
  return out;
}

/** where a fraction of a ride lands on the map: exposed for the tests that check a photo stays put when the trip changes */
export const spotAt = (r: Ride, f: number) => pointAt(r.route, r.cum, f);
