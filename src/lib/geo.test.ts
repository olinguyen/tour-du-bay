import { describe, expect, it } from 'vitest';
import type { LatLng } from '../data/types';
import { bounds, cum, hav, pointAt, sliceBetween, sliceTo } from './geo';
import { ROUTE } from './testRide';

const SF: LatLng = [37.7749, -122.4194], OAK: LatLng = [37.8044, -122.2712];
const C = cum(ROUTE), L = C[C.length - 1];
/** how far along the route (km) a point on segment i is */
const along = (i: number, p: LatLng) => C[i - 1] + hav(ROUTE[i - 1], p);
/** whether p lies on the straight line through a and b (a zero triangle inequality gap, or beyond either end) */
const onLine = (a: LatLng, b: LatLng, p: LatLng) => {
  const ab = hav(a, b), ap = hav(a, p), pb = hav(p, b);
  return Math.abs(ap + pb - ab) < 1e-6 || Math.abs(Math.abs(ap - pb) - ab) < 1e-6;
};

describe('hav', () => {
  it('measures SF to Oakland at about 13.4 km', () => expect(hav(SF, OAK)).toBeCloseTo(13.4, 0));
  it('is symmetric', () => expect(hav(SF, OAK)).toBe(hav(OAK, SF)));
  it('is zero for the same point', () => expect(hav(SF, SF)).toBe(0));
});

describe('cum', () => {
  it('starts at zero and climbs strictly', () => {
    expect(C[0]).toBe(0);
    expect(C).toHaveLength(ROUTE.length);
    for (let i = 1; i < C.length; i++) expect(C[i]).toBeGreaterThan(C[i - 1]);
  });
  it('ends at the sum of the legs', () => {
    let sum = 0;
    for (let i = 1; i < ROUTE.length; i++) sum += hav(ROUTE[i - 1], ROUTE[i]);
    expect(L).toBeCloseTo(sum, 9);
  });
});

describe('pointAt', () => {
  it('returns the endpoints at f = 0 and f = 1', () => {
    expect(pointAt(ROUTE, C, 0)).toEqual(ROUTE[0]);
    const end = pointAt(ROUTE, C, 1);
    expect(end[0]).toBeCloseTo(ROUTE[4][0], 9);
    expect(end[1]).toBeCloseTo(ROUTE[4][1], 9);
  });
  it('puts f = 0.5 on the segment holding the halfway distance', () => {
    const p = pointAt(ROUTE, C, 0.5);
    const i = C.findIndex(d => d >= L / 2); // first vertex at or past halfway ends that segment
    expect(onLine(ROUTE[i - 1], ROUTE[i], p)).toBe(true);
    expect(along(i, p)).toBeCloseTo(L / 2, 9);
  });
  it('stays finite and on the end segments for f outside [0, 1]', () => {
    const before = pointAt(ROUTE, C, -0.5), after = pointAt(ROUTE, C, 1.5);
    for (const v of [...before, ...after]) expect(Number.isFinite(v)).toBe(true);
    expect(onLine(ROUTE[0], ROUTE[1], before)).toBe(true);
    expect(onLine(ROUTE[3], ROUTE[4], after)).toBe(true);
  });
});

describe('sliceTo', () => {
  it('gives the whole route at f = 1', () => expect(sliceTo(ROUTE, C, 1)).toEqual(ROUTE));
  it('gives two coincident points at f = 0', () => expect(sliceTo(ROUTE, C, 0)).toEqual([ROUTE[0], ROUTE[0]]));
  it('ends exactly at pointAt(f)', () => {
    const s = sliceTo(ROUTE, C, 0.6);
    expect(s[s.length - 1]).toEqual(pointAt(ROUTE, C, 0.6));
    expect(s.length).toBeGreaterThan(2);
  });
});

describe('sliceBetween', () => {
  it('starts and ends at pointAt(f0) and pointAt(f1)', () => {
    const s = sliceBetween(ROUTE, C, 0.2, 0.7);
    expect(s[0]).toEqual(pointAt(ROUTE, C, 0.2));
    expect(s[s.length - 1]).toEqual(pointAt(ROUTE, C, 0.7));
    // only the vertices strictly inside the window sit between them
    const inside = ROUTE.filter((_, i) => C[i] > 0.2 * L && C[i] < 0.7 * L);
    expect(s.slice(1, -1)).toEqual(inside);
  });
  it('is the whole route from 0 to 1', () => {
    const s = sliceBetween(ROUTE, C, 0, 1);
    expect(s).toHaveLength(ROUTE.length);
    expect(s[0]).toEqual(ROUTE[0]);
    expect(s[4][0]).toBeCloseTo(ROUTE[4][0], 9);
  });
});

describe('bounds', () => {
  it('spans every vertex of every route', () => {
    const other: LatLng[] = [[37.7, -122.5], [37.9, -122.3]];
    expect(bounds([ROUTE, other])).toEqual([[37.7, -122.5], [37.9, -122.3]]);
    expect(bounds([ROUTE])).toEqual([[37.8, -122.42], [37.84, -122.38]]);
  });
});
