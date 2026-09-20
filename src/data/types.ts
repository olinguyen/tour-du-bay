export type Area = 'Marin' | 'East Bay' | 'Peninsula';
export type LatLng = [lat: number, lng: number];
/** [distance in miles, elevation in feet] */
export type ProfilePoint = [miles: number, feet: number];

export interface Photo {
  /** position along the route, as a fraction of total distance */
  f: number;
  cap: string;
  /** optional image URL; a placeholder is drawn when absent */
  src?: string;
}

export interface Waypoint {
  f: number;
  name: string;
}

export interface RideInput {
  slug: string;
  name: string;
  area: Area;
  start: string;
  /** set when the start is reachable by transit, e.g. 'BART' */
  transit?: string;
  /** which side of the start dot the map label sits */
  labelSide?: 'l' | 'r';
  /** stated riding time, e.g. '1½–2 h'; leg times are calibrated to it */
  hours: string;
  tagline: string;
  notes: string[];
  story: string[];
  photos: Photo[];
  waypoints?: Waypoint[];
  /** for point-to-point rides; loops omit it */
  finish?: string;
  /** the start's name where it is lettered on the map, when the full one is too long to sit beside the dot */
  startLabel?: string;
  /**
   * a second way to start: ride in from here and back, on legs planned in scripts/route-plans.json under the
   * itinerary's `transit`. A station when there is one near enough (`transit` names the system, e.g. 'BART'), or the
   * Panhandle for a ride reached through the city. `via` names where the way in meets the ride, when that is not the ride's own start.
   */
  from?: { start: string; transit?: string; via?: string };
}

/** A ride with its planned geometry (src/data/routes.generated.ts) prepared: everything shown derives from it. */
export interface Ride extends RideInput {
  /** road-following planned route */
  route: LatLng[];
  /** cumulative distance (km) at each route vertex */
  cum: number[];
  /** [miles, feet] sampled every ~25 m and lightly smoothed */
  profile: ProfilePoint[];
  /** measured route length in miles; every distance shown is this one, converted and rounded in lib/measure */
  lengthMi: number;
  /** climbing from the terrain profile, ignoring reversals under 10 m */
  feet: number;
  maxElev: number;
  /** 1-based position in the guide, shown on start dots and thumbnails */
  num: number;
  /** set on the ride in from `from`: the legs that are not the ride itself, drawn lighter, and how long each way is */
  approach?: {
    lines: LatLng[][];
    outMi: number;
    backMi: number;
    /** where the ride as planned begins and ends on this trip, by the name of its own start: the route card's first and last stops of the ride itself */
    ends: Waypoint[];
  };
}

export interface MapLabel {
  t: string;
  k: 'town' | 'peak' | 'water';
  major?: boolean;
  ll: LatLng;
}

export interface Leg {
  a: number;
  b: number;
  from: string;
  to: string;
  mi: number;
  gain: number;
  loss: number;
  /** hours */
  t: number;
}

export interface RouteCard {
  wp: Waypoint[];
  legs: Leg[];
  hours: number;
  loop: boolean;
}
