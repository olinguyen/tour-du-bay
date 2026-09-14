import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ListView, sequence, type Sort } from './components/ListView';
import { RideView } from './components/RideView';
import { findRide } from './data/guide';
import type { Area, Leg, Ride } from './data/types';
import { useFlyover, useGuideMap, useHashRoute } from './hooks';
import { scrollBehavior } from './lib/html';
import { fmt } from './lib/route';
import { createStore, type Scrub } from './lib/store';

const TITLE = document.title;

export default function App() {
  const [slug, navigate] = useHashRoute();
  const ride = findRide(slug) ?? null;
  const [area, setArea] = useState<Area | null>(null);
  const [sort, setSort] = useState<Sort>({ key: 'miles', dir: 1 });
  const [hot, setHot] = useState<string | null>(null);
  const [panelHidden, setPanelHidden] = useState(false);
  /** the panel was brought back mid-preview, which otherwise tucks it away */
  const [peek, setPeek] = useState(false);
  const [photoHover, setPhotoHover] = useState<number | null>(null);
  const [leg, setLeg] = useState<Leg | null>(null);
  const [scrub] = useState(() => createStore<Scrub>(null));

  const side = useRef<HTMLElement>(null);
  const mapEl = useRef<HTMLDivElement>(null);
  const ptab = useRef<HTMLButtonElement>(null);
  const chipStop = useRef<HTMLButtonElement>(null);
  const listScroll = useRef(0);
  const cursor = useRef(-1);

  const displayed = useMemo(() => sequence(area, sort), [area, sort]);
  // a ride reached by URL or "nearby" may sit outside the region filter; step through the whole guide then
  const seq = useMemo(() => (ride && !displayed.includes(ride) ? sequence(null, sort) : displayed), [ride, displayed, sort]);

  const openRide = useCallback((s: string) => navigate(s), [navigate]);
  const closeRide = useCallback(() => navigate(null), [navigate]);

  const gm = useGuideMap(mapEl, {
    onHover: setHot,
    onOpen: openRide,
    onPhotoHover: setPhotoHover,
    onPhotoClick: i => {
      const f = side.current?.querySelector<HTMLElement>(`figure[data-i="${i}"]`);
      if (f) side.current!.scrollTo({ top: f.offsetTop - 24, behavior: scrollBehavior() });
    },
  });
  const { flying, toggle: toggleFlyover } = useFlyover(gm, ride, scrub);
  const toggleFly = useCallback(() => {
    setPeek(false);
    toggleFlyover();
  }, [toggleFlyover]);

  // highlight the photo nearest the scrub position; subscribes to a primitive so only changes re-render
  const nearPhoto = useSyncExternalStore(scrub.subscribe, () => nearestPhoto(ride, scrub.get()));
  const hotPhoto = photoHover ?? nearPhoto;
  const collapsed = panelHidden || (flying && !peek);

  // ---- ride changes
  useLayoutEffect(() => {
    setHot(null);
    setLeg(null);
    setPhotoHover(null);
    scrub.set(null);
    if (side.current) side.current.scrollTop = ride ? 0 : listScroll.current;
    document.body.classList.toggle('ride', !!ride);
    document.title = ride ? `${ride.name} — Tour du Bay` : TITLE;
  }, [ride, scrub]);

  // the view that held focus was replaced: move focus to the new heading, or back to the ride's row
  const lastRide = useRef(ride);
  useEffect(() => {
    const prev = lastRide.current;
    lastRide.current = ride;
    if (prev === ride) return;
    const target = ride
      ? side.current?.querySelector<HTMLElement>('#r-name')
      : prev && side.current?.querySelector<HTMLElement>(`.row[data-slug="${prev.slug}"]`);
    target?.focus({ preventScroll: true });
  }, [ride]);

  useEffect(() => {
    cursor.current = -1;
  }, [displayed]);
  useEffect(() => {
    if (hot) cursor.current = displayed.findIndex(r => r.slug === hot);
  }, [hot, displayed]);

  // ---- mirror state onto the map
  useEffect(() => gm?.setHot(hot), [gm, hot]);
  useEffect(() => gm?.setArea(area), [gm, area]);
  useEffect(() => void (ride ? gm?.openRide(ride) : gm?.closeRide()), [gm, ride]);
  useEffect(() => gm?.setHotPhoto(hotPhoto), [gm, hotPhoto, ride]);
  useEffect(() => gm?.setLeg(leg), [gm, leg]);
  useEffect(() => {
    if (!gm) return;
    gm.setRider(scrub.get()?.f ?? null);
    return scrub.subscribe(() => gm.setRider(scrub.get()?.f ?? null));
  }, [gm, scrub, ride]);

  // ---- panel hide ( [ ); the preview also tucks it away while it runs
  const live = useRef({ collapsed, flying });
  live.current = { collapsed, flying };
  const refitOnPanel = useRef(false);
  const togglePanel = useCallback(() => {
    const { collapsed, flying } = live.current;
    refitOnPanel.current = !flying; // mid-preview the map is busy following the rider
    if (collapsed) {
      setPanelHidden(false);
      setPeek(true);
    } else setPanelHidden(true);
  }, []);
  useEffect(() => {
    gm?.setPanelCovered(!panelHidden, refitOnPanel.current);
    refitOnPanel.current = false;
  }, [gm, panelHidden]);

  const wasFlying = useRef(false);
  useEffect(() => {
    const el = side.current;
    const focusInside = !!el?.contains(document.activeElement);
    document.documentElement.classList.toggle('phide', collapsed);
    el?.toggleAttribute('inert', collapsed);
    // don't strand keyboard focus inside the hidden panel
    if (collapsed && focusInside) (flying ? chipStop.current : ptab.current)?.focus();
    if (wasFlying.current && !flying && !collapsed && document.activeElement === document.body) {
      el?.querySelector<HTMLElement>('#fly')?.focus({ preventScroll: true });
    }
    wasFlying.current = flying;
  }, [collapsed, flying]);

  // ---- keyboard
  const keys = useRef({ ride, seq, displayed, area, closeRide, openRide, toggleFly, togglePanel });
  keys.current = { ride, seq, displayed, area, closeRide, openRide, toggleFly, togglePanel };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.altKey || e.ctrlKey || e.metaKey || t.closest('input, textarea, select, [contenteditable]')) return;
      // a focused map pans with the arrow keys
      if (e.key.startsWith('Arrow') && t.closest('.leaflet-container')) return;
      const k = keys.current;
      if (e.key === '[') return k.togglePanel();
      if (k.ride) {
        const i = k.seq.indexOf(k.ride), n = k.seq.length;
        if (e.key === 'Escape') k.closeRide();
        else if (e.key === 'ArrowRight') k.openRide(k.seq[(i + 1) % n].slug);
        else if (e.key === 'ArrowLeft') k.openRide(k.seq[(i + n - 1) % n].slug);
        else if (e.key === ' ' && !t.closest('button, summary, a')) {
          e.preventDefault();
          k.toggleFly();
        }
        return;
      }
      const vis = k.displayed;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        cursor.current = (cursor.current + (e.key === 'ArrowDown' ? 1 : -1) + vis.length) % vis.length;
        setHot(vis[cursor.current].slug);
      } else if (e.key === 'Enter' && cursor.current >= 0 && !t.closest('button, summary, a')) {
        k.openRide(vis[cursor.current].slug);
      } else if (e.key === 'Escape') {
        cursor.current = -1;
        setHot(null);
        if (k.area) setArea(null);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // the map chip keeps showing the last ride while it fades out
  const chipRide = useRef<Ride | null>(null);
  if (ride) chipRide.current = ride;

  return (
    <>
      <aside
        id="side"
        className="grain"
        ref={side}
        onScroll={e => {
          if (!ride) listScroll.current = e.currentTarget.scrollTop;
        }}
      >
        {ride ? (
          <RideView
            key={ride.slug}
            ride={ride}
            seq={seq}
            scrub={scrub}
            flying={flying}
            hotPhoto={hotPhoto}
            leg={leg}
            onBack={closeRide}
            onOpen={openRide}
            onToggleFly={toggleFly}
            onPhotoHover={setPhotoHover}
            onLeg={setLeg}
          />
        ) : (
          <ListView
            rides={displayed}
            area={area}
            sort={sort}
            hot={hot}
            side={side}
            onArea={setArea}
            onSort={setSort}
            onHot={setHot}
            onOpen={openRide}
          />
        )}
      </aside>
      <button
        className="ptab"
        id="ptab"
        ref={ptab}
        title={collapsed ? 'Show panel ( [ )' : 'Hide panel ( [ )'}
        aria-expanded={!collapsed}
        aria-controls="side"
        onClick={togglePanel}
      >
        <span className="ptab-hide" aria-hidden="true">‹</span>
        <span className="ptab-show">Rides ›</span>
      </button>
      <main id="mapwrap">
        <div id="map" ref={mapEl} />
        <div className="compass" aria-hidden="true">N</div>
        <div className="mapchip" aria-hidden={!ride}>
          <button id="chip-back" tabIndex={ride ? 0 : -1} onClick={closeRide}>← All</button>
          <span>{chipRide.current?.name}</span>
          <small>{chipRide.current && `${chipRide.current.miles} mi · ${fmt(chipRide.current.feet)} ft`}</small>
          {flying && (
            <button className="chip-stop" ref={chipStop} onClick={toggleFly}>Stop preview</button>
          )}
        </div>
        <div className="legend" aria-hidden="true">
          <div className="l-list">
            <div><i />a ride worth your weekend</div>
            <div><b className="tr" />a start you can reach by BART</div>
          </div>
          <div className="l-ride">
            <div><i className="cl" />climbs steeper than 6%</div>
            <div><b />viewpoints</div>
            <div><span style={{ display: 'inline-block', width: 23 }} />hover the profile to move along the route</div>
          </div>
        </div>
      </main>
    </>
  );
}

function nearestPhoto(ride: Ride | null, v: Scrub): number | null {
  if (!ride || !v || v.soft) return null;
  const i = ride.photos.findIndex(ph => Math.abs(ph.f - v.f) < 0.012);
  return i < 0 ? null : i;
}
