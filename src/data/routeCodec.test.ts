import { describe, expect, it } from 'vitest';
import { decodeRoute, encodeRoute, type PreparedRoute } from './routeCodec';

const prepared: PreparedRoute = {
  span: 1.609344,
  route: [[37.8, -122.42], [37.80456, -122.41123], [37.81, -122.4]],
  cum: [0, 0.6, 1.609344],
  heights: [100, 150.25, 275.5, 60.12, 0],
};

describe('encodeRoute', () => {
  it('writes differences between scaled integers, starting from zero', () => {
    const e = encodeRoute(prepared);
    expect(e.coords).toEqual([3780000, -12242000, 456, 877, 544, 1123]);
    expect(e.cum).toEqual([0, 6000, 10093]);
    expect(e.ele).toEqual([10000, 5025, 12525, -21538, -6012]);
    expect(e.span).toBe(prepared.span);
  });

  it('keeps every number an integer, so the module gzips as digits rather than decimals', () => {
    const e = encodeRoute(prepared);
    expect([...e.coords, ...e.cum, ...e.ele].every(Number.isInteger)).toBe(true);
  });
});

describe('decodeRoute', () => {
  const d = decodeRoute(encodeRoute(prepared));

  it('returns the route to within the 1.1 m grid it was rounded onto', () => {
    expect(d.route).toHaveLength(prepared.route.length);
    d.route.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(prepared.route[i][0], 5);
      expect(p[1]).toBeCloseTo(prepared.route[i][1], 5);
    });
  });

  it('returns the road distances to within a decimetre', () => {
    d.cum.forEach((c, i) => expect(Math.abs(c - prepared.cum[i])).toBeLessThan(1e-4));
  });

  it('spaces the profile evenly across the span and keeps the heights to a hundredth of a foot', () => {
    expect(d.profile.map(p => p[0])).toEqual([0, 0.25, 0.5, 0.75, 1]);
    d.profile.forEach((p, i) => expect(p[1]).toBeCloseTo(prepared.heights[i], 2));
  });

  it('rejects a truncated or mismatched encoding rather than drawing nonsense', () => {
    const e = encodeRoute(prepared);
    expect(() => decodeRoute({ ...e, coords: e.coords.slice(0, 2) })).toThrow(/malformed/);
    expect(() => decodeRoute({ ...e, coords: e.coords.slice(0, 5) })).toThrow(/malformed/);
    expect(() => decodeRoute({ ...e, cum: e.cum.slice(1) })).toThrow(/malformed/);
    expect(() => decodeRoute({ ...e, ele: [1] })).toThrow(/malformed/);
  });
});
