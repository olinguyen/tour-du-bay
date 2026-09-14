// Route analysis: pure functions of a ride's profile (+ optional waypoints/finish/hours/feet).
import type { Leg, ProfilePoint, Ride, RouteCard, Waypoint } from '../data/types';

const FT_PER_MI = 5280;

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

/** Smooth a few [miles, feet] keyframes into an n-point profile with a little road-like texture. */
export function smoothProfile(keys: ProfilePoint[], n = 140): ProfilePoint[] {
  const total = keys[keys.length - 1][0];
  const out: ProfilePoint[] = [];
  for (let i = 0; i < n; i++) {
    const d = (total * i) / (n - 1);
    let k = 0;
    while (k < keys.length - 2 && keys[k + 1][0] < d) k++;
    const [d0, e0] = keys[k], [d1, e1] = keys[k + 1];
    const t = (d - d0) / Math.max(1e-6, d1 - d0);
    const tt = t * t * (3 - 2 * t);
    let e = e0 + (e1 - e0) * tt;
    const slope = Math.abs(e1 - e0) / Math.max(0.2, d1 - d0);
    e += (Math.sin(i * 1.9) * 0.6 + Math.sin(i * 0.53 + 2) * 0.4) * Math.min(60, 8 + slope * 0.05);
    out.push([d, Math.max(0, e)]);
  }
  return out;
}

/** elevation (ft) at fraction f of the profile */
export function elevAt(p: ProfilePoint[], f: number): number {
  const d = f * p[p.length - 1][0];
  let i = 1;
  while (i < p.length - 1 && p[i][0] < d) i++;
  const t = (d - p[i - 1][0]) / Math.max(1e-9, p[i][0] - p[i - 1][0]);
  return p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t;
}

/** grade (%) of the profile segment nearest fraction f */
export function gradeAt(p: ProfilePoint[], f: number): number {
  const i = Math.min(p.length - 2, Math.max(0, Math.round(f * (p.length - 1))));
  return ((p[i + 1][1] - p[i][1]) / ((p[i + 1][0] - p[i][0]) * FT_PER_MI)) * 100;
}

export function highPoint(r: Ride): { f: number; elev: number } {
  const p = r.profile, tot = p[p.length - 1][0];
  const hi = p.reduce((m, q) => (q[1] > m[1] ? q : m), p[0]);
  return { f: hi[0] / tot, elev: hi[1] };
}

/** contiguous stretches steeper than minGrade for at least minLen miles → [{a,b}] as fractions of the route */
export function climbs(r: Ride, minGrade = 0.06, minLen = 0.3): { a: number; b: number }[] {
  const p = r.profile, tot = p[p.length - 1][0], out: { a: number; b: number }[] = [];
  let s: number | null = null;
  for (let i = 1; i < p.length; i++) {
    const g = (p[i][1] - p[i - 1][1]) / Math.max(1e-9, (p[i][0] - p[i - 1][0]) * FT_PER_MI);
    if (g >= minGrade) {
      if (s == null) s = p[i - 1][0];
    } else if (s != null) {
      if (p[i - 1][0] - s >= minLen) out.push({ a: s / tot, b: p[i - 1][0] / tot });
      s = null;
    }
  }
  if (s != null && tot - s >= minLen) out.push({ a: s / tot, b: 1 });
  return out;
}

/** stretches descending steeper than maxGrade for at least minLen miles, as profile index ranges [i0, i1) */
export function steepDescents(p: ProfilePoint[], maxGrade = -0.06, minLen = 0.5): [number, number][] {
  const out: [number, number][] = [];
  let d0: number | null = null;
  for (let i = 1; i < p.length; i++) {
    const g = (p[i][1] - p[i - 1][1]) / ((p[i][0] - p[i - 1][0]) * FT_PER_MI);
    if (g <= maxGrade) {
      if (d0 == null) d0 = i - 1;
    } else if (d0 != null) {
      if (p[i - 1][0] - p[d0][0] >= minLen) out.push([d0, i]);
      d0 = null;
    }
  }
  return out;
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

/** legs between waypoints with distance, gain, loss and time; calibrated to the ride's stated hours/feet when given */
export function legs(r: Ride): RouteCard {
  const wp = waypoints(r), p = r.profile, tot = p[p.length - 1][0], L: Leg[] = [];
  for (let i = 1; i < wp.length; i++) {
    const a = wp[i - 1].f * tot, b = wp[i].f * tot;
    let gain = 0, loss = 0, t = 0;
    for (let k = 1; k < p.length; k++) {
      if (p[k][0] <= a || p[k - 1][0] >= b) continue;
      const d = p[k][0] - p[k - 1][0], rise = p[k][1] - p[k - 1][1];
      if (rise > 0) gain += rise;
      else loss -= rise;
      t += segTime(d, rise);
    }
    L.push({ a: wp[i - 1].f, b: wp[i].f, from: wp[i - 1].name, to: wp[i].name, mi: b - a, gain, loss, t });
  }
  const sg = L.reduce((x, l) => x + l.gain, 0);
  const sl = L.reduce((x, l) => x + l.loss, 0);
  const st = L.reduce((x, l) => x + l.t, 0);
  const H = hoursOf(r), loop = !r.finish;
  for (const l of L) {
    if (r.feet && sg) l.gain *= r.feet / sg;
    if (r.feet && sl && loop) l.loss *= r.feet / sl;
    if (H && st) l.t *= H / st;
  }
  return { wp, legs: L, hours: H || st, loop };
}
