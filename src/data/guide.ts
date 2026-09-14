// The ride collection as the app sees it: editorial inputs (rides.ts) joined to their planned, road-following
// geometry (routes.generated.ts) and everything derived from it — route, profile, distance, climbing.
import { elevationGain, prepareRoute } from '../lib/route';
import { AREAS, RIDE_INPUTS } from './rides';
import { ROUTES } from './routes.generated';
import type { Area, Ride } from './types';

export { AREAS, LABELS } from './rides';

export const RIDES: Ride[] = RIDE_INPUTS.map((r, i) => {
  const planned = ROUTES[r.slug];
  if (!planned) throw new Error(`${r.slug}: no planned route in routes.generated.ts (add it to scripts/route-plans.json and run npm run routes)`);
  const { route, cum, profile } = prepareRoute(planned.points);
  const miles = Math.round(profile[profile.length - 1][0]);
  // The stated distance is only a sanity check on the plan; the measured one is what the guide shows.
  if (import.meta.env.DEV && Math.abs(miles - r.miles) > 0.15 * r.miles) {
    console.warn(`${r.slug}: planned route is ${miles} mi but the text says ${r.miles} mi — check scripts/route-plans.json`);
  }
  let maxElev = -Infinity;
  for (const p of profile) if (p[1] > maxElev) maxElev = p[1];
  return { ...r, route, cum, profile, miles, feet: Math.round(elevationGain(profile)), maxElev, num: i + 1 };
});

const BY_SLUG = new Map(RIDES.map(r => [r.slug, r]));

export const findRide = (slug: string | null | undefined) => (slug ? BY_SLUG.get(slug) : undefined);
export const ridesIn = (area: Area) => RIDES.filter(r => r.area === area);
export const areaList: readonly Area[] = AREAS;
