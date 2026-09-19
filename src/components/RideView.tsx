import { useCallback, useMemo, useState } from 'react';
import { RIDES, ridesIn } from '../data/guide';
import type { Leg, Photo, Ride } from '../data/types';
import { storage } from '../lib/html';
import { areaSlug, fmt, hm, legs, miles, pad2, place, roman } from '../lib/route';
import { useStore, type Scrub, type Store } from '../lib/store';
import { ProfileChart, scrubParts } from './ProfileChart';

const CARD_KEY = 'bab-card';

interface Props {
  ride: Ride;
  /** the rides prev/next step through */
  seq: Ride[];
  scrub: Store<Scrub>;
  flying: boolean;
  hotPhoto: number | null;
  leg: Leg | null;
  onBack(): void;
  onOpen(slug: string): void;
  onToggleFly(): void;
  onPhotoHover(i: number | null): void;
  onLeg(leg: Leg | null): void;
}

export function RideView({ ride: r, seq, scrub, flying, hotPhoto, leg, onBack, onOpen, onToggleFly, onPhotoHover, onLeg }: Props) {
  const card = useMemo(() => legs(r), [r]);
  const [cardOpen, setCardOpen] = useState(() => storage.get(CARD_KEY) === '1');

  const si = seq.indexOf(r);
  const prev = seq[(si + seq.length - 1) % seq.length];
  const next = seq[(si + 1) % seq.length];
  const from = place(r.start);
  const near = useMemo(() => {
    const same = ridesIn(r.area).filter(x => x !== r);
    return same.length ? same : RIDES.filter(x => x !== r).slice(0, 3);
  }, [r]);

  // hovering never fights the preview for the cursor
  const scrubTo = (v: Scrub) => {
    if (!flying) scrub.set(v);
  };
  // stable so the memoised chart only re-renders when the ride or the leg changes
  const onScrub = useCallback((f: number | null) => {
    if (!flying) scrub.set(f == null ? null : { f, soft: false });
  }, [flying, scrub]);

  // figures pair with their map pin on hover or keyboard focus
  const figure = (ph: Photo, i: number) => {
    const enter = () => {
      onPhotoHover(i);
      scrubTo({ f: ph.f, soft: true });
    };
    const leave = () => {
      onPhotoHover(null);
      scrubTo(null);
    };
    return (
      <figure
        key={`ph${i}`}
        data-i={i}
        className={hotPhoto === i ? 'hot' : undefined}
        tabIndex={0}
        aria-label={`Photo ${i + 1}: ${ph.cap}, ${miles(ph.f * r.lengthMi)} miles in`}
        onMouseEnter={enter}
        onMouseLeave={leave}
        onFocus={enter}
        onBlur={leave}
      >
        {ph.src ? (
          <img className="ph" src={ph.src} alt={ph.cap} loading="lazy" />
        ) : (
          <div className="ph" aria-hidden="true">
            <b>photo · {miles(ph.f * r.lengthMi)} mi in</b>
          </div>
        )}
        <figcaption>
          <b aria-hidden="true">{i + 1}</b>
          <span>{ph.cap}</span>
        </figcaption>
      </figure>
    );
  };

  return (
    <div id="view-ride" className="view enter" data-area={areaSlug(r.area)}>
      <div className="topbar">
        <button id="back" onClick={onBack}>← All rides</button>
        <div className="pn">
          <button id="prev" title="Previous ride (←)" aria-label={`Previous ride: ${prev.name}`} onClick={() => onOpen(prev.slug)}>←</button>
          <span id="count">{pad2(si + 1)} / {pad2(seq.length)}</span>
          <button id="next" title="Next ride (→)" aria-label={`Next ride: ${next.name}`} onClick={() => onOpen(next.slug)}>→</button>
        </div>
      </div>
      <div className="arealine">
        <span className="mono" id="r-area">{r.area}</span>
      </div>
      <h1 id="r-name" tabIndex={-1}>{r.name}</h1>
      <p className="tagline">{r.tagline}</p>
      <p className="startline">
        <span className="mono">Starts</span>
        <b>{r.start}</b>
      </p>
      <div className="facts">
        <div><b>{miles(r.lengthMi)}</b><span className="mono">miles</span></div>
        <div><b>{fmt(r.feet)}</b><span className="mono">ft of climbing</span></div>
        <div><b>{r.hours.replace(/\s*h$/, '')}</b><span className="mono">hours riding</span></div>
        <div><b>{fmt(Math.round(r.maxElev / 10) * 10)}</b><span className="mono">ft high point</span></div>
      </div>

      <section className="profile">
        <div className="profile-head">
          <h2>The shape of the day</h2>
          <Readout ride={r} scrub={scrub} />
        </div>
        <ProfileChart ride={r} card={card} leg={leg} scrub={scrub} onScrub={onScrub} />
        <div className="pf-ends mono">
          <span>{from}</span>
          <span>{miles(r.lengthMi)} mi · {r.finish ? place(r.finish) : `back to ${from}`}</span>
        </div>
        <button className={'preview' + (flying ? ' on' : '')} id="fly" onClick={onToggleFly}>
          <i aria-hidden="true" />
          <span>{flying ? 'Stop preview' : 'Preview the ride'}</span>
          <small>14 sec</small>
        </button>
      </section>

      <details
        className="card"
        open={cardOpen}
        onToggle={e => {
          const open = e.currentTarget.open;
          setCardOpen(open);
          storage.set(CARD_KEY, open ? '1' : '0');
        }}
      >
        <summary>
          <span>Route card</span>
          <small>{card.legs.length} legs</small>
        </summary>
        <ol>
          {card.legs.map((l, i) => {
            const dist = miles(l.mi), gain = fmt(Math.round(l.gain / 10) * 10), t = hm(l.t);
            // hover lives on the li so its padding highlights the same as its CSS :hover does
            return (
              <li
                key={i}
                data-i={i}
                className={leg === l ? 'hot' : undefined}
                onMouseEnter={() => onLeg(l)}
                onMouseLeave={() => onLeg(null)}
              >
                <button
                  type="button"
                  className="leg"
                  aria-label={`Leg ${roman(i + 1)}, ${l.from} to ${l.to}, ${dist} miles, +${gain} feet, ${t}`}
                  onFocus={() => onLeg(l)}
                  onBlur={() => onLeg(null)}
                  onClick={() => scrubTo({ f: l.b, soft: false })}
                >
                  <b>{roman(i + 1)}</b>
                  <span className="lg">
                    {l.from} <em>→</em> {l.to}
                  </span>
                  <span className="st">
                    <span>{dist}<i> mi</i></span>
                    <span>
                      +{gain}<i> ft</i>
                      <s>−{fmt(Math.round(l.loss / 10) * 10)}</s>
                    </span>
                    <span>{t}</span>
                  </span>
                </button>
              </li>
            );
          })}
          <li className="tot">
            <b />
            <span className="lg">{card.loop ? 'Round trip' : 'Point to point'}</span>
            <span className="st">
              <span>{miles(r.lengthMi)}<i> mi</i></span>
              <span>+{fmt(r.feet)}<i> ft</i></span>
              <span>{hm(card.hours)}</span>
            </span>
          </li>
        </ol>
      </details>

      <div className="story">
        {r.story.flatMap((p, i) => [<p key={`p${i}`}>{p}</p>, r.photos[i] ? figure(r.photos[i], i) : null])}
        {r.photos.slice(r.story.length).map((ph, k) => figure(ph, r.story.length + k))}
      </div>

      <div className="sec">
        <h3>Practical notes</h3>
        <ul className="notes">
          {r.notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      </div>
      <div className="sec">
        <h3>Nearby in this guide</h3>
        <div className="also">
          {near.map(x => (
            <button key={x.slug} onClick={() => onOpen(x.slug)}>
              {x.name}
              <span>{miles(x.lengthMi)} mi · {fmt(x.feet)} ft</span>
            </button>
          ))}
        </div>
      </div>
      <nav className="pager" aria-label="More rides">
        <button onClick={() => onOpen(prev.slug)}>
          <span>← Previous</span>
          {prev.name}
        </button>
        <button onClick={() => onOpen(next.slug)}>
          <span>Next →</span>
          {next.name}
        </button>
      </nav>
    </div>
  );
}

function Readout({ ride, scrub }: { ride: Ride; scrub: Store<Scrub> }) {
  const v = useStore(scrub);
  if (!v) return <div className="readout" />;
  const p = scrubParts(ride, v.f);
  return (
    <div className="readout">
      <b>{p.mi}</b> mi · <b>{p.ft}</b> ft · <b>{p.grade}</b>
    </div>
  );
}
