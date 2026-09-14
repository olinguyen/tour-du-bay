import { memo, useMemo, type PointerEvent } from 'react';
import type { Leg, Ride, RouteCard } from '../data/types';
import { annotations, legPath, profileScale, ticks, type ProfileScale } from '../lib/profileChart';
import { elevAt } from '../lib/route';
import { useStore, type Scrub, type Store } from '../lib/store';

export const Sparkline = memo(function Sparkline({ ride }: { ride: Ride }) {
  const s = useMemo(() => profileScale(ride, 80, 44, { l: 0, r: 0, t: 3, b: 0 }), [ride]);
  return (
    <svg className="spark" viewBox="0 0 80 44" preserveAspectRatio="none" aria-hidden="true">
      <path className="pf-area" d={s.area} />
      <path className="pf-line" d={s.line} />
    </svg>
  );
});

const W = 416, H = 150, PAD = { l: 0, r: 0, t: 16, b: 16 };

interface Props {
  ride: Ride;
  card: RouteCard;
  leg: Leg | null;
  scrub: Store<Scrub>;
  onScrub(f: number | null): void;
}

export function ProfileChart({ ride, card, leg, scrub, onScrub }: Props) {
  const s = useMemo(() => profileScale(ride, W, H, PAD), [ride]);
  const tk = useMemo(() => ticks(s), [s]);
  const an = useMemo(() => annotations(ride, s, card), [ride, s, card]);
  const move = (e: PointerEvent<SVGSVGElement>) => onScrub(s.fractionAt(e.clientX, e.currentTarget.getBoundingClientRect()));

  return (
    <svg
      id="pf"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Elevation profile: ${ride.miles} miles, high point ${Math.round(ride.maxElev)} ft`}
      onPointerMove={move}
      onPointerDown={move}
      onPointerLeave={() => onScrub(null)}
    >
      {tk.y.map(t => (
        <g key={t.label}>
          <line className="pf-grid" x1={PAD.l} x2={W - PAD.r} y1={t.y} y2={t.y} />
          <text className="pf-tick" x={PAD.l} y={t.y - 3}>{t.label}</text>
        </g>
      ))}
      {tk.x.map(t => (
        <text key={t.label} className="pf-tick pf-tick-x" x={t.x} y={H - PAD.b - 4}>{t.label}</text>
      ))}
      <path className="pf-area" d={s.area} />
      <g className="pf-anno">
        <clipPath id="pf-clip">
          <path d={an.clip} />
        </clipPath>
        <g clipPath="url(#pf-clip)" className="pf-contours">
          {an.contours.map(c => (
            <path key={c.dy} d={s.line} transform={`translate(0 ${c.dy})`} style={{ opacity: c.opacity }} />
          ))}
        </g>
        {an.grades.map((g, i) => (
          <text key={i} className="pf-grade" x={g.x.toFixed(1)} y={g.y.toFixed(1)} textAnchor="end">{g.label}</text>
        ))}
        {an.descents.map((d, i) => (
          <path key={i} className="pf-descent" d={d} />
        ))}
        <path className="pf-peak" d={an.summit.peak} />
        <text className="pf-summit" x={an.summit.x.toFixed(1)} y={an.summit.y.toFixed(1)} textAnchor={an.summit.anchor}>
          {an.summit.label}
        </text>
        {an.wps.map(w => (
          <g key={w.label}>
            <line className="pf-wp" x1={w.x.toFixed(1)} x2={w.x.toFixed(1)} y1={w.y1.toFixed(1)} y2={w.y2.toFixed(1)} />
            <text className="pf-wpn" x={(w.x + 4).toFixed(1)} y={w.ty.toFixed(1)}>{w.label}</text>
          </g>
        ))}
        <path className="pf-leg" d={leg ? legPath(s, leg) : ''} />
      </g>
      <path className="pf-line" d={s.line} />
      <Cursor s={s} scrub={scrub} />
    </svg>
  );
}

function Cursor({ s, scrub }: { s: ProfileScale; scrub: Store<Scrub> }) {
  const v = useStore(scrub);
  if (!v) return null;
  const x = s.X(v.f * s.maxD), y = s.Y(elevAt(s.pts, v.f));
  return (
    <g className="pf-cursor">
      <line x1={x} x2={x} y1={s.P.t} y2={H - s.P.b} />
      <circle r={4.5} cx={x} cy={y} />
    </g>
  );
}
