import { memo, useEffect, useMemo, useRef, type RefObject } from 'react';
import { AREAS, RIDES, ridesIn } from '../data/guide';
import type { Area, Ride } from '../data/types';
import { scrollBehavior } from '../lib/html';
import { outline } from '../lib/profileChart';
import { areaSlug, fmt, miles, pad2, place } from '../lib/route';
import { Sparkline } from './ProfileChart';

export type SortKey = 'miles' | 'feet';
export interface Sort {
  key: SortKey;
  dir: 1 | -1;
}

const SORT_KEYS: { k: SortKey; t: string }[] = [
  { k: 'miles', t: 'Distance' },
  { k: 'feet', t: 'Climbing' },
];

const plural = (n: number) => `${n} ride${n === 1 ? '' : 's'}`;

/** rides in panel order: grouped by region, sorted within. Arrows, prev/next and the pager all follow this. */
export function sequence(area: Area | null, sort: Sort): Ride[] {
  const areas = area ? [area] : AREAS;
  const by = (r: Ride) => (sort.key === 'miles' ? r.lengthMi : r.feet);
  return areas.flatMap(a => ridesIn(a).sort((x, y) => (by(x) - by(y)) * sort.dir));
}

interface Props {
  rides: Ride[];
  area: Area | null;
  sort: Sort;
  hot: string | null;
  side: RefObject<HTMLElement | null>;
  /** phone layout: the window scrolls the list, not #side */
  mobile: boolean;
  onArea(a: Area | null): void;
  onSort(s: Sort): void;
  onHot(slug: string | null): void;
  onOpen(slug: string): void;
}

/** the element that scrolls the list, with positions measured in its scroll space */
function scroller(side: HTMLElement, mobile: boolean) {
  const el = mobile ? document.scrollingElement! : side;
  const origin = mobile ? 0 : side.getBoundingClientRect().top;
  return {
    el,
    height: mobile ? window.innerHeight : side.clientHeight,
    top: (n: HTMLElement) => n.getBoundingClientRect().top - origin + el.scrollTop,
  };
}

export function ListView({ rides, area, sort, hot, side, mobile, onArea, onSort, onHot, onOpen }: Props) {
  const chips = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const chooseArea = (a: Area | null) => {
    onArea(a);
    if (!side.current || !chips.current) return;
    const s = scroller(side.current, mobile);
    s.el.scrollTo({ top: Math.min(s.el.scrollTop, s.top(chips.current) - 24), behavior: scrollBehavior() });
  };

  // keep the hot row in view when it's highlighted from the map or the keyboard
  useEffect(() => {
    const row = hot && list.current?.querySelector<HTMLElement>(`.row[data-slug="${hot}"]`);
    if (!side.current || !row) return;
    const s = scroller(side.current, mobile);
    const top = s.top(row) - s.height / 2 + row.offsetHeight / 2;
    if (Math.abs(s.el.scrollTop - top) > s.height * 0.4) s.el.scrollTo({ top, behavior: scrollBehavior() });
  }, [hot, side, mobile]);

  return (
    <div id="view-list" className="view enter">
      <h1>Tour du Bay</h1>
      <div className="chips" id="chips" role="group" aria-label="Region" ref={chips}>
        {[null, ...AREAS].map(a => (
          <button
            key={a ?? 'all'}
            className={'ch' + (a === area ? ' on' : '')}
            data-area={a ? areaSlug(a) : ''}
            aria-pressed={a === area}
            onClick={() => chooseArea(area === a ? null : a)}
          >
            <i />
            {a ?? 'All'}
            <small>{a ? ridesIn(a).length : RIDES.length}</small>
          </button>
        ))}
      </div>
      <div className="hdr">
        <span id="count-list" aria-live="polite">{plural(rides.length)}</span>
        <div className="r" id="sort">
          {SORT_KEYS.map(o => {
            const on = o.k === sort.key;
            return (
              <button
                key={o.k}
                className={'sb' + (on ? ' on' : '')}
                aria-pressed={on}
                title={
                  on
                    ? sort.dir > 0 ? 'Smallest first — click for largest first' : 'Largest first — click for smallest first'
                    : `Sort by ${o.t.toLowerCase()}`
                }
                onClick={() => onSort(on ? { key: o.k, dir: sort.dir > 0 ? -1 : 1 } : { key: o.k, dir: 1 })}
              >
                {o.t}
                <i aria-hidden="true">{on ? (sort.dir > 0 ? '↑' : '↓') : '↕'}</i>
              </button>
            );
          })}
        </div>
      </div>
      {/* keyed so the rows replay their entrance whenever the filter or sort changes */}
      <div id="list" className="enter" ref={list} key={`${area}|${sort.key}|${sort.dir}`}>
        {(area ? [area] : AREAS).map(a => {
          const grp = rides.filter(r => r.area === a);
          if (!grp.length) return null;
          return (
            <section className="grp" data-area={areaSlug(a)} key={a}>
              {!area && (
                <h2 className="grp-hd">
                  <button className="grp-h" title={`Show only ${a}`} onClick={() => chooseArea(a)}>
                    <i />
                    <span>{a}</span>
                    <small>{plural(grp.length)}</small>
                  </button>
                </h2>
              )}
              {grp.map(r => (
                <Row key={r.slug} ride={r} hot={r.slug === hot} onHot={onHot} onOpen={onOpen} />
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

interface RowProps {
  ride: Ride;
  hot: boolean;
  onHot(slug: string | null): void;
  onOpen(slug: string): void;
}

const Row = memo(function Row({ ride: r, hot, onHot, onOpen }: RowProps) {
  const shape = useMemo(() => outline(r.route), [r]);
  const hours = r.hours.replace(/\s*h$/, '');
  const desc = `row-desc-${r.slug}`;
  // the description precedes the button so the last row stays :last-child; the visible stats are hidden from AT in its favour
  return (
    <>
      <span className="sr-only" id={desc}>
        {r.area} · {miles(r.lengthMi)} miles · {fmt(r.feet)} feet of climbing · {hours} hours · starts at {place(r.start)}
      </span>
      <button
        className={'row' + (hot ? ' hot' : '')}
        data-slug={r.slug}
        aria-describedby={desc}
        data-area={areaSlug(r.area)}
        onMouseEnter={() => onHot(r.slug)}
        onMouseLeave={() => onHot(null)}
        onFocus={e => e.currentTarget.matches(':focus-visible') && onHot(r.slug)}
        onBlur={() => onHot(null)}
        onClick={() => onOpen(r.slug)}
      >
        <span className="thumb" aria-hidden="true">
          <span className="idx">{pad2(r.num)}</span>
          <Sparkline ride={r} />
          <svg className="shape" viewBox="0 0 96 68">
            <path d={shape.d} />
            <circle cx={shape.cx} cy={shape.cy} />
          </svg>
        </span>
        <span>
          <span className="name">{r.name}</span>
          <span className="stats" aria-hidden="true">
            <span>{miles(r.lengthMi)} mi</span>
            <i>·</i>
            <span>{fmt(r.feet)} ft</span>
            <i>·</i>
            <span>{hours} h</span>
          </span>
          <span className="row-sub" aria-hidden="true">
            <span className="tag">{r.area}</span> · from {place(r.start)}
          </span>
        </span>
      </button>
    </>
  );
});
