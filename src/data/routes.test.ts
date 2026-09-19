// The published routes are stored encoded (src/data/routeCodec.ts) and prepared offline, rather than derived in
// the browser from the planned geometry. That is only allowed to change the download, never the page, so this
// compares what the guide draws against preparing scripts/route-data.json from scratch: the same two SVG paths,
// the same headline figures, the same climbs, waypoints and legs.
import { describe, expect, it } from 'vitest';
import planned from '../../scripts/route-data.json?raw';
import { annotations, outline, profileScale } from '../lib/profileChart';
import { prepareRoute, type RoutePoint } from '../lib/prepare';
import { climbs, elevationGain, hm, legs, steepDescents } from '../lib/route';
import { RIDES } from './guide';
import type { ProfilePoint, Ride } from './types';

const KM_PER_MI = 1.609344;
const PAD = { l: 34, r: 12, t: 18, b: 22 };

/**
 * Two pieces of drawn SVG agree to the tenth of a pixel they are written at. A vertex rounded onto the 1.1 m
 * coordinate grid can land the other side of that tenth, so a handful of digits differ by one; nothing else may.
 */
function sameDrawing(a: string, b: string) {
  const [x, y] = [a, b].map(path => (path.match(/-?\d+(?:\.\d+)?/g) ?? []).map(n => Math.round(Number(n) * 10)));
  expect(x).toHaveLength(y.length);
  expect(Math.max(0, ...x.map((v, i) => Math.abs(v - y[i])))).toBeLessThanOrEqual(1);
}

/** the generator's own record of the planned geometry, which the page used to prepare on every load */
const plans: Record<string, { points: RoutePoint[] }> = JSON.parse(planned);

/** the ride the guide would have shown when the page prepared the planned geometry itself */
function fromPlan(ride: Ride): Ride {
  const p = prepareRoute(plans[ride.slug].points);
  const n = p.heights.length - 1;
  const profile: ProfilePoint[] = p.heights.map((h, i) => [(p.span * i) / n / KM_PER_MI, h]);
  const lengthMi = profile[profile.length - 1][0];
  return {
    ...ride, route: p.route, cum: p.cum, profile, lengthMi, miles: Math.round(lengthMi),
    feet: Math.round(elevationGain(profile)), maxElev: Math.max(...profile.map(q => q[1])),
  };
}

describe.each(RIDES.map(r => [r.slug, r] as const))('%s', (_slug, ride) => {
  const before = fromPlan(ride);

  it('draws the same route line, vertex for vertex, within the 1.1 m coordinate grid', () => {
    expect(ride.route).toHaveLength(before.route.length);
    const off = ride.route.map((p, i) => Math.hypot(p[0] - before.route[i][0], p[1] - before.route[i][1]) * 111320);
    expect(Math.max(...off)).toBeLessThan(1);
  });

  it('keeps every road distance within a decimetre', () => {
    expect(ride.cum).toHaveLength(before.cum.length);
    expect(Math.max(...ride.cum.map((c, i) => Math.abs(c - before.cum[i]) * 1000))).toBeLessThan(0.1);
  });

  it('keeps the profile on the same distances and within a hundredth of a foot', () => {
    expect(ride.profile).toHaveLength(before.profile.length);
    expect(Math.max(...ride.profile.map((p, i) => Math.abs(p[0] - before.profile[i][0])))).toBeLessThan(1e-9);
    expect(Math.max(...ride.profile.map((p, i) => Math.abs(p[1] - before.profile[i][1])))).toBeLessThanOrEqual(0.005);
  });

  it('shows the same distance and climbing', () => {
    expect(ride.miles).toBe(before.miles);
    expect(ride.feet).toBe(before.feet);
    expect(ride.lengthMi).toBeCloseTo(before.lengthMi, 9);
    expect(Math.round(ride.maxElev)).toBe(Math.round(before.maxElev));
  });

  it('finds the same climbs and steep descents', () => {
    expect(steepDescents(ride.profile)).toEqual(steepDescents(before.profile));
    const [a, b] = [climbs(ride), climbs(before)];
    expect(a).toHaveLength(b.length);
    a.forEach((c, i) => {
      expect(c.a).toBeCloseTo(b[i].a, 5);
      expect(c.b).toBeCloseTo(b[i].b, 5);
    });
  });

  it('splits the route card into the same legs', () => {
    const [a, b] = [legs(ride), legs(before)];
    expect(a.legs.map(l => [l.from, l.to])).toEqual(b.legs.map(l => [l.from, l.to]));
    expect(a.wp.map(w => w.name)).toEqual(b.wp.map(w => w.name));
    a.legs.forEach((l, i) => {
      expect(Math.round(l.gain)).toBe(Math.round(b.legs[i].gain));
      expect(Math.round(l.loss)).toBe(Math.round(b.legs[i].loss));
      expect(l.mi).toBeCloseTo(b.legs[i].mi, 4);
      // the times are calibrated to the ride's stated hours, so only their split can move, and only by seconds
      expect(hm(l.t)).toBe(hm(b.legs[i].t));
    });
  });

  it('draws the same thumbnail', () => {
    const [a, b] = [outline(ride.route), outline(before.route)];
    sameDrawing(`${a.cx} ${a.cy}`, `${b.cx} ${b.cy}`);
    sameDrawing(a.d, b.d);
  });

  it('draws the same profile, path data and annotations included', () => {
    const [s, t] = [profileScale(ride, 760, 220, PAD), profileScale(before, 760, 220, PAD)];
    expect(s.maxE).toBe(t.maxE);
    sameDrawing(s.line, t.line);
    sameDrawing(s.area, t.area);
    const [a, b] = [annotations(ride, s, legs(ride)), annotations(before, t, legs(before))];
    sameDrawing(a.clip, b.clip);
    expect(a.contours).toEqual(b.contours);
    expect(a.grades.map(g => g.label)).toEqual(b.grades.map(g => g.label));
    expect(a.summit.label).toBe(b.summit.label);
    expect(a.summit.anchor).toBe(b.summit.anchor);
    expect(a.wps.map(w => w.label)).toEqual(b.wps.map(w => w.label));
    expect(a.descents).toHaveLength(b.descents.length);
    a.descents.forEach((d, i) => sameDrawing(d, b.descents[i]));
  });
});
