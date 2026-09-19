import { describe, expect, it } from 'vitest';
import { annotations, legPath, outline, profileScale, ticks } from './profileChart';
import { legs } from './route';
import { ROUTE, SUMMIT_FT, makeRide } from './testRide';

const W = 600, H = 200, P = { l: 40, r: 10, t: 10, b: 20 };
const ride = makeRide();
const s = profileScale(ride, W, H, P);
const rect = { left: 0, width: W } as DOMRect;

describe('profileScale', () => {
  it('maps the profile onto the padded box', () => {
    expect(s.maxD).toBe(10);
    expect(s.X(0)).toBe(P.l);
    expect(s.X(s.maxD)).toBe(W - P.r);
    expect(s.Y(0)).toBe(H - P.b);
    expect(s.Y(s.maxE)).toBe(P.t);
  });
  it('rounds the top of the scale up to the next 500 ft', () => {
    expect(SUMMIT_FT).toBeGreaterThan(900);
    expect(s.maxE).toBe(1000);
    expect(profileScale(makeRide({ maxElev: 1200 }), W, H, P).maxE).toBe(1500);
  });
  it('clamps fractionAt to [0, 1] and reads the middle as 0.5', () => {
    expect(s.fractionAt(-100, rect)).toBe(0);
    expect(s.fractionAt(2 * W, rect)).toBe(1);
    expect(s.fractionAt(s.X(s.maxD / 2), rect)).toBeCloseTo(0.5, 9);
  });
  it('draws the line as a path and closes the area', () => {
    expect(s.line.startsWith('M')).toBe(true);
    expect(s.line.split('L')).toHaveLength(ride.profile.length);
    expect(s.area.startsWith(s.line)).toBe(true);
    expect(s.area.endsWith('Z')).toBe(true);
  });
});

describe('ticks', () => {
  it('places a label every 1,000 ft and 5 mi inside the scale', () => {
    const t = ticks(s);
    expect(t.y).toEqual([]); // maxE is exactly 1,000
    expect(t.x).toEqual([{ x: s.X(5), label: '5 mi' }]);
    const tall = ticks(profileScale(makeRide({ maxElev: 2400 }), W, H, P));
    expect(tall.y.map(y => y.label)).toEqual(['1,000 ft', '2,000 ft']);
  });
});

describe('annotations', () => {
  const card = legs(ride);
  const a = annotations(ride, s, card);
  it('labels each climb with its grade', () => {
    expect(a.grades).toHaveLength(1);
    expect(a.grades[0].label).toBe('7%');
  });
  it('marks the summit as the high point', () => {
    expect(a.summit.label).toContain('high point');
    expect(a.summit.label).toContain('939 ft');
    expect(a.summit.x).toBeGreaterThanOrEqual(s.X(4)); // somewhere on the plateau
    expect(a.summit.x).toBeLessThanOrEqual(s.X(6));
    expect(a.summit.y).toBeLessThan(s.Y(SUMMIT_FT)); // the label sits above the line
  });
  it('dashes the steep descent and numbers every waypoint but the finish', () => {
    expect(a.descents).toHaveLength(1);
    expect(a.descents[0].startsWith('M')).toBe(true);
    expect(a.wps).toHaveLength(card.wp.length - 1);
    expect(a.wps.map(w => w.label)).toEqual(['i', 'ii', 'iii']);
  });
});

describe('legPath', () => {
  const leg = { from: '', to: '', mi: 0, gain: 0, loss: 0, t: 0 };
  it('is empty when the leg spans fewer than two profile points', () => {
    expect(legPath(s, { ...leg, a: 0.01, b: 0.05 })).toBe('');
  });
  it('otherwise traces the points inside the leg', () => {
    const d = legPath(s, { ...leg, a: 0, b: 0.2 });
    expect(d.startsWith('M')).toBe(true);
    expect(d.split('L')).toHaveLength(5); // miles 0, 0.5, 1, 1.5, 2
  });
});

describe('outline', () => {
  const o = outline(ROUTE);
  const nums = (o.d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  it('fits every point in the 96×68 thumbnail below the 24 px label band', () => {
    expect(o.d.startsWith('M')).toBe(true);
    expect(nums).toHaveLength(2 * ROUTE.length);
    for (let i = 0; i < nums.length; i += 2) {
      expect(nums[i]).toBeGreaterThanOrEqual(0);
      expect(nums[i]).toBeLessThanOrEqual(96);
      expect(nums[i + 1]).toBeGreaterThanOrEqual(24);
      expect(nums[i + 1]).toBeLessThanOrEqual(68);
    }
  });
  it('puts the start dot on the first point, with north up', () => {
    expect([o.cx, o.cy]).toEqual([nums[0], nums[1]]);
    expect(nums[nums.length - 1]).toBeLessThan(o.cy); // the route ends further north, so higher on the card
  });
});
