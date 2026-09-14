// Geometry for elevation profile SVGs: scales, paths and the topo-style annotations on the ride view's chart.
import type { LatLng, Leg, ProfilePoint, Ride, RouteCard } from '../data/types';
import { climbs, elevAt, fmt, roman, steepDescents } from './route';

export interface Pad {
  l: number;
  r: number;
  t: number;
  b: number;
}

export type ProfileScale = ReturnType<typeof profileScale>;

export function profileScale(ride: Ride, W: number, H: number, P: Pad) {
  const pts = ride.profile;
  const maxD = pts[pts.length - 1][0];
  const maxE = Math.ceil(ride.maxElev / 500) * 500 + (ride.maxElev < 800 ? 200 : 0);
  const X = (d: number) => P.l + (d / maxD) * (W - P.l - P.r);
  const Y = (e: number) => P.t + (1 - e / maxE) * (H - P.t - P.b);
  const path = (ps: ProfilePoint[]) =>
    ps.map((p, i) => (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join(' ');
  const line = path(pts);
  const area = `${line} L${X(maxD).toFixed(1)} ${H - P.b} L${X(0)} ${H - P.b} Z`;
  /** fraction of the route under a client x coordinate */
  const fractionAt = (clientX: number, rect: DOMRect) =>
    Math.min(1, Math.max(0, (((clientX - rect.left) / rect.width) * W - P.l) / (W - P.l - P.r)));
  return { W, H, P, pts, maxD, maxE, X, Y, path, line, area, fractionAt };
}

export function ticks(s: ProfileScale) {
  const y: { y: number; label: string }[] = [];
  for (let e = 1000; e < s.maxE; e += 1000) y.push({ y: s.Y(e), label: `${fmt(e)} ft` });
  const x: { x: number; label: string }[] = [];
  for (let d = 5; d < s.maxD; d += 5) x.push({ x: s.X(d), label: `${d} mi` });
  return { y, x };
}

/** hachured contours under the line, gradient on each climb, dashed steep descents, a summit mark, waypoint numerals */
export function annotations(ride: Ride, s: ProfileScale, card: RouteCard) {
  const { W, H, P, pts, X, Y, maxD } = s;
  const elev = (f: number) => elevAt(pts, f);

  const clip = `${s.line} L${W} ${H - P.b} L0 ${H - P.b} Z`;
  const contours = Array.from({ length: 7 }, (_, i) => ({ dy: (i + 1) * 6, opacity: +(0.42 - (i + 1) * 0.05).toFixed(2) }));

  const grades = climbs(ride).map(({ a, b }) => {
    const e0 = elev(a), e1 = elev(b);
    const g = ((e1 - e0) / ((b - a) * maxD * 5280)) * 100;
    return { x: X(((a + b) / 2) * maxD) - 8, y: Y((e0 + e1) / 2) - 4, label: `${g.toFixed(0)}%` };
  });

  const descents = steepDescents(pts).map(([i0, i1]) => s.path(pts.slice(i0, i1)));

  const hi = pts.reduce((m, p) => (p[1] > m[1] ? p : m), pts[0]);
  const hx = X(hi[0]), hy = Y(hi[1]);
  const summit = {
    peak: `M${hx.toFixed(1)} ${(hy - 4).toFixed(1)} l-4 7 h8 z`,
    x: hx,
    y: hy - 10,
    anchor: hx > W - 100 ? 'end' : hx < 100 ? 'start' : 'middle',
    label: `${fmt(Math.round(hi[1]))} ft · high point`,
  } as const;

  const wps = card.wp.flatMap((w, i) => {
    if (w.f === 1) return [];
    const x = X(w.f * maxD), y = Y(elev(w.f)), low = y + 17 > H - P.b - 6;
    return [{ x, y1: y - 5, y2: y + 5, ty: low ? y - 9 : y + 17, label: roman(i + 1) }];
  });

  return { clip, contours, grades, descents, summit, wps };
}

/** the profile line for one leg of the route card */
export function legPath(s: ProfileScale, leg: Leg): string {
  const seg = s.pts.filter(q => q[0] >= leg.a * s.maxD && q[0] <= leg.b * s.maxD);
  return seg.length > 1 ? s.path(seg) : '';
}

/** A ride's route outline for a 96×68 thumbnail: lng scaled by cos(lat), fitted below the index label. */
export function outline(route: LatLng[]) {
  const W = 96, H = 68, P = 8, PT = 24, k = Math.cos((route[0][0] * Math.PI) / 180);
  const xs = route.map(p => p[1] * k), ys = route.map(p => p[0]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const sc = Math.min((W - 2 * P) / (x1 - x0), (H - PT - P) / (y1 - y0));
  const ox = (W - (x1 - x0) * sc) / 2, oy = PT + (H - PT - P - (y1 - y0) * sc) / 2;
  const pt = (i: number) => [ox + (xs[i] - x0) * sc, oy + (y1 - ys[i]) * sc];
  const d = route.map((_, i) => (i ? 'L' : 'M') + pt(i).map(n => n.toFixed(1)).join(' ')).join(' ');
  const [cx, cy] = pt(0);
  return { d, cx: +cx.toFixed(1), cy: +cy.toFixed(1) };
}
