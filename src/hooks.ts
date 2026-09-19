import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { findRide } from './data/guide';
import type { Ride } from './data/types';
import { GuideMap, type GuideMapEvents } from './map/GuideMap';
import type { Scrub, Store } from './lib/store';

const slugFromHash = () => {
  let s = location.hash.slice(1);
  try {
    s = decodeURIComponent(s);
  } catch {
    /* keep raw */
  }
  return findRide(s) ? s : null;
};

/** The open ride lives in the URL hash (#slug), so rides deep-link and back/forward work. */
export function useHashRoute(): [string | null, (slug: string | null) => void] {
  const [slug, setSlug] = useState(slugFromHash);
  useEffect(() => {
    const sync = () => setSlug(slugFromHash());
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('hashchange', sync);
    };
  }, []);
  const navigate = useCallback((next: string | null) => {
    if (next === slugFromHash()) return;
    history.pushState(null, '', next ? `#${next}` : location.pathname + location.search);
    setSlug(next);
  }, []);
  return [slug, navigate];
}

let phoneQuery = '';
/**
 * The phone layout's media query, taken from --phone-max in guide.css so the stylesheet's `@media` and the query
 * JavaScript watches cannot drift apart (drift would stack the panel while JS still thought it was on a desktop).
 * Read once, on first use: the stylesheets are in the document before any component renders.
 */
export function phoneMedia(): string {
  if (!phoneQuery) phoneQuery = `(max-width: ${getComputedStyle(document.documentElement).getPropertyValue('--phone-max').trim()})`;
  return phoneQuery;
}

/** Whether a media query matches, kept live through matchMedia's change events (rotation, window resize). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mq = matchMedia(query);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => matchMedia(query).matches);
}

export function useGuideMap(el: RefObject<HTMLElement | null>, events: GuideMapEvents, initial: Ride | null): GuideMap | null {
  const latest = useRef(events);
  latest.current = events;
  // only the ride at mount matters: later ones are flown to by the openRide effect
  const first = useRef(initial);
  const [gm, setGm] = useState<GuideMap | null>(null);
  useEffect(() => {
    const g = new GuideMap(
      el.current!,
      {
        onHover: s => latest.current.onHover(s),
        onOpen: s => latest.current.onOpen(s),
        onPhotoHover: i => latest.current.onPhotoHover(i),
        onPhotoClick: i => latest.current.onPhotoClick(i),
        onPerspective: m => latest.current.onPerspective?.(m),
      },
      first.current ?? undefined,
    );
    setGm(g);
    return () => {
      g.destroy();
      setGm(null);
    };
  }, [el]);
  return gm;
}

const FLY_MS = 14000;
const LEAD_IN_MS = 1400;
const LINGER_MS = 2200;

/** The 14-second ride preview: moves the scrub position along the route and has the map follow. */
export function useFlyover(gm: GuideMap | null, ride: Ride | null, scrub: Store<Scrub>) {
  const [flying, setFlying] = useState(false);
  const raf = useRef(0);
  const linger = useRef(0);

  const cancel = useCallback(() => {
    cancelAnimationFrame(raf.current);
    clearTimeout(linger.current);
    raf.current = 0;
  }, []);

  const stop = useCallback(() => {
    if (!raf.current) return;
    cancel();
    setFlying(false);
    gm?.endFlyover(false);
    scrub.set(null);
  }, [cancel, gm, scrub]);

  const start = useCallback(() => {
    if (!gm || !ride || raf.current) return;
    cancel();
    setFlying(true);
    gm.beginFlyover();
    let t0: number | null = null;
    const step = (now: number) => {
      t0 ??= now + LEAD_IN_MS;
      const f = Math.min(1, (now - t0) / FLY_MS);
      if (f > 0) {
        scrub.set({ f, soft: false });
        gm.flyoverFrame(f);
      }
      if (f >= 1) {
        raf.current = 0;
        setFlying(false);
        gm.endFlyover(true);
        linger.current = window.setTimeout(() => scrub.set(null), LINGER_MS);
        return;
      }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  }, [cancel, gm, ride, scrub]);

  // a different ride (or none) ends any preview; the map resets itself when the ride changes
  useEffect(() => {
    return () => {
      cancel();
      setFlying(false);
    };
  }, [ride, cancel]);

  const toggle = useCallback(() => (raf.current ? stop() : start()), [start, stop]);
  return { flying, toggle };
}
