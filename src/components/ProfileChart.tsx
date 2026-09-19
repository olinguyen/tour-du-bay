import { memo, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from 'react';
import type { Leg, Ride, RouteCard } from '../data/types';
import { annotations, legPath, profileScale, ticks, type ProfileScale } from '../lib/profileChart';
import { elevAt, fmt, gradeAt } from '../lib/route';
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
/** slider resolution: one arrow press is 0.1 % of the ride; Shift/PageUp jump 5 % */
const STEPS = 1000, JUMP = 50;

/** what the readout says at fraction f of the ride, as parts so the readout can bold the numbers */
export function scrubParts(ride: Ride, f: number) {
  const g = gradeAt(ride.profile, f);
  return {
    mi: (f * ride.lengthMi).toFixed(1),
    ft: fmt(Math.round(elevAt(ride.profile, f))),
    grade: `${g >= 0 ? '+' : '−'}${Math.abs(g).toFixed(1)}%`,
  };
}
const scrubText = (ride: Ride, f: number) => {
  const p = scrubParts(ride, f);
  return `${p.mi} mi · ${p.ft} ft · ${p.grade}`;
};

interface Props {
  ride: Ride;
  card: RouteCard;
  leg: Leg | null;
  scrub: Store<Scrub>;
  onScrub(f: number | null): void;
}

export const ProfileChart = memo(function ProfileChart({ ride, card, leg, scrub, onScrub }: Props) {
  const s = useMemo(() => profileScale(ride, W, H, PAD), [ride]);
  const tk = useMemo(() => ticks(s), [s]);
  const an = useMemo(() => annotations(ride, s, card), [ride, s, card]);
  const move = (e: PointerEvent<SVGSVGElement>) => onScrub(s.fractionAt(e.clientX, e.currentTarget.getBoundingClientRect()));

  return (
    <>
      <svg
        id="pf"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Elevation profile: ${ride.miles} miles, high point ${Math.round(ride.maxElev)} ft`}
        onPointerMove={move}
        onPointerDown={move}
        // a click on the chart shouldn't blur the keyboard scrubber (its blur hides the cursor the click just placed)
        onMouseDown={e => e.preventDefault()}
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
      <Scrubber ride={ride} scrub={scrub} onScrub={onScrub} />
    </>
  );
});

/** Keyboard access to the profile: a visually hidden slider that mirrors the scrub store. Focusing it shows the cursor, leaving hides it. */
function Scrubber({ ride, scrub, onScrub }: Pick<Props, 'ride' | 'scrub' | 'onScrub'>) {
  const [focused, setFocused] = useState(false);
  // only mirror the store while focused: the preview writes it every frame, and nobody reads an unfocused slider
  const v = useSyncExternalStore(scrub.subscribe, () => (focused ? scrub.get() : null));
  // where the slider rests while unfocused, so the arrows resume from the last position rather than the start
  const last = useRef(0);
  const f = v ? (last.current = v.f) : last.current;
  // Shift+arrow and PageUp/Down jump; plain arrows keep the native one-step move; Escape hands the shortcuts back to the page
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') return e.currentTarget.blur();
    const dir = /^(PageUp|ArrowRight|ArrowUp)$/.test(e.key) ? 1 : /^(PageDown|ArrowLeft|ArrowDown)$/.test(e.key) ? -1 : 0;
    if (!dir || !(e.shiftKey || e.key.startsWith('Page'))) return;
    e.preventDefault();
    onScrub(Math.min(1, Math.max(0, f + (dir * JUMP) / STEPS)));
  };
  return (
    <input
      type="range"
      className="pf-range"
      min={0}
      max={STEPS}
      step={1}
      value={Math.round(f * STEPS)}
      aria-label="Position along the route"
      aria-valuetext={scrubText(ride, f)}
      onChange={e => onScrub(e.currentTarget.valueAsNumber / STEPS)} // React's onChange is the native input event
      onKeyDown={keys}
      onFocus={() => {
        setFocused(true);
        onScrub(scrub.get()?.f ?? f);
      }}
      onBlur={() => {
        setFocused(false);
        onScrub(null);
      }}
    />
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
