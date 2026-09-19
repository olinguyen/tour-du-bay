// The Leaflet side of the guide. React owns the state; this class owns the map and mirrors that state onto it.
import L from 'leaflet';
import { LABELS, RIDES, ridesIn } from '../data/guide';
import MAP_BOUNDS from '../data/map-bounds.json';
import type { Area, LatLng, Leg, Ride } from '../data/types';
import { bounds, pointAt, sliceBetween, sliceTo } from '../lib/geo';
import { esc, reducedMotion } from '../lib/html';
import { areaSlug, climbs, fmt, miles, pad2 } from '../lib/route';
import { lazySvg } from './lazyRenderer';
import { addLabels, terrainLayer } from './terrain';

const HOME: [LatLng, LatLng] = [[37.32, -122.76], [38.08, -121.85]];
/** how far the map can be panned; src/data/map-bounds.json is also what scripts/fetch-water.mjs covers */
const MAX_BOUNDS: [LatLng, LatLng] = [[MAP_BOUNDS.s, MAP_BOUNDS.w], [MAP_BOUNDS.n, MAP_BOUNDS.e]];
/** interval between the preview's camera moves (ms) */
const FOLLOW_MS = 50;
/** map px around the floating panel: 16 margin + 8 gap; its width is the stylesheet's (measured, see pad) */
const PANEL_GAP_PX = 24;
/** map px the floating toggle button covers along the bottom edge on a phone */
const TOGGLE_PX = 80;

export interface GuideMapEvents {
  onHover(slug: string | null): void;
  onOpen(slug: string): void;
  onPhotoHover(i: number | null): void;
  onPhotoClick(i: number): void;
}

interface RideLayers {
  halo: L.Polyline;
  line: L.Polyline;
  hit: L.Polyline;
  start: L.Marker;
}

const tipHtml = (r: Ride) =>
  `<span>${esc(r.name)}</span><small>${esc(`${r.area} · ${miles(r.lengthMi)} mi · ${fmt(r.feet)} ft${r.transit ? ' · ' + r.transit : ''}`)}</small>`;

export class GuideMap {
  private readonly events: GuideMapEvents;
  private readonly map: L.Map;
  private readonly layers = new Map<string, RideLayers>();
  private readonly progress: L.Polyline;
  private readonly rider: L.Marker;
  private readonly legLine: L.Polyline;
  private readonly pinGroup = L.layerGroup();
  private readonly climbGroup = L.layerGroup();
  private readonly observer: ResizeObserver;
  private readonly timers = new Set<number>();
  /** flyover timers, kept apart so starting a preview doesn't cancel the photo pins fading in */
  private readonly flyTimers = new Set<number>();
  private pins: L.Marker[] = [];
  private ride: Ride | null = null;
  private area: Area | null = null;
  private hot: string | null = null;
  /** the ride line is dimmed under the preview's progress line; stays set while a finished preview lingers */
  private flying = false;
  /** the preview is running and has the panel tucked away; fits made now shouldn't leave room for it */
  private previewing = false;
  /** whether the floating panel is showing over the map's left edge; views are fitted around it */
  private covered = true;
  /** phone layout: the panel is a document under the map, which fills the screen when opened */
  private mobile = false;
  private loaded = false;
  /** the latest view change requested before the container had a size */
  private pendingView: (() => void) | null = null;

  /** `initial` is the ride the page opened on, so the map starts on it rather than flying there from the home view */
  constructor(el: HTMLElement, events: GuideMapEvents, initial?: Ride) {
    const map = (this.map = L.map(el, {
      zoomControl: false,
      // routes redraw only when the view leaves what was drawn, not on every one of the preview's pans
      renderer: lazySvg({ padding: 0.5 }),
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 140,
      wheelDebounceTime: 40,
      minZoom: 9,
      maxZoom: 14,
      maxBounds: MAX_BOUNDS,
      maxBoundsViscosity: 0.9,
      inertiaDeceleration: 2500,
    }));
    map.once('load', () => (this.loaded = true));
    map.attributionControl.setPrefix(false);
    L.control.scale({ imperial: true, metric: false, position: 'bottomleft' }).addTo(map);
    terrainLayer(map).addTo(map);
    addLabels(map, LABELS);
    map.on('zoomend', () => this.paintNames());

    for (const r of RIDES) {
      const halo = L.polyline(r.route, { className: 'route-halo', interactive: false }).addTo(map);
      const line = L.polyline(r.route, { className: 'route', interactive: false });
      line.on('add', () => line.getElement()?.setAttribute('data-area', areaSlug(r.area)));
      line.addTo(map);
      const hit = L.polyline(r.route, { className: 'route-hit', weight: 16 }).addTo(map);
      const html = `<div class="start-dot${r.transit ? ' transit' : ''}" data-area="${esc(areaSlug(r.area))}"><span>${pad2(r.num)}</span><em class="${esc(r.labelSide || 'r')}">${esc(r.name)}</em></div>`;
      const start = L.marker(r.route[0], {
        icon: L.divIcon({ className: '', html, iconSize: [0, 0] }),
        interactive: true,
        keyboard: false,
      }).addTo(map);

      hit.bindTooltip(tipHtml(r), { className: 'ride-tip', sticky: true, direction: 'top', offset: [0, -10] });
      start.bindTooltip(tipHtml(r), { className: 'ride-tip', direction: 'top', offset: [0, -16] });
      start.on('tooltipopen', () => this.ride && start.closeTooltip());
      for (const layer of [hit, start]) {
        layer
          .on('mouseover', () => !this.ride && events.onHover(r.slug))
          .on('mouseout', () => !this.ride && events.onHover(null))
          .on('click', () => events.onOpen(r.slug));
      }
      this.layers.set(r.slug, { halo, line, hit, start });
    }

    this.progress = L.polyline([], { className: 'route hot', interactive: false }).addTo(map);
    this.rider = L.marker([0, 0], {
      icon: L.divIcon({ className: '', html: '<div class="rider"></div>', iconSize: [0, 0] }),
      interactive: false,
      opacity: 0,
    }).addTo(map);
    this.pinGroup.addTo(map);
    this.climbGroup.addTo(map);
    this.legLine = L.polyline([], { className: 'route leg', interactive: false }).addTo(map);
    this.events = events;

    map.whenReady(() => this.paint());
    this.observer = new ResizeObserver(() => {
      map.invalidateSize(false);
      this.flushView();
    });
    this.observer.observe(el);
    this.view(() => (initial ? map.fitBounds(bounds([initial.route]), this.pad('ride')) : map.fitBounds(HOME, this.pad('home'))));
  }

  destroy() {
    this.clearTimers(this.timers);
    this.clearTimers(this.flyTimers);
    this.observer.disconnect();
    this.map.remove();
    document.body.classList.remove('names');
  }

  // ---- state from React

  setHot(slug: string | null) {
    this.hot = slug;
    if (!this.ride) this.paint();
  }

  setArea(area: Area | null) {
    if (area === this.area) return;
    this.area = area;
    this.paint();
    if (this.ride) return;
    if (area) this.fly(bounds(ridesIn(area).map(r => r.route)), { duration: 1.1, ...this.pad('area') });
    else this.fly(HOME, { duration: 1.1, ...this.pad('home') });
  }

  setPanelCovered(covered: boolean, refit: boolean) {
    this.covered = covered;
    this.map.invalidateSize(false);
    if (refit) this.refit(0.7);
  }

  setMobile(mobile: boolean) {
    this.mobile = mobile;
    this.map.invalidateSize(false);
  }

  /** the container just became visible (the phone map was mounted hidden): re-measure and settle on the current view */
  refresh() {
    this.map.invalidateSize(false);
    if (!this.previewing) this.refit(0.7);
  }

  openRide(ride: Ride) {
    if (ride === this.ride) return;
    this.resetRide();
    this.ride = ride;
    this.map.getContainer().classList.add('no-hit');
    for (const { hit, start } of this.layers.values()) {
      hit.closeTooltip();
      start.closeTooltip();
    }
    const { halo, line } = this.layers.get(ride.slug)!;
    halo.bringToFront();
    line.bringToFront();
    this.paint();

    const slug = areaSlug(ride.area);
    for (const { a, b } of climbs(ride)) {
      const c = L.polyline(sliceBetween(ride.route, ride.cum, a, b), { className: 'route climb', interactive: false });
      c.on('add', () => c.getElement()?.setAttribute('data-area', slug));
      c.addTo(this.climbGroup);
    }
    this.pins = ride.photos.map((ph, i) => {
      const m = L.marker(pointAt(ride.route, ride.cum, ph.f), {
        icon: L.divIcon({ className: 'photo-pin', html: `<i>${i + 1}</i>`, iconSize: [0, 0] }),
        opacity: 0,
      });
      m.on('add', () => m.getElement()?.setAttribute('aria-label', `Photo ${i + 1}: ${ph.cap}`));
      m.addTo(this.pinGroup);
      m.bindTooltip(`<span>${esc(ph.cap)}</span><small>${miles(ph.f * ride.lengthMi)} mi in</small>`, {
        className: 'ride-tip',
        direction: 'top',
        offset: [0, -30],
      });
      m.on('mouseover', () => this.events.onPhotoHover(i))
        .on('mouseout', () => this.events.onPhotoHover(null))
        .on('click', () => this.events.onPhotoClick(i));
      this.later(() => m.setOpacity(1), 900 + i * 120);
      return m;
    });
    this.fly(bounds([ride.route]), { duration: 1.3, easeLinearity: 0.2, ...this.pad('ride') });
  }

  closeRide() {
    if (!this.ride) return;
    this.resetRide();
    this.ride = null;
    this.map.getContainer().classList.remove('no-hit');
    this.paint();
    if (this.area) this.fly(bounds(ridesIn(this.area).map(r => r.route)), { duration: 1.1, ...this.pad('area') });
    else this.fly(HOME, { duration: 1.2, ...this.pad('home') });
  }

  setRider(f: number | null) {
    if (!this.ride || f == null) {
      this.rider.setOpacity(0);
      return;
    }
    this.rider.setLatLng(pointAt(this.ride.route, this.ride.cum, f)).setOpacity(1);
  }

  setHotPhoto(i: number | null) {
    this.pins.forEach((m, k) => m.getElement()?.classList.toggle('hot', k === i));
  }

  setLeg(leg: Leg | null) {
    if (!this.ride || !leg) {
      this.legLine.setLatLngs([]);
      return;
    }
    this.legLine.setLatLngs(sliceBetween(this.ride.route, this.ride.cum, leg.a, leg.b));
    this.legLine.bringToFront();
  }

  // ---- flyover: React drives the clock, the map follows

  beginFlyover() {
    const r = this.ride;
    if (!r) return;
    this.clearTimers(this.flyTimers);
    this.flying = this.previewing = true;
    this.lastFollow = 0;
    this.paint();
    this.progress.setLatLngs([r.route[0]]);
    this.progress.bringToFront();
    this.map.flyTo(r.route[0], Math.min(13.5, this.map.getZoom() + 1.75), { duration: 1.4, animate: !reducedMotion() });
  }

  /** the preview's last camera move, so the map is re-centred a few times a second rather than every frame */
  private lastFollow = 0;

  flyoverFrame(f: number) {
    const r = this.ride;
    if (!r || !this.flying) return;
    // every moveend re-clips all the vector layers, so glide between positions at ~20 Hz instead of jumping at 60
    const now = performance.now();
    if (now - this.lastFollow < FOLLOW_MS && f < 1) return;
    this.lastFollow = now;
    this.progress.setLatLngs(sliceTo(r.route, r.cum, f));
    this.map.panTo(pointAt(r.route, r.cum, f), { animate: true, duration: FOLLOW_MS / 1000, easeLinearity: 1, noMoveStart: true });
  }

  endFlyover(finished: boolean) {
    const r = this.ride;
    if (!r || !this.flying) return;
    this.previewing = false;
    const fit = (duration: number) => this.fly(bounds([r.route]), { duration, ...this.pad('ride') });
    const done = () => {
      this.flying = false;
      this.progress.setLatLngs([]);
      this.paint();
    };
    if (finished) {
      // linger on the finish, then pull back out
      this.later(() => fit(1.4), 500, this.flyTimers);
      this.later(done, 2200, this.flyTimers);
    } else {
      done();
      fit(1);
    }
  }

  // ---- internals

  private resetRide() {
    this.clearTimers(this.timers);
    this.clearTimers(this.flyTimers);
    this.flying = this.previewing = false;
    this.pinGroup.clearLayers();
    this.climbGroup.clearLayers();
    this.pins = [];
    this.legLine.setLatLngs([]);
    this.progress.setLatLngs([]);
    this.rider.setOpacity(0);
  }

  /** mirror hot / area / ride state onto route lines and start dots */
  private paint() {
    const { ride, hot, area } = this;
    for (const r of RIDES) {
      const { line, start } = this.layers.get(r.slug)!;
      const inArea = !area || r.area === area;
      const p = line.getElement();
      const dot = start.getElement()?.firstElementChild;
      if (ride) {
        p?.classList.toggle('hot', r === ride);
        p?.classList.toggle('faint', r !== ride);
        p?.classList.toggle('dim', r === ride && this.flying);
        dot?.classList.remove('hot');
        dot?.classList.toggle('dim', !inArea);
      } else {
        const isHot = r.slug === hot;
        const dim = hot ? !isHot : !inArea;
        p?.classList.remove('faint');
        p?.classList.toggle('hot', isHot);
        p?.classList.toggle('dim', dim);
        dot?.classList.toggle('hot', isHot);
        dot?.classList.toggle('dim', dim);
      }
    }
    const slug = ride ? areaSlug(ride.area) : '';
    for (const el of [this.progress.getElement(), this.legLine.getElement(), this.rider.getElement()?.firstElementChild]) {
      if (el) el.setAttribute('data-area', slug);
    }
    this.paintNames();
  }

  /** route names show when there's room: region filter active, or zoomed past 11 */
  private paintNames() {
    document.body.classList.toggle('names', !!this.area || (this.loaded && this.map.getZoom() >= 11));
  }

  private pad(kind: 'home' | 'ride' | 'area'): L.FitBoundsOptions {
    if (this.mobile) {
      // nothing covers the left edge; the toggle button sits along the bottom
      if (kind === 'home') return { paddingTopLeft: [16, 16], paddingBottomRight: [16, TOGGLE_PX] };
      if (kind === 'ride') return { paddingTopLeft: [24, 90], paddingBottomRight: [24, TOGGLE_PX + 16] };
      return { paddingTopLeft: [24, 40], paddingBottomRight: [24, TOGGLE_PX] };
    }
    // the floating panel's actual width (0 in a layout where it doesn't cover the map)
    const side = document.getElementById('side');
    const panel = document.documentElement.classList.contains('float') && side ? side.offsetWidth : 0;
    const px = panel ? panel + PANEL_GAP_PX : 0;
    // on a narrow window the panel covers most of the map; padding for it would leave no room to fit anything
    const f = this.covered && !this.previewing && px < this.map.getSize().x * 0.6 ? px : 0;
    if (kind === 'home') return { paddingTopLeft: [20 + f, 20], paddingBottomRight: [20, 20] };
    if (kind === 'ride') return { paddingTopLeft: [70 + f, 90], paddingBottomRight: [70, 110] };
    return { paddingTopLeft: [70 + f, 70], paddingBottomRight: [70, 70] };
  }

  private refit(duration: number) {
    if (this.ride) this.fly(bounds([this.ride.route]), { duration, ...this.pad('ride') });
    else if (this.area) this.fly(bounds(ridesIn(this.area).map(r => r.route)), { duration, ...this.pad('area') });
    else this.fly(HOME, { duration, ...this.pad('home') });
  }

  /** animate to bounds once the map has a view; before that, jump there */
  private fly(b: L.LatLngBoundsExpression, opts: L.FitBoundsOptions & L.ZoomPanOptions) {
    this.view(() => (this.loaded && !reducedMotion() ? this.map.flyToBounds(b, opts) : this.map.fitBounds(b, opts)));
  }

  private sized() {
    const s = this.map.getSize();
    return s.x > 0 && s.y > 0;
  }

  private view(fn: () => void) {
    this.map.invalidateSize(false);
    if (this.sized()) fn();
    else this.pendingView = fn;
  }

  private flushView() {
    if (!this.pendingView || !this.sized()) return;
    const fn = this.pendingView;
    this.pendingView = null;
    fn();
  }

  private later(fn: () => void, ms: number, set = this.timers) {
    const id = window.setTimeout(() => {
      set.delete(id);
      fn();
    }, ms);
    set.add(id);
  }

  private clearTimers(set: Set<number>) {
    set.forEach(id => clearTimeout(id));
    set.clear();
  }
}
