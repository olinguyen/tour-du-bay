import { useCallback, useMemo, useState } from 'react';
import { RIDES, ridesIn, tripIn } from '../data/guide';
import type { Leg, Photo, Ride } from '../data/types';
import { storage } from '../lib/html';
import { areaSlug, hm, legs, pad2, place, roman } from '../lib/route';
import { dist, distUnit, distWord, elev, elevCoarse, elevUnit, elevWord, useUnits } from '../lib/measure';
import { setRideIn } from '../lib/ridein';
import { useStore, type Scrub, type Store } from '../lib/store';
import { ProfileChart, scrubParts } from './ProfileChart';

const CARD_KEY = 'bab-card';

interface Props {
  /** what is shown: the ride as planned, or the same ride in from its other start */
  ride: Ride;
  /** the ride as planned, whichever trip is shown: its place in the guide, and where its two starts are */
  base: Ride;
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

export function RideView({ ride: r, base, seq, scrub, flying, hotPhoto, leg, onBack, onOpen, onToggleFly, onPhotoHover, onLeg }: Props) {
  const u = useUnits();
  const card = useMemo(() => legs(r), [r]);
  const [cardOpen, setCardOpen] = useState(() => storage.get(CARD_KEY) === '1');

  const si = seq.indexOf(base);
  const prev = seq[(si + seq.length - 1) % seq.length];
  const next = seq[(si + 1) % seq.length];
  const from = place(r.start);
  /** the ride has a second start whose legs have been generated; without them the start line names one start */
  const twoStarts = !!base.from && tripIn(base) !== null;
  const near = useMemo(() => {
    const same = ridesIn(base.area).filter(x => x !== base);
    return same.length ? same : RIDES.filter(x => x !== base).slice(0, 3);
  }, [base]);

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
        aria-label={`Photo ${i + 1}: ${ph.cap}, ${dist(ph.f * r.lengthMi, u)} ${distWord(u)} in`}
        onMouseEnter={enter}
        onMouseLeave={leave}
        onFocus={enter}
        onBlur={leave}
      >
        {ph.src ? (
          <img className="ph" src={ph.src} alt={ph.cap} loading="lazy" />
        ) : (
          <div className="ph" aria-hidden="true">
            <b>photo · {dist(ph.f * r.lengthMi, u)} {distUnit(u)} in</b>
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
        {twoStarts && base.from ? (
          // two ways to start, one choice for the whole guide: the figures, profile and map follow it
          <span className="starts" role="group" aria-label="Where to start">
            <button type="button" className={r.approach ? undefined : 'on'} aria-pressed={!r.approach} onClick={() => setRideIn(false)}>
              {base.start}
            </button>
            <span className="or mono" aria-hidden="true">or</span>
            <button type="button" className={r.approach ? 'on' : undefined} aria-pressed={!!r.approach} title="Ride in from here and back" onClick={() => setRideIn(true)}>
              {base.from.start}
              {base.from.transit && <i className="tr">{base.from.transit}</i>}
            </button>
          </span>
        ) : (
          <b>{r.start}{r.transit && <i className="tr">{r.transit}</i>}</b>
        )}
      </p>
      {r.approach && (
        <p className="ridein-note mono">
          {dist(r.approach.outMi, u)} {distUnit(u)} in from {r.transit ? '' : 'the '}{from}, {dist(r.approach.backMi, u)} {distUnit(u)} back
        </p>
      )}
      <div className="facts">
        <div><b>{dist(r.lengthMi, u)}</b><span className="mono">{distWord(u)}</span></div>
        <div><b>{elev(r.feet, u)}</b><span className="mono">{elevUnit(u)} of climbing</span></div>
        <div><b>{r.hours.replace(/\s*h$/, '')}</b><span className="mono">hours riding</span></div>
        <div><b>{elevCoarse(r.maxElev, u)}</b><span className="mono">{elevUnit(u)} high point</span></div>
      </div>

      <section className="profile">
        <div className="profile-head">
          <h2>The shape of the day</h2>
          <Readout ride={r} scrub={scrub} />
        </div>
        <ProfileChart ride={r} card={card} leg={leg} scrub={scrub} onScrub={onScrub} />
        <div className="pf-ends mono">
          <span>{from}</span>
          <span>{dist(r.lengthMi, u)} {distUnit(u)} · {r.finish ? place(r.finish) : `back to ${from}`}</span>
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
            const mi = dist(l.mi, u), gain = elevCoarse(l.gain, u), t = hm(l.t);
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
                  aria-label={`Leg ${roman(i + 1)}, ${l.from} to ${l.to}, ${mi} ${distWord(u)}, +${gain} ${elevWord(u)}, ${t}`}
                  onFocus={() => onLeg(l)}
                  onBlur={() => onLeg(null)}
                  onClick={() => scrubTo({ f: l.b, soft: false })}
                >
                  <b>{roman(i + 1)}</b>
                  <span className="lg">
                    {l.from} <em>→</em> {l.to}
                  </span>
                  <span className="st">
                    <span>{mi}<i> {distUnit(u)}</i></span>
                    <span>
                      +{gain}<i> {elevUnit(u)}</i>
                      <s>−{elevCoarse(l.loss, u)}</s>
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
              <span>{dist(r.lengthMi, u)}<i> {distUnit(u)}</i></span>
              <span>+{elev(r.feet, u)}<i> {elevUnit(u)}</i></span>
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
              <span>{dist(x.lengthMi, u)} {distUnit(u)} · {elev(x.feet, u)} {elevUnit(u)}</span>
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
  const u = useUnits();
  if (!v) return <div className="readout" />;
  const p = scrubParts(ride, v.f, u);
  return (
    <div className="readout">
      <b>{p.mi}</b> {p.d} · <b>{p.ft}</b> {p.e} · <b>{p.grade}</b>
    </div>
  );
}
