import { describe, expect, it } from 'vitest';
import { KM_PER_MI } from '../lib/units.mjs';
import { composeRoute, decodeRoute, encodeRoute, type DecodedRoute, type PreparedRoute } from './routeCodec';

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

  it('ends the profile on the span itself, whatever the span divides into', () => {
    // 31.9382 km across five gaps is one of the spans where (span * n) / n comes back a float's width off;
    // a power-of-two count would divide exactly and hide it
    const span = 31.9382;
    const awkward = decodeRoute(encodeRoute({ ...prepared, span, heights: [...prepared.heights, 40] }));
    expect(awkward.profile).toHaveLength(6);
    expect(awkward.profile[5][0]).toBe(span / KM_PER_MI);
  });

  it('rejects a truncated or mismatched encoding rather than drawing nonsense', () => {
    const e = encodeRoute(prepared);
    expect(() => decodeRoute({ ...e, coords: e.coords.slice(0, 2) })).toThrow(/malformed/);
    expect(() => decodeRoute({ ...e, coords: e.coords.slice(0, 5) })).toThrow(/malformed/);
    expect(() => decodeRoute({ ...e, cum: e.cum.slice(1) })).toThrow(/malformed/);
    expect(() => decodeRoute({ ...e, ele: [1] })).toThrow(/malformed/);
  });
});

describe('composeRoute', () => {
  /** a straight part heading north from `lat`, 1 km long in two vertices, three profile samples at 100, 150, 200 ft */
  const part = (lat: number, lng = -122.4, h = [100, 150, 200]): DecodedRoute => ({
    route: [[lat, lng], [lat + 0.005, lng], [lat + 0.009, lng]],
    cum: [0, 0.556, 1.0],
    profile: [[0, h[0]], [0.5 / KM_PER_MI, h[1]], [1 / KM_PER_MI, h[2]]],
  });

  it('carries distances on from part to part and records where each part begins', () => {
    const t = composeRoute([part(37.8), part(37.809, -122.4, [200, 210, 220])]);
    expect(t.route).toHaveLength(5);
    expect(t.cum).toEqual([0, 0.556, 1, 1.556, 2]);
    expect(t.profile.map(p => p[1])).toEqual([100, 150, 200, 210, 220]);
    expect(t.profile[4][0]).toBeCloseTo(2 / KM_PER_MI, 12);
    expect(t.at).toEqual([0, 1 / KM_PER_MI, 2 / KM_PER_MI]);
  });

  it('keeps one vertex and one sample where two parts meet, whether on the same spot or a few metres apart', () => {
    const t = composeRoute([part(37.8), part(37.809)]);
    expect(t.route[2]).toEqual([37.809, -122.4]);
    expect(t.route[3]).toEqual([37.814, -122.4]);
    expect(t.profile).toHaveLength(5);
    // a 22 m gap in the plan is not road: the trip is exactly as long as its parts
    const g = composeRoute([part(37.8), part(37.8092)]);
    expect(g.route).toHaveLength(5);
    expect(g.cum).toEqual(t.cum);
    expect(g.at).toEqual(t.at);
  });

  it('gives a trip that returns to its start one height there, without touching the parts', () => {
    const north = part(37.8), back: DecodedRoute = { ...part(37.809, -122.4, [200, 150, 90]), route: [[37.809, -122.4], [37.804, -122.4], [37.8, -122.4]] };
    const t = composeRoute([north, back]);
    expect(t.profile[t.profile.length - 1][1]).toBe(100);
    expect(back.profile[2][1]).toBe(90);
    expect(composeRoute([north]).profile[2][1]).toBe(200);
  });

  it('refuses an empty trip', () => {
    expect(() => composeRoute([])).toThrow(/at least one part/);
  });
});
