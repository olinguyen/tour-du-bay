import { describe, expect, it } from 'vitest';
import type { RoutePoint } from '../data/routes.generated';
import type { ProfilePoint } from '../data/types';
import {
  areaSlug, climbSeries, climbs, elevAt, elevationGain, fmt, gradeAt, highPoint, hm, hoursOf, legs, miles, pad2, place,
  prepareRoute, roman, steepDescents, waypoints,
} from './route';
import { CLIMB, PROFILE, SUMMIT_FT, makeRide } from './testRide';

const FLAT: ProfilePoint[] = [[0, 100], [1, 100], [2, 100], [3, 100]];
const ride = makeRide();

/** half-mile samples of a hand-written list of heights */
const profileOf = (heights: number[]): ProfilePoint[] => heights.map((h, i) => [i / 2, h]);

/** the synthetic ride closed into a loop: the same climb, then a steady descent back to the height it started at */
const LOOP: ProfilePoint[] = Array.from({ length: 21 }, (_, i): ProfilePoint => {
  const d = i / 2;
  if (d <= 2) return [d, 200];
  if (d <= 4) return [d, 200 + 0.07 * (d - 2) * 5280];
  if (d <= 6) return [d, SUMMIT_FT];
  return [d, SUMMIT_FT - ((SUMMIT_FT - 200) * (d - 6)) / 4];
});

/** a triangle back to where it began, whose closing point the router read 40 ft above the opening one */
const TRIANGLE: RoutePoint[] = [
  [37.8, -122.42, 100],
  [37.81, -122.42, 300],
  [37.81, -122.41, 250],
  [37.8, -122.42, 140],
];

describe('formatters', () => {
  it('format times, numerals and names', () => {
    expect(hm(1.75)).toBe('1:45');
    expect(hm(2)).toBe('2:00');
    expect(roman(4)).toBe('iv');
    expect(roman(13)).toBe('13');
    expect(pad2(3)).toBe('03');
    expect(place('Fairfax, the Parkade')).toBe('Fairfax');
    expect(areaSlug('East Bay')).toBe('east-bay');
    expect(fmt(4900)).toBe('4,900');
    expect(miles(19.848)).toBe('19.8');
    expect(miles(17)).toBe('17.0');
  });
});

describe('climbSeries', () => {
  it('counts the climbs and descents, ignoring reversals under the threshold', () => {
    const { gain, loss } = climbSeries(profileOf([100, 120, 500, 480, 600, 100]));
    expect(gain[5]).toBe(500); // the 20 ft wobbles either side of 500 are terrain-model noise, not a climb
    expect(loss[5]).toBe(500);
  });
  it('leaves gain and loss differing by exactly the net change in height', () => {
    // each profile ends part-way through a move the hysteresis was still waiting on, or starts with one
    for (const hs of [[100, 500, 480], [100, 80, 500], [100, 500, 100, 130], [100, 120, 90]]) {
      const p = profileOf(hs), { gain, loss } = climbSeries(p), i = p.length - 1;
      expect(gain[i] - loss[i]).toBeCloseTo(hs[i] - hs[0], 9);
    }
  });
  it('descends as much as it climbs on a profile that ends where it started', () => {
    const { gain, loss } = climbSeries(LOOP), i = LOOP.length - 1;
    expect(gain[i]).toBeCloseTo(SUMMIT_FT - 200, 9);
    expect(loss[i]).toBeCloseTo(gain[i], 9);
  });
  it('accumulates without ever going backwards', () => {
    const { gain, loss } = climbSeries(PROFILE);
    for (let i = 1; i < PROFILE.length; i++) {
      expect(gain[i]).toBeGreaterThanOrEqual(gain[i - 1]);
      expect(loss[i]).toBeGreaterThanOrEqual(loss[i - 1]);
    }
  });
});

describe('prepareRoute', () => {
  it('gives a route that returns to its start one height there, not two', () => {
    const { profile } = prepareRoute(TRIANGLE);
    expect(profile[0][1]).toBe(100);
    expect(profile[profile.length - 1][1]).toBe(100);
    expect(elevationGain(profile)).toBeCloseTo(climbSeries(profile).loss[profile.length - 1], 9);
  });
  it('leaves a point-to-point route ending where the router put it', () => {
    const { profile } = prepareRoute(TRIANGLE.slice(0, 3));
    expect(profile[profile.length - 1][1]).toBe(250);
  });
});

describe('elevAt', () => {
  it('returns the endpoints at f = 0 and f = 1', () => {
    expect(elevAt(PROFILE, 0)).toBe(PROFILE[0][1]);
    expect(elevAt(PROFILE, 1)).toBe(PROFILE[PROFILE.length - 1][1]);
  });
  it('hits vertices and interpolates between them', () => {
    // half-mile samples: mile 3 is index 6, and 2.5 mi sits on the vertex between 2 and 3
    expect(elevAt(PROFILE, 0.3)).toBeCloseTo(PROFILE[6][1], 9);
    expect(elevAt(PROFILE, 0.275)).toBeCloseTo((PROFILE[5][1] + PROFILE[6][1]) / 2, 9);
  });
});

describe('gradeAt', () => {
  it('is +7% on the climb, -8% on the descent and 0 on the flat', () => {
    expect(gradeAt(PROFILE, 0.25)).toBeCloseTo(7, 6);
    expect(gradeAt(PROFILE, 0.65)).toBeCloseTo(-8, 6);
    expect(gradeAt(PROFILE, 0.05)).toBe(0);
  });
});

describe('highPoint', () => {
  it('finds the plateau', () => {
    const hp = highPoint(ride);
    expect(hp.elev).toBe(SUMMIT_FT);
    expect(hp.f).toBeGreaterThanOrEqual(CLIMB.b);
    expect(hp.f).toBeLessThanOrEqual(0.6);
  });
});

describe('climbs', () => {
  it('returns exactly the 7% stretch as fractions', () => {
    const c = climbs(ride);
    expect(c).toHaveLength(1);
    expect(c[0].a).toBeCloseTo(CLIMB.a, 9);
    expect(c[0].b).toBeCloseTo(CLIMB.b, 9);
  });
  it('finds nothing on a flat profile', () => expect(climbs(makeRide({ profile: FLAT }))).toEqual([]));
  it('respects the minimum grade', () => expect(climbs(ride, 0.08)).toEqual([]));
});

describe('steepDescents', () => {
  it('finds the -8% stretch from the plateau to the valley', () => {
    const d = steepDescents(PROFILE);
    expect(d).toHaveLength(1);
    const [i0, i1] = d[0];
    expect(PROFILE[i0][1]).toBe(SUMMIT_FT);
    expect(PROFILE[i1 - 1][1]).toBe(PROFILE[PROFILE.length - 1][1]);
    expect(PROFILE[i1 - 1][0] - PROFILE[i0][0]).toBe(1.5);
  });
  it('finds nothing on a flat profile', () => expect(steepDescents(FLAT)).toEqual([]));
});

describe('waypoints', () => {
  it('runs from the start to the finish (or back to the start on a loop)', () => {
    const w = waypoints(ride);
    expect(w[0]).toEqual({ f: 0, name: 'Fairfax' });
    expect(w[w.length - 1]).toEqual({ f: 1, name: 'Fairfax' });
    const p2p = waypoints(makeRide({ finish: 'Sausalito, the ferry' }));
    expect(p2p[p2p.length - 1]).toEqual({ f: 1, name: 'Sausalito' });
  });
  it('derives the climb and high point when none are given', () => {
    expect(waypoints(ride).map(w => w.name)).toEqual(['Fairfax', 'Foot of climb 1', 'High point', 'Fairfax']);
  });
  it('merges candidates within tol, keeping the higher priority, and includes photo captions', () => {
    const w = waypoints(makeRide({
      photos: [
        { f: 0.02, cap: 'Leaving town' }, // within tol of the start, which outranks a photo
        { f: 0.42, cap: 'Ridge overlook, looking west' }, // within tol of the high point, which a photo outranks
        { f: 0.7, cap: 'Valley floor' },
      ],
    }));
    expect(w.map(x => x.name)).toEqual(['Fairfax', 'Foot of climb 1', 'Ridge overlook', 'Valley floor', 'Fairfax']);
    for (let i = 1; i < w.length; i++) expect(w[i].f - w[i - 1].f).toBeGreaterThanOrEqual(0.05);
  });
  it('uses the ride’s own waypoints instead of derived ones', () => {
    const w = waypoints(makeRide({ waypoints: [{ f: 0.5, name: 'Summit café' }] }));
    expect(w.map(x => x.name)).toEqual(['Fairfax', 'Summit café', 'Fairfax']);
  });
});

describe('hoursOf', () => {
  it('takes the midpoint of a range, a single figure, or null', () => {
    expect(hoursOf({ hours: '1½–2 h' })).toBe(1.75);
    expect(hoursOf({ hours: '2 h' })).toBe(2);
    expect(hoursOf({ hours: '' })).toBeNull();
  });
});

describe('legs', () => {
  it('has one leg per pair of waypoints, covering the whole distance', () => {
    const card = legs(ride);
    expect(card.legs).toHaveLength(card.wp.length - 1);
    expect(card.legs.reduce((s, l) => s + l.mi, 0)).toBeCloseTo(ride.lengthMi, 9);
    expect(card.legs.every(l => l.mi > 0 && l.t > 0)).toBe(true);
  });
  it('calibrates gain and time to the stated feet and hours', () => {
    const card = legs(ride);
    expect(card.legs.reduce((s, l) => s + l.gain, 0)).toBeCloseTo(ride.feet, 6);
    expect(card.legs.reduce((s, l) => s + l.t, 0)).toBeCloseTo(1.75, 6);
    expect(card.hours).toBe(1.75);
  });
  it('descends what it climbs on a loop, so both columns add up to the headline', () => {
    const loop = makeRide({ profile: LOOP, feet: SUMMIT_FT - 200 });
    const card = legs(loop);
    expect(card.legs.reduce((s, l) => s + l.gain, 0)).toBeCloseTo(loop.feet, 6);
    expect(card.legs.reduce((s, l) => s + l.loss, 0)).toBeCloseTo(loop.feet, 6);
  });
  it('is a loop without a finish, and not with one', () => {
    expect(legs(ride).loop).toBe(true);
    expect(legs(makeRide({ finish: 'Sausalito' })).loop).toBe(false);
  });
});
