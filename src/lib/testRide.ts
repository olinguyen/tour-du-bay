// A small synthetic ride for the src/lib tests. Deliberately independent of the guide's data
// (and of how the real profiles are generated) so the tests only exercise the lib functions.
import type { LatLng, ProfilePoint, Ride } from '../data/types';
import { cum } from './geo';

const FT_PER_MI = 5280;

/** 10 mi in 12 points: 2 mi flat, a 7% climb over 2 mi, a 2 mi plateau, an 8% descent over 1.5 mi, then flat. */
export const PROFILE: ProfilePoint[] = [
  [0, 200],
  [1, 200],
  [2, 200],
  [3, 200 + 0.07 * FT_PER_MI],
  [4, 200 + 0.14 * FT_PER_MI],
  [5, 200 + 0.14 * FT_PER_MI],
  [6, 200 + 0.14 * FT_PER_MI],
  [7, 200 + 0.06 * FT_PER_MI],
  [7.5, 200 + 0.02 * FT_PER_MI],
  [8, 200 + 0.02 * FT_PER_MI],
  [9, 200 + 0.02 * FT_PER_MI],
  [10, 200 + 0.02 * FT_PER_MI],
];

/** the climb's start and end as fractions of the route, and its total gain in feet */
export const CLIMB = { a: 0.2, b: 0.4, gain: 0.14 * FT_PER_MI };
export const SUMMIT_FT = 200 + 0.14 * FT_PER_MI;

/** 5 vertices zig-zagging north-east across the Bay; each leg is due north or due east. */
export const ROUTE: LatLng[] = [
  [37.8, -122.42],
  [37.8, -122.4],
  [37.82, -122.4],
  [37.82, -122.38],
  [37.84, -122.38],
];

/** A loop ride from Fairfax with the synthetic profile; pass overrides for a finish, waypoints, photos, hours… */
export function makeRide(over: Partial<Ride> = {}): Ride {
  const base = {
    slug: 'test-loop',
    name: 'Test Loop',
    area: 'Marin',
    start: 'Fairfax, the Parkade',
    miles: 10,
    feet: Math.round(CLIMB.gain),
    hours: '1½–2 h',
    tagline: '',
    notes: [],
    story: [],
    profileKeys: PROFILE,
    photos: [],
    route: ROUTE,
    profile: PROFILE,
    maxElev: SUMMIT_FT,
    cum: cum(ROUTE),
    num: 1,
  };
  // Asserted rather than annotated so the helper keeps compiling while the Ride shape evolves.
  return { ...base, ...over } as Ride;
}
