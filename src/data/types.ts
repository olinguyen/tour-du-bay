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
  miles: number;
  feet: number;
  hours: string;
  tagline: string;
  notes: string[];
  story: string[];
  /** sparse [miles, feet] keyframes the smoothed profile is generated from */
  profileKeys: ProfilePoint[];
  photos: Photo[];
  route: LatLng[];
  waypoints?: Waypoint[];
  /** for point-to-point rides; loops omit it */
  finish?: string;
}

export interface Ride extends RideInput {
  profile: ProfilePoint[];
  maxElev: number;
  /** cumulative distance (km) at each route vertex */
  cum: number[];
  /** 1-based position in the guide, shown on start dots and thumbnails */
  num: number;
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
