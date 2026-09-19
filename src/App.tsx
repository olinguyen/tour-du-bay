import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ListView, sequence, type Sort } from './components/ListView';
import { RideView } from './components/RideView';
import { findRide } from './data/guide';
import type { Area, Leg, Ride } from './data/types';
import { phoneMedia, useFlyover, useGuideMap, useHashRoute, useMediaQuery } from './hooks';
import { savedPerspective, type Perspective } from './map/GuideMap';
import { scrollBehavior } from './lib/html';
import { dist, distUnit, elev, elevUnit, setUnits, useUnits, type Unit } from './lib/measure';
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
  /** phone layout: the panel is the page and the map a full-screen layer the toggle button swaps in */
  const isMobile = useMediaQuery(phoneMedia());
  const [mapOpen, setMapOpen] = useState(false);
  /** flat or tilted onto the terrain mesh; the map is the source of truth and reports back through onPerspective */
  const [perspective, setPerspective] = useState<Perspective>(savedPerspective);
  const units = useUnits();

  const side = useRef<HTMLElement>(null);
  const mapEl = useRef<HTMLDivElement>(null);
  const mapwrap = useRef<HTMLElement>(null);
  const ptab = useRef<HTMLButtonElement>(null);
  const chipStop = useRef<HTMLButtonElement>(null);
  const mapToggle = useRef<HTMLButtonElement>(null);
  /** list scroll position to come back to after a ride: #side's on desktop, the window's on a phone */
  const listScroll = useRef(0);
  /** window scroll position to come back to when the phone map closes */
  const docScroll = useRef(0);
  const cursor = useRef(-1);
  /** current state for callbacks that shouldn't re-subscribe on every change */
  const live = useRef({ collapsed: false, flying: false, mobile: isMobile, mapOpen, ride });

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
      if (!f) return;
      if (live.current.mobile) {
        // the story is under the map: close it and scroll the page to the figure
        setMapOpen(false);
        window.scrollTo({ top: f.getBoundingClientRect().top + window.scrollY - 24, behavior: scrollBehavior() });
      } else side.current!.scrollTo({ top: f.offsetTop - 24, behavior: scrollBehavior() });
    },
    onPerspective: setPerspective,
  }, ride);
  const { flying, toggle: toggleFlyover } = useFlyover(gm, ride, scrub);
  // the preview has nothing to play on once the phone's map layer is away, however it was closed
  useEffect(() => {
    if (isMobile && !mapOpen && flying) toggleFlyover();
  }, [isMobile, mapOpen, flying, toggleFlyover]);
  const toggleFly = useCallback(() => {
    setPeek(false);
    // on a phone the preview plays on the map layer, so bring it up (remembering where the story was)
    if (live.current.mobile && !live.current.flying && !live.current.mapOpen) {
      docScroll.current = window.scrollY;
      setMapOpen(true);
    }
    toggleFlyover();
  }, [toggleFlyover]);

  // highlight the photo nearest the scrub position; subscribes to a primitive so only changes re-render
  const nearPhoto = useSyncExternalStore(scrub.subscribe, () => nearestPhoto(ride, scrub.get()));
  const hotPhoto = photoHover ?? nearPhoto;
  const collapsed = panelHidden || (flying && !peek);
  live.current = { collapsed, flying, mobile: isMobile, mapOpen, ride };

  // ---- ride changes
  useLayoutEffect(() => {
    setHot(null);
    setLeg(null);
    setPhotoHover(null);
    scrub.set(null);
    // a ride opened from the phone map reads as a page: come back out of the map to it
    setMapOpen(false);
    if (live.current.mobile) {
      side.current?.removeAttribute('inert'); // now, so the focus effect below can reach the heading
      window.scrollTo(0, ride ? 0 : listScroll.current);
    }
    else if (side.current) side.current.scrollTop = ride ? 0 : listScroll.current;
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

  // ---- mirror state onto the map (the layout flag first: the fits below pad for it)
  useEffect(() => gm?.setMobile(isMobile), [gm, isMobile]);
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
  const refitOnPanel = useRef(false);
  const togglePanel = useCallback(() => {
    const { collapsed, flying } = live.current;
    refitOnPanel.current = !flying; // mid-preview the map is busy following the rider
    if (collapsed) {
      setPanelHidden(false);
      setPeek(true);
    } else setPanelHidden(true);
  }, []);
  // crossing the phone breakpoint (rotation, resize) changes what covers the map: refit for the new layout
  const wasMobile = useRef(isMobile);
  useEffect(() => {
    if (!gm) return;
    const crossed = wasMobile.current !== isMobile;
    wasMobile.current = isMobile;
    // mid-preview the map is following the rider; a refit would fight it
    gm.setPanelCovered(!panelHidden, (refitOnPanel.current || crossed) && !live.current.flying);
    refitOnPanel.current = false;
  }, [gm, isMobile, panelHidden]);

  // ---- phone map layer
  const restoreScroll = useRef(false);
  const toggleMap = useCallback(() => {
    const { mapOpen } = live.current;
    if (!mapOpen) docScroll.current = window.scrollY;
    else restoreScroll.current = true;
    setMapOpen(!mapOpen);
  }, []);
  useEffect(() => {
    if (!isMobile) setMapOpen(false);
  }, [isMobile]);
  useLayoutEffect(() => {
    const open = isMobile && mapOpen;
    document.body.classList.toggle('map-open', open);
    if (open) gm?.refresh(); // it was mounted visibility:hidden
    else if (restoreScroll.current) window.scrollTo(0, docScroll.current);
    restoreScroll.current = false;
  }, [gm, isMobile, mapOpen]);

  const wasFlying = useRef(false);
  useEffect(() => {
    const el = side.current;
    const active = document.activeElement;
    // on a phone the two layers cover each other in turn; on desktop only the hidden panel is out of reach
    const hideSide = isMobile ? mapOpen : collapsed;
    document.documentElement.classList.toggle('phide', collapsed && !isMobile);
    el?.toggleAttribute('inert', hideSide);
    mapwrap.current?.toggleAttribute('inert', isMobile && !mapOpen);
    if (isMobile) {
      // don't strand keyboard focus in the covered layer; the toggle sits between them
      const covered = hideSide ? el : mapwrap.current;
      if (covered?.contains(active)) mapToggle.current?.focus();
    } else {
      // don't strand keyboard focus inside the hidden panel
      if (collapsed && el?.contains(active)) (flying ? chipStop.current : ptab.current)?.focus();
      if (wasFlying.current && !flying && !collapsed && document.activeElement === document.body) {
        el?.querySelector<HTMLElement>('#fly')?.focus({ preventScroll: true });
      }
    }
    wasFlying.current = flying;
  }, [collapsed, flying, isMobile, mapOpen]);

  // on a phone the window scrolls the list, not #side
  useEffect(() => {
    if (!isMobile) return;
    const onScroll = () => {
      if (!live.current.ride && !live.current.mapOpen) listScroll.current = window.scrollY;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [isMobile]);

  // ---- keyboard
  const keys = useRef({ ride, seq, displayed, area, closeRide, openRide, toggleFly, togglePanel, toggleMap });
  keys.current = { ride, seq, displayed, area, closeRide, openRide, toggleFly, togglePanel, toggleMap };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      // fields keep their keys; the profile's slider only hands back the panel toggle
      if (t.closest('input, textarea, select, [contenteditable]') && !(e.key === '[' && t.matches('input[type=range]'))) return;
      // a focused map pans with the arrow keys
      if (e.key.startsWith('Arrow') && t.closest('.maplibregl-map')) return;
      const k = keys.current;
      const { mobile, mapOpen } = live.current;
      if (e.key === '[') return mobile ? undefined : k.togglePanel();
      if (mobile && mapOpen && e.key === 'Escape') return k.toggleMap();
      if (k.ride) {
        const i = k.seq.indexOf(k.ride), n = k.seq.length;
        if (e.key === 'Escape') k.closeRide();
        else if (e.key === 'ArrowRight') k.openRide(k.seq[(i + 1) % n].slug);
        else if (e.key === 'ArrowLeft') k.openRide(k.seq[(i + n - 1) % n].slug);
        else if (e.key === ' ' && !t.closest('button, summary, a, figure')) {
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
      } else if (e.key === 'Enter' && cursor.current >= 0 && !t.closest('button, summary, a, figure')) {
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
      {/* the app routes on the hash, so a plain #side link would close an open ride: focus the panel directly */}
      <a
        className="skip"
        href="#side"
        onClick={e => {
          e.preventDefault();
          side.current?.focus();
        }}
      >
        Skip to rides
      </a>
      <aside
        id="side"
        className="grain"
        ref={side}
        tabIndex={-1}
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
            mobile={isMobile}
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
      <main id="mapwrap" ref={mapwrap}>
        <div id="map" ref={mapEl} />
        <div className="compass" aria-hidden="true">N</div>
        <div className="mapctl">
          <div className="seg" role="group" aria-label="Map view">
            <span className="cap" aria-hidden="true">view</span>
            {(['2d', '3d'] as const).map(m => (
              <button
                key={m}
                className={perspective === m ? 'on' : undefined}
                aria-pressed={perspective === m}
                title={m === '3d' ? 'Tilt onto the terrain' : 'Look straight down'}
                onClick={() => gm?.setPerspective(m)}
              >
                {m.toUpperCase()}
              </button>
            ))}
          </div>
          <div className="seg" role="group" aria-label="Units">
            <span className="cap" aria-hidden="true">units</span>
            {([['imperial', 'mi'], ['metric', 'km']] as [Unit, string][]).map(([k, label]) => (
              <button
                key={k}
                className={units === k ? 'on' : undefined}
                aria-pressed={units === k}
                title={k === 'metric' ? 'Kilometres and metres' : 'Miles and feet'}
                onClick={() => setUnits(k)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="mapchip" aria-hidden={!ride}>
          <button id="chip-back" tabIndex={ride ? 0 : -1} onClick={closeRide}>← All</button>
          <span>{chipRide.current?.name}</span>
          <small>{chipRide.current && `${dist(chipRide.current.lengthMi, units)} ${distUnit(units)} · ${elev(chipRide.current.feet, units)} ${elevUnit(units)}`}</small>
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
      {isMobile && (
        <button className="map-toggle" ref={mapToggle} aria-pressed={mapOpen} onClick={toggleMap}>
          {mapOpen ? (ride ? 'Back to the story' : 'Back to the rides') : 'Explore the map'}
        </button>
      )}
    </>
  );
}

function nearestPhoto(ride: Ride | null, v: Scrub): number | null {
  if (!ride || !v || v.soft) return null;
  const i = ride.photos.findIndex(ph => Math.abs(ph.f - v.f) < 0.012);
  return i < 0 ? null : i;
}
