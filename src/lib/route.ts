// Route analysis: preparing a planned route's geometry, then pure functions of the resulting profile
// (+ optional waypoints/finish/hours).
import type { RoutePoint } from '../data/routes.generated';
import type { LatLng, Leg, ProfilePoint, Ride, RouteCard, Waypoint } from '../data/types';
import { cum, hav, segmentAt } from './geo';

const FT_PER_MI = 5280, KM_PER_MI = 1.609344, FT_PER_M = 3.28084;
/** profile sample spacing (km) */
const SAMPLE_KM = 0.025;

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

/** height (ft) at distance d (km) along a run of points, linear between the two nearest by binary search */
function heightAt(dist: number[], heights: number[], d: number): number {
  const i = segmentAt(dist, d);
  const t = Math.max(0, Math.min(1, (d - dist[i - 1]) / (dist[i] - dist[i - 1] || 1)));
  return heights[i - 1] + (heights[i] - heights[i - 1]) * t;
}

/**
 * Prepare a planned route's [lat, lng, ft] points for the guide: drop invalid points and sub-centimetre duplicates,
 * measure it, and sample the elevation every ~25 m with a short 1-2-1 smoothing window so terrain-model noise is not
 * counted as hundreds of tiny climbs. An invalid point splits the route into runs: the gap between two runs is drawn
 * straight and counted in distance, but the profile is never smoothed across it.
 */
export function prepareRoute(points: RoutePoint[]): { route: LatLng[]; cum: number[]; profile: ProfilePoint[] } {
  const runs: RoutePoint[][] = [];
  let run: RoutePoint[] = [];
  const finish = () => {
    if (run.length >= 2) runs.push(run);
    run = [];
  };
  for (const p of points) {
    if (!(Array.isArray(p) && p.length === 3 && p.every(Number.isFinite) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180)) {
      finish();
      continue;
    }
    if (run.length && hav([run[run.length - 1][0], run[run.length - 1][1]], [p[0], p[1]]) < 1e-5) continue;
    run.push(p);
  }
  finish();
  if (!runs.length) throw new Error('route has no usable points');
  const route: LatLng[] = runs.flat().map(p => [p[0], p[1]]);
  const c = cum(route), profile: ProfilePoint[] = [];
  let offset = 0;
  for (const r of runs) {
    const dist = c.slice(offset, offset + r.length), heights = r.map(p => p[2]);
    const start = dist[0], span = dist[dist.length - 1] - start, n = Math.max(1, Math.ceil(span / SAMPLE_KM));
    const at = (i: number) => start + (span * i) / n;
    const samples = Array.from({ length: n + 1 }, (_, i) => heightAt(dist, heights, at(i)));
    for (let i = 0; i <= n; i++) {
      const h = i === 0 || i === n ? samples[i] : (samples[i - 1] + samples[i] * 2 + samples[i + 1]) / 4;
      profile.push([at(i) / KM_PER_MI, h]);
    }
    offset += r.length;
  }
  return { route, cum: c, profile };
}

/**
 * Climbing (ft) with hysteresis: a reversal smaller than the threshold (10 m) is terrain-model noise, not a climb;
 * once a climb is established it is counted from its valley, not from where it crossed the threshold.
 */
export function elevationGain(p: ProfilePoint[], thresholdFt = 10 * FT_PER_M): number {
  let valley = p[0][1], peak = valley, climbing = false, gain = 0;
  for (let i = 1; i < p.length; i++) {
    const h = p[i][1];
    if (climbing) {
      if (h > peak) {
        gain += h - peak;
        peak = h;
      } else if (peak - h >= thresholdFt) {
        climbing = false;
        valley = h;
      }
    } else {
      valley = Math.min(valley, h);
      if (h - valley >= thresholdFt) {
        climbing = true;
        peak = h;
        gain += h - valley;
      }
    }
  }
  return gain;
}

/** index of the first profile point at or past distance d (miles), by binary search */
function profileAt(p: ProfilePoint[], d: number): number {
  let lo = 1, hi = p.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (p[mid][0] < d) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

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
    if (i0 == null && g >= grade) i0 = Math.max(0, i - Math.round(GRADE_WINDOW / Math.max(1e-9, p[i][0] - p[i - 1][0])));
    else if (i0 != null && g < grade / 2) {
      raw.push([i0, i]);
      i0 = null;
    }
  }
  if (i0 != null) raw.push([i0, p.length]);
  const merged: [number, number][] = [];
  for (const s of raw) {
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
      if (w.pr > l.pr) {
        l.name = w.name;
        l.pr = w.pr;
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

/** legs between waypoints with distance, gain, loss (both with hysteresis) and time; times are calibrated to the ride's stated hours when given */
export function legs(r: Ride): RouteCard {
  const wp = waypoints(r), p = r.profile, tot = p[p.length - 1][0], L: Leg[] = [];
  for (let i = 1; i < wp.length; i++) {
    const a = wp[i - 1].f * tot, b = wp[i].f * tot;
    const seg: ProfilePoint[] = [[a, elevAt(p, wp[i - 1].f)]];
    let t = 0;
    for (let k = 1; k < p.length; k++) {
      if (p[k][0] <= a || p[k - 1][0] >= b) continue;
      if (p[k][0] < b) seg.push(p[k]);
      t += segTime(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1]);
    }
    seg.push([b, elevAt(p, wp[i].f)]);
    const gain = elevationGain(seg), loss = elevationGain([...seg].reverse());
    L.push({ a: wp[i - 1].f, b: wp[i].f, from: wp[i - 1].name, to: wp[i].name, mi: b - a, gain, loss, t });
  }
  const st = L.reduce((x, l) => x + l.t, 0);
  const H = hoursOf(r), loop = !r.finish;
  if (H && st) for (const l of L) l.t *= H / st;
  return { wp, legs: L, hours: H || st, loop };
}
