// The ride collection as the app sees it: editorial inputs (rides.ts) joined to their planned, road-following
// geometry (routes.generated.ts, decoded) and the figures read off it — distance, climbing, high point.
import { elevationGain } from '../lib/route';
import { AREAS, RIDE_INPUTS } from './rides';
import { decodeRoute } from './routeCodec';
import { ROUTES } from './routes.generated';
import type { Area, Ride } from './types';

export { AREAS, LABELS } from './rides';

export const RIDES: Ride[] = RIDE_INPUTS.map((r, i) => {
  const planned = ROUTES[r.slug];
  if (!planned) throw new Error(`${r.slug}: no planned route in routes.generated.ts (add it to scripts/route-plans.json and run npm run routes)`);
  const { route, cum, profile } = decodeRoute(planned);
  const lengthMi = profile[profile.length - 1][0];
  let maxElev = -Infinity;
  for (const p of profile) if (p[1] > maxElev) maxElev = p[1];
  return { ...r, route, cum, profile, lengthMi, feet: Math.round(elevationGain(profile)), maxElev, num: i + 1 };
});

const BY_SLUG = new Map(RIDES.map(r => [r.slug, r]));

export const findRide = (slug: string | null | undefined) => (slug ? BY_SLUG.get(slug) : undefined);
export const ridesIn = (area: Area) => RIDES.filter(r => r.area === area);
export const areaList: readonly Area[] = AREAS;
