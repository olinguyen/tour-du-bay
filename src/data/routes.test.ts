// The published parts are stored encoded (src/data/routeCodec.ts) and prepared offline, rather than derived in
// the browser from the planned geometry. That is only allowed to change the download, never the page, so this
// compares what the guide draws against preparing scripts/route-data.json from scratch, part by part, and joining
// the parts the way the page does: the same two SVG paths, the same headline figures, the same climbs, waypoints
// and legs — for the ride as planned and for the ride in from its alternative start.
import { describe, expect, it } from 'vitest';
import planned from '../../scripts/route-data.json?raw';
import { annotations, outline, profileScale } from '../lib/profileChart';
import { prepareRoute, type RoutePoint } from '../lib/prepare';
import { climbs, elevationGain, legs, steepDescents } from '../lib/route';
import { KM_PER_MI } from '../lib/units.mjs';
import { RIDES, rideIn } from './guide';
import { composeRoute, type DecodedRoute } from './routeCodec';
import type { Ride } from './types';

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

/** the generator's own record of the planned geometry: each itinerary's points, with the run of each part */
interface Published { source: { parts: { id: string; count: number }[] }; points: RoutePoint[] }
const plans: Record<string, Published & { transit?: Published }> = JSON.parse(planned);

/** a published itinerary prepared from scratch, part by part, and joined the way the page joins the decoded parts */
function prepared(p: Published): DecodedRoute {
  const parts: DecodedRoute[] = [];
  let offset = 0;
  for (const part of p.source.parts) {
    const r = prepareRoute(p.points.slice(offset, offset + part.count));
    offset += part.count;
    const n = r.heights.length - 1;
    parts.push({ route: r.route, cum: r.cum, profile: r.heights.map((h, i) => [(i === n ? r.span : (r.span * i) / n) / KM_PER_MI, h]) });
  }
  return composeRoute(parts);
}

/** the ride the guide would show if the page prepared the planned geometry itself */
function fromPlan(ride: Ride, p: Published): Ride {
  const { route, cum, profile } = prepared(p);
  return {
    ...ride, route, cum, profile, lengthMi: profile[profile.length - 1][0],
    feet: Math.round(elevationGain(profile)), maxElev: Math.max(...profile.map(q => q[1])),
  };
}

const trips = RIDES.flatMap(r => {
  const t = rideIn(r);
  return [[r.slug, r, plans[r.slug]] as const, ...(t ? [[`${r.slug} from ${t.start}`, t, plans[r.slug].transit!] as const] : [])];
});

describe.each(trips)('%s', (_name, ride, published) => {
  const before = fromPlan(ride, published);

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
    // heights travel to a hundredth of a foot, so a total that sits on a half foot can round either way
    expect(Math.abs(ride.feet - before.feet)).toBeLessThanOrEqual(1);
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
      // as with the totals, a leg's figure sitting on a half foot can round either way
      expect(Math.abs(l.gain - b.legs[i].gain)).toBeLessThan(0.5);
      expect(Math.abs(l.loss - b.legs[i].loss)).toBeLessThan(0.5);
      expect(l.mi).toBeCloseTo(b.legs[i].mi, 4);
      // the times are calibrated to the ride's stated hours, so only their split can move, and only by seconds
      expect(Math.abs(l.t - b.legs[i].t) * 3600).toBeLessThan(2);
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

// The trip in from a station is the same ride with a way in and a way back: its route card must stay the ride's.
describe.each(RIDES.flatMap(r => (rideIn(r) ? [[r.slug, r, rideIn(r)!] as const] : [])))('%s ridden in to', (_slug, ride, trip) => {
  const numbered = /climb \d+$/;
  const [own, whole] = [legs(ride), legs(trip)];

  it('spends one leg on the way in and one on the way back', () => {
    const [first, last] = [whole.legs[0], whole.legs[whole.legs.length - 1]];
    expect(first.mi).toBeCloseTo(trip.approach!.outMi, 6);
    expect(last.mi).toBeCloseTo(trip.approach!.backMi, 6);
  });

  it('keeps every named stop of the ride, the ride\'s own start included', () => {
    const names = new Set(whole.wp.map(w => w.name));
    for (const w of own.wp) if (!numbered.test(w.name)) expect(names).toContain(w.name);
  });

  it('keeps every leg of the ride that runs between two named stops, mile for mile', () => {
    const miles = new Map(whole.legs.map(l => [`${l.from}→${l.to}`, l.mi]));
    for (const l of own.legs) {
      if (numbered.test(l.from) || numbered.test(l.to) || !miles.has(`${l.from}→${l.to}`)) continue;
      expect(miles.get(`${l.from}→${l.to}`)).toBeCloseTo(l.mi, 3);
    }
  });
});
