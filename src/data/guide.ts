import { cum } from '../lib/geo';
import { smoothProfile } from '../lib/route';
import { AREAS, RIDE_INPUTS } from './rides';
import type { Area, Ride } from './types';

export { AREAS, LABELS } from './rides';

export const RIDES: Ride[] = RIDE_INPUTS.map((r, i) => {
  const profile = smoothProfile(r.profileKeys);
  return { ...r, profile, maxElev: Math.max(...profile.map(p => p[1])), cum: cum(r.route), num: i + 1 };
});

const BY_SLUG = new Map(RIDES.map(r => [r.slug, r]));

export const findRide = (slug: string | null | undefined) => (slug ? BY_SLUG.get(slug) : undefined);
export const ridesIn = (area: Area) => RIDES.filter(r => r.area === area);
export const areaList: readonly Area[] = AREAS;
