// prepare.ts runs offline, so what it gets wrong is committed: these cover the heights it reads off a planned route.
import { describe, expect, it } from 'vitest';
import { composeRoute, encodeRoute, decodeRoute } from '../data/routeCodec';
import { prepareRoute, type RoutePoint } from './prepare';
import { climbSeries, elevationGain } from './route';
import { KM_PER_MI } from './units.mjs';
import type { ProfilePoint } from '../data/types';

/** a triangle back to where it began, whose closing point the router read 40 ft above the opening one */
const TRIANGLE: RoutePoint[] = [
  [37.8, -122.42, 100],
  [37.81, -122.42, 300],
  [37.81, -122.41, 250],
  [37.8, -122.42, 140],
];

/** the profile the guide reads off a prepared route, as routeCodec builds it */
const profileOf = (p: ReturnType<typeof prepareRoute>): ProfilePoint[] => {
  const n = p.heights.length - 1;
  return p.heights.map((h, i) => [(p.span * i) / n / KM_PER_MI, h]);
};

/** the trip the guide composes from a single prepared part, the way guide.ts does it */
const tripOf = (points: RoutePoint[]) => composeRoute([decodeRoute(encodeRoute(prepareRoute(points)))]);

describe('prepareRoute', () => {
  it('leaves a part ending where the router put it, even one that returns to its start', () => {
    const heights = prepareRoute(TRIANGLE).heights;
    expect(heights[0]).toBe(100);
    expect(heights[heights.length - 1]).toBe(140);
    expect(profileOf(prepareRoute(TRIANGLE.slice(0, 3))).at(-1)![1]).toBe(250);
  });
  it('composed into a trip, a route that returns to its start has one height there, not two', () => {
    const { profile } = tripOf(TRIANGLE);
    expect(profile[0][1]).toBe(100);
    expect(profile[profile.length - 1][1]).toBe(100);
  });
  it('leaves a loop climbing exactly what it descends', () => {
    const { profile } = tripOf(TRIANGLE);
    expect(elevationGain(profile)).toBeCloseTo(climbSeries(profile).loss[profile.length - 1], 9);
  });
  it('leaves a point-to-point trip ending where the router put it', () => {
    const { profile } = tripOf(TRIANGLE.slice(0, 3));
    expect(profile[profile.length - 1][1]).toBeCloseTo(250, 2);
  });
});
