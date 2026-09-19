// A small synthetic ride for the src/lib tests. Deliberately independent of the guide's data
// (and of how the real profiles are generated) so the tests only exercise the lib functions.
import type { LatLng, ProfilePoint, Ride } from '../data/types';
import { cum } from './geo';
import { FT_PER_MI } from './units.mjs';

/** the climb's start and end as fractions of the route */
export const CLIMB = { a: 0.2, b: 0.4 };
export const SUMMIT_FT = 200 + 0.14 * FT_PER_MI;

/** elevation at mile d: 2 mi flat, a 7% climb over 2 mi, a 2 mi plateau, an 8% descent over 1.5 mi, then flat */
const elevation = (d: number) => {
  if (d <= 2) return 200;
  if (d <= 4) return 200 + 0.07 * (d - 2) * FT_PER_MI;
  if (d <= 6) return SUMMIT_FT;
  if (d <= 7.5) return SUMMIT_FT - 0.08 * (d - 6) * FT_PER_MI;
  return SUMMIT_FT - 0.12 * FT_PER_MI;
};

/** 10 mi sampled every half mile (21 points). Evenly spaced, which `gradeAt` relies on like the real profiles. */
export const PROFILE: ProfilePoint[] = Array.from({ length: 21 }, (_, i) => [i / 2, elevation(i / 2)]);

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
  const base: Ride = {
    slug: 'test-loop',
    name: 'Test Loop',
    area: 'Marin',
    start: 'Fairfax, the Parkade',
    miles: 10,
    lengthMi: 10,
    feet: SUMMIT_FT - 200,
    hours: '1½–2 h',
    tagline: '',
    notes: [],
    story: [],
    photos: [],
    route: ROUTE,
    profile: PROFILE,
    maxElev: SUMMIT_FT,
    cum: cum(ROUTE),
    num: 1,
  };
  return { ...base, ...over };
}
