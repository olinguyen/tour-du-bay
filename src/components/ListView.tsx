import { memo, useEffect, useMemo, useRef, type RefObject } from 'react';
import { AREAS, RIDES, ridesIn } from '../data/guide';
import type { Area, Ride } from '../data/types';
import { scrollBehavior } from '../lib/html';
import { outline } from '../lib/profileChart';
import { areaSlug, fmt, pad2, place } from '../lib/route';
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
  return areas.flatMap(a => ridesIn(a).sort((x, y) => (x[sort.key] - y[sort.key]) * sort.dir));
}

interface Props {
  rides: Ride[];
  area: Area | null;
  sort: Sort;
  hot: string | null;
  side: RefObject<HTMLElement | null>;
  onArea(a: Area | null): void;
  onSort(s: Sort): void;
  onHot(slug: string | null): void;
  onOpen(slug: string): void;
}

export function ListView({ rides, area, sort, hot, side, onArea, onSort, onHot, onOpen }: Props) {
  const chips = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const chooseArea = (a: Area | null) => {
    onArea(a);
    const el = side.current;
    if (el && chips.current) el.scrollTo({ top: Math.min(el.scrollTop, chips.current.offsetTop - 24), behavior: scrollBehavior() });
  };

  // keep the hot row in view when it's highlighted from the map or the keyboard
  useEffect(() => {
    const el = side.current;
    const row = hot && list.current?.querySelector<HTMLElement>(`.row[data-slug="${hot}"]`);
    if (!el || !row) return;
    const top = row.offsetTop - el.clientHeight / 2 + row.offsetHeight / 2;
    if (Math.abs(el.scrollTop - top) > el.clientHeight * 0.4) el.scrollTo({ top, behavior: scrollBehavior() });
  }, [hot, side]);

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
        <span id="count-list">{plural(rides.length)}</span>
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
                <button className="grp-h" title={`Show only ${a}`} onClick={() => chooseArea(a)}>
                  <i />
                  <span>{a}</span>
                  <small>{plural(grp.length)}</small>
                </button>
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
  return (
    <button
      className={'row' + (hot ? ' hot' : '')}
      data-slug={r.slug}
      data-area={areaSlug(r.area)}
      onMouseEnter={() => onHot(r.slug)}
      onMouseLeave={() => onHot(null)}
      onFocus={e => e.currentTarget.matches(':focus-visible') && onHot(r.slug)}
      onBlur={() => onHot(null)}
      onClick={() => onOpen(r.slug)}
    >
      <div className="thumb" aria-hidden="true">
        <span className="idx">{pad2(r.num)}</span>
        <Sparkline ride={r} />
        <svg className="shape" viewBox="0 0 96 68">
          <path d={shape.d} />
          <circle cx={shape.cx} cy={shape.cy} />
        </svg>
      </div>
      <div>
        <span className="name">{r.name}</span>
        <div className="stats">
          <span>{r.miles} mi</span>
          <i>·</i>
          <span>{fmt(r.feet)} ft</span>
          <i>·</i>
          <span>{r.hours.replace(/\s*h$/, '')} h</span>
        </div>
        <div className="row-sub">
          <span className="tag">{r.area}</span> · from {place(r.start)}
        </div>
      </div>
    </button>
  );
});
