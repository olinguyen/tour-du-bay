// Route analysis: pure functions of a ride's elevation profile (+ optional waypoints/finish/hours).
// The profile itself is prepared offline, see src/lib/prepare.ts.
import type { Leg, ProfilePoint, Ride, RouteCard, Waypoint } from '../data/types';
import { segmentAt } from './geo';
import { FT_PER_M, FT_PER_MI } from './units.mjs';

export const areaSlug = (a: string) => a.toLowerCase().replace(/[^a-z]+/g, '-');
export const fmt = (n: number) => n.toLocaleString('en-US');
export const place = (s: string) => s.split(',')[0];
export const pad2 = (n: number) => String(n).padStart(2, '0');
export const roman = (n: number) =>
  ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii'][n - 1] ?? String(n);
/** hours → "h:mm" */
export const hm = (t: number) => {
  const m = Math.round(t * 60);
  return `${Math.floor(m / 60)}:${pad2(m % 60)}`;
};

/**
 * Cumulative climbing and descending (ft) at each profile point, with hysteresis: a reversal smaller than the
 * threshold (10 m) is terrain-model noise, not a climb; once a climb or descent is established it is counted from its
 * valley or peak, not from where it crossed the threshold. The legs read differences of these, so they always add up
 * to the totals. Erasing the noise never loses height, either: the first move is measured from where the ride began
 * and the last from where it ended, so the two totals differ by exactly the ride's net elevation change — by nothing
 * at all on a loop, whose legs therefore descend as much as they climb.
 */
export function climbSeries(p: ProfilePoint[], thresholdFt = 10 * FT_PER_M): { gain: number[]; loss: number[] } {
  const gain = [0], loss = [0], start = p[0][1];
  let lo = start, hi = start, dir: -1 | 0 | 1 = 0, g = 0, l = 0;
  for (let i = 1; i < p.length; i++) {
    const h = p[i][1];
    if (dir === 1) {
      if (h > hi) (g += h - hi), (hi = h);
      else if (hi - h >= thresholdFt) (dir = -1), (lo = h), (l += hi - h);
    } else if (dir === -1) {
      if (h < lo) (l += lo - h), (lo = h);
      else if (h - lo >= thresholdFt) (dir = 1), (hi = h), (g += h - lo);
    } else {
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
      // the first move is measured from the ride's own starting height, not from the noise it wandered through first
      if (h - lo >= thresholdFt) (dir = 1), (hi = h), (g += h - start);
      else if (hi - h >= thresholdFt) (dir = -1), (lo = h), (l += start - h);
    }
    gain.push(g);
    loss.push(l);
  }
  // the ride stops mid-climb or mid-descent, short of the peak or valley the hysteresis was still waiting for; that
  // last stretch counts as well, and counting it is what leaves gain - loss equal to the net change in height
  const drift = p[p.length - 1][1] - start - (g - l);
  if (drift > 0) gain[gain.length - 1] += drift;
  else loss[loss.length - 1] -= drift;
  return { gain, loss };
}

/** total climbing (ft) of a profile, see climbSeries */
export const elevationGain = (p: ProfilePoint[], thresholdFt?: number) => climbSeries(p, thresholdFt).gain[p.length - 1];

/** index of the first profile point at or past distance d (miles) */
const profileAt = (p: ProfilePoint[], d: number) => segmentAt(p, d, q => q[0]);

/** elevation (ft) at fraction f of the profile */
export function elevAt(p: ProfilePoint[], f: number): number {
  const d = f * p[p.length - 1][0], i = profileAt(p, d);
  const t = (d - p[i - 1][0]) / Math.max(1e-9, p[i][0] - p[i - 1][0]);
  return p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t;
}

/** grade (%) around fraction f: the rise over the ~0.1 mi window centred there, so one noisy 25 m sample can't dominate */
export function gradeAt(p: ProfilePoint[], f: number, windowMi = 0.1): number {
  const tot = p[p.length - 1][0], d = f * tot;
  const a = Math.max(0, d - windowMi / 2), b = Math.min(tot, a + windowMi);
  if (b - a <= 0) return 0;
  return ((elevAt(p, b / tot) - elevAt(p, a / tot)) / ((b - a) * FT_PER_MI)) * 100;
}

export function highPoint(r: Ride): { f: number; elev: number } {
  const p = r.profile, tot = p[p.length - 1][0];
  const hi = p.reduce((m, q) => (q[1] > m[1] ? q : m), p[0]);
  return { f: hi[0] / tot, elev: hi[1] };
}

/** grade (as a fraction) of the profile over the window of GRADE_WINDOW miles ending at point i: samples are ~25 m apart, so a single one says little */
const GRADE_WINDOW = 0.15;
function windowGrade(p: ProfilePoint[], i: number): number {
  const d1 = p[i][0], d0 = Math.max(0, d1 - GRADE_WINDOW), tot = p[p.length - 1][0];
  return d1 - d0 <= 0 ? 0 : (p[i][1] - elevAt(p, d0 / tot)) / ((d1 - d0) * FT_PER_MI);
}

/**
 * Index ranges [i0, i1) where the windowed grade, times `sign`, runs at or above `grade` (in fraction units). A stretch
 * begins where the window first reaches the grade and ends only once it falls below half of it, so a steady climb
 * with a brief easing stays one climb; pieces separated by under 0.2 mi are merged, and each kept stretch must be at
 * least minLen miles with an average of at least three quarters of the grade.
 */
function stretches(p: ProfilePoint[], sign: 1 | -1, grade: number, minLen: number): [number, number][] {
  const raw: [number, number][] = [];
  let i0: number | null = null;
  for (let i = 1; i < p.length; i++) {
    const g = sign * windowGrade(p, i);
    // the window trails the road, so start looking one window back; the snap below finds the valley or peak in it
    if (i0 == null && g >= grade) i0 = Math.max(0, profileAt(p, p[i][0] - GRADE_WINDOW) - 1);
    else if (i0 != null && g < grade / 2) {
      raw.push([i0, i]);
      i0 = null;
    }
  }
  if (i0 != null) raw.push([i0, p.length]);
  // the trailing window lags the road: a climb is detected after it starts and ends after the top, so pin each
  // stretch to its lowest and highest points (a climb runs valley to summit, a descent summit to valley)
  const snapped = raw.map(([a, b]): [number, number] => {
    let min = a, max = a;
    for (let i = a; i < b; i++) {
      if (p[i][1] < p[min][1]) min = i;
      if (p[i][1] > p[max][1]) max = i;
    }
    const [s, e] = sign === 1 ? [min, max] : [max, min];
    return s < e ? [s, e + 1] : [a, b];
  });
  const merged: [number, number][] = [];
  for (const s of snapped) {
    const l = merged[merged.length - 1];
    if (l && p[s[0]][0] - p[l[1] - 1][0] < 0.2) l[1] = s[1];
    else merged.push(s);
  }
  return merged.filter(([a, b]) => {
    const len = p[b - 1][0] - p[a][0];
    return len >= minLen && (sign * (p[b - 1][1] - p[a][1])) / (len * FT_PER_MI) >= grade * 0.75;
  });
}

/** contiguous stretches steeper than minGrade for at least minLen miles → [{a,b}] as fractions of the route */
export function climbs(r: Ride, minGrade = 0.06, minLen = 0.3): { a: number; b: number }[] {
  const p = r.profile, tot = p[p.length - 1][0];
  return stretches(p, 1, minGrade, minLen).map(([a, b]) => ({ a: p[a][0] / tot, b: p[b - 1][0] / tot }));
}

/** stretches descending steeper than maxGrade for at least minLen miles, as profile index ranges [i0, i1) */
export function steepDescents(p: ProfilePoint[], maxGrade = -0.06, minLen = 0.5): [number, number][] {
  return stretches(p, -1, -maxGrade, minLen);
}

/** Named points along the route. Candidates carry a priority so the better name wins when two fall within tol of each other. */
export function waypoints(r: Ride, tol = 0.05): Waypoint[] {
  const c: (Waypoint & { pr: number })[] = [
    { f: 0, name: place(r.start), pr: 9 },
    { f: 1, name: place(r.finish || r.start), pr: 9 },
  ];
  if (r.waypoints?.length) c.push(...r.waypoints.map(w => ({ f: w.f, name: w.name, pr: 8 })));
  else {
    c.push({ f: highPoint(r).f, name: 'High point', pr: 5 });
    climbs(r).forEach((cl, i) =>
      c.push({ f: cl.a, name: `Foot of climb ${i + 1}`, pr: 2 }, { f: cl.b, name: `Top of climb ${i + 1}`, pr: 3 }),
    );
  }
  r.photos.forEach(ph => c.push({ f: ph.f, name: place(ph.cap), pr: 6 }));
  c.sort((x, y) => x.f - y.f);
  const out: (Waypoint & { pr: number })[] = [];
  for (const w of c) {
    const l = out[out.length - 1];
    if (l && w.f - l.f < tol) {
      // the better-named candidate wins, position included (a short climb's top would otherwise sit at its foot)
      if (w.pr > l.pr) {
        l.name = w.name;
        l.pr = w.pr;
        l.f = w.f;
      }
      if (w.f === 1) l.f = 1;
      continue;
    }
    out.push({ ...w });
  }
  return out.map(({ f, name }) => ({ f, name }));
}

/** midpoint of a stated range like '1½–2 h', in hours */
export function hoursOf(r: Pick<Ride, 'hours'>): number | null {
  const m = (r.hours || '').match(/[\d½]+/g);
  if (!m) return null;
  const h = m.map(s => parseFloat(s.replace('½', '.5')));
  return h.reduce((x, y) => x + y, 0) / h.length;
}

/** riding time for one profile segment, hours: ~13 mph flat, ~1,800 ft/h climbing, ~22 mph on descents steeper than 3% */
function segTime(d: number, rise: number): number {
  if (d <= 0) return 0;
  if (rise > 0) return d / 13 + rise / 1800;
  return rise / (d * FT_PER_MI) < -0.03 ? d / 22 : d / 13;
}

/** estimated riding time (hours) over a whole profile, before any calibration to the ride's stated hours */
export function ridingTime(p: ProfilePoint[]): number {
  let t = 0;
  for (let k = 1; k < p.length; k++) t += segTime(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1]);
  return t;
}

/** legs between waypoints with distance, gain, loss (slices of one hysteresis pass, so they add up to the ride's totals) and time; times are calibrated to the ride's stated hours when given */
export function legs(r: Ride): RouteCard {
  const wp = waypoints(r), p = r.profile, tot = p[p.length - 1][0], L: Leg[] = [];
  const series = climbSeries(p);
  // the sample nearest a waypoint stands in for it; the first leg starts at the route's first point
  const index = (f: number) => (f <= 0 ? 0 : profileAt(p, f * tot));
  for (let i = 1; i < wp.length; i++) {
    const a = wp[i - 1].f * tot, b = wp[i].f * tot, ia = index(wp[i - 1].f), ib = index(wp[i].f);
    let t = 0;
    for (let k = ia + 1; k <= ib; k++) t += segTime(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1]);
    const gain = series.gain[ib] - series.gain[ia], loss = series.loss[ib] - series.loss[ia];
    L.push({ a: wp[i - 1].f, b: wp[i].f, from: wp[i - 1].name, to: wp[i].name, mi: b - a, gain, loss, t });
  }
  const st = L.reduce((x, l) => x + l.t, 0);
  const H = hoursOf(r), loop = !r.finish;
  if (H && st) for (const l of L) l.t *= H / st;
  return { wp, legs: L, hours: H || st, loop };
}
