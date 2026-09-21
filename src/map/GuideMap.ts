// The MapLibre side of the guide. React owns the state; this class owns the map and mirrors that state onto it.
// Routes are WebGL line layers whose hot / dim / faint states ride on feature-state; every glyph on top of them
// (start dots, photo pins, the rider, place labels) stays an HTML marker, so the stylesheet still draws them.
import type { Feature, FeatureCollection, LineString, Polygon } from 'geojson';
import maplibregl, { type LngLatBoundsLike, type Map as MlMap, type MapGeoJSONFeature, type Marker } from 'maplibre-gl';
import { LABELS, RIDES, ridesIn, tripFor } from '../data/guide';
import MAP_BOUNDS from '../data/map-bounds.json';
import type { Area, LatLng, Leg, MapLabel, Ride } from '../data/types';
import { bounds, pointAt, sliceBetween, sliceTo } from '../lib/geo';
import { esc, reducedMotion, storage } from '../lib/html';
import { areaSlug, climbs, pad2, place } from '../lib/route';
import { dist, distUnit, elev, elevUnit, units } from '../lib/measure';
import { rideIn } from '../lib/ridein';
import { palette, type Palette } from './palette';
import { coastlines, LYR, mapStyle, SRC } from './style';
import { addExtrudedLandmarks, LANDMARK_LYR } from './landmarks';

/**
 * which landmarks draw: ?landmark=big (the default: models that grow as the map zooms out, shadowed and inked, and the
 * drawn silhouettes), three (the models alone, at true size), extrude (the first prototype), or none
 */
const LANDMARK_PARAM = new URLSearchParams(location.search).get('landmark');
const LANDMARK = LANDMARK_PARAM ?? 'big';

const HOME: [LatLng, LatLng] = [[37.32, -122.76], [38.08, -121.85]];
/** how far the map can be panned; src/data/map-bounds.json is also what scripts/fetch-water.mjs covers */
const MAX_BOUNDS: [LatLng, LatLng] = [[MAP_BOUNDS.s, MAP_BOUNDS.w], [MAP_BOUNDS.n, MAP_BOUNDS.e]];
/** interval between the preview's camera moves (ms) */
const FOLLOW_MS = 50;
/** map px around the floating panel: 16 margin + 8 gap; its width is the stylesheet's (measured, see pad) */
const PANEL_GAP_PX = 24;
/** map px the floating toggle button covers along the bottom edge on a phone */
const TOGGLE_PX = 80;
/** map px a ride's name needs when it is lettered to the left of its start dot */
const LEFT_LABEL_PX = 110;
/** the pitch 3D tilts to, and how long the tilt takes */
const PITCH = 42, TILT_MS = 900;
/** how long the compass takes to swing back north, and a zoom button's step */
const NORTH_MS = 600, ZOOM_MS = 350;

export type Perspective = '2d' | '3d';
/** what a press of the fit button will do: frame what is open, or (once that is framed and the map is turned) face north */
export type FitMode = 'frame' | 'north';

const VIEW_KEY = 'tdb.perspective';
/** The perspective the reader last chose. 2D is the default: the terrain mesh is a second set of tiles to fetch. */
export const savedPerspective = (): Perspective => (storage.get(VIEW_KEY) === '3d' ? '3d' : '2d');
/**
 * How far in each perspective zooms. The relief comes from zoom 14 tiles, so 2D stops where it is sharp; 3D goes on
 * to 16 for the landmarks, which only read up close, over the same tiles stretched (smooth, if soft, on a hillside).
 */
const MAX_ZOOM: Record<Perspective, number> = { '2d': 14, '3d': 16 };

export interface GuideMapEvents {
  onHover(slug: string | null): void;
  onOpen(slug: string): void;
  onPhotoHover(i: number | null): void;
  onPhotoClick(i: number): void;
  /** the map fell back to 2D because the terrain mesh could not load */
  onPerspective?(mode: Perspective): void;
  /** the map turned: the compass follows (degrees clockwise from north, 0 when square) */
  onBearing?(deg: number): void;
  /** what the fit button will do next changed: the button relabels itself */
  onFit?(mode: FitMode): void;
}

/** [lat, lng] as MapLibre wants it */
const ll = (p: LatLng): [number, number] => [p[1], p[0]];
const line = (route: LatLng[]): Feature<LineString> => ({
  type: 'Feature',
  properties: {},
  geometry: { type: 'LineString', coordinates: route.map(ll) },
});
const collection = (features: Feature[]): FeatureCollection => ({ type: 'FeatureCollection', features });
const box = ([[s, w], [n, e]]: [LatLng, LatLng]): LngLatBoundsLike => [[w, s], [e, n]];

/** read at hover time, so a tooltip opened after the units or the start changed shows the choice now in force */
const tipHtml = (r: Ride) => {
  const u = units.get();
  const t = tripFor(r, rideIn.get());
  // figures only: the map names the station itself while the ride is hot, so the tooltip does not say it again
  const figures = `${t.area} · ${dist(t.lengthMi, u)} ${distUnit(u)} · ${elev(t.feet, u)} ${elevUnit(u)}${t.transit ? ' · ' + t.transit : ''}`;
  return `<span>${esc(r.name)}</span><small>${esc(figures)}</small>`;
};

/** a zero-size wrapper so MapLibre's centring is a no-op and the inner element positions itself, as divIcon did */
function marker(map: MlMap, at: LatLng, html: string, className = ''): Marker {
  const el = document.createElement('div');
  el.className = `mk ${className}`.trim();
  el.innerHTML = html;
  return new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(ll(at)).addTo(map);
}

export class GuideMap {
  private readonly events: GuideMapEvents;
  private readonly map: MlMap;
  private readonly pal: Palette;
  private readonly starts = new Map<string, Marker>();
  private readonly rider: Marker;
  private readonly labels: { l: MapLabel; m: Marker }[] = [];
  private readonly observer: ResizeObserver;
  private readonly timers = new Set<number>();
  /** flyover timers, kept apart so starting a preview doesn't cancel the photo pins fading in */
  private readonly flyTimers = new Set<number>();
  private readonly tip: maplibregl.Popup;
  private readonly unwatchUnits: () => void;
  private readonly unwatchRideIn: () => void;
  private pins: Marker[] = [];
  /** the station (or the Panhandle) a ride is ridden in from: the open ride's, or on the overview the hovered ride's as a hint */
  private fromDot: Marker | null = null;
  private ride: Ride | null = null;
  private area: Area | null = null;
  private hot: string | null = null;
  private perspective: Perspective = savedPerspective();
  /** the perspective a running preview tilted away from, restored when it ends; null when no preview owns it */
  private beforeFlyover: Perspective | null = null;
  /** the ride line is dimmed under the preview's progress line; stays set while a finished preview lingers */
  private flying = false;
  /** the preview is running and has the panel tucked away; fits made now shouldn't leave room for it */
  private previewing = false;
  /** whether the floating panel is showing over the map's left edge; views are fitted around it */
  private covered = true;
  /** the camera is where a fit put it: nothing has moved it since. A fit pressed now can face north instead */
  private framed = false;
  /** set around a fit's own camera move, so its movestart counts as framing rather than as leaving the frame */
  private framing = false;
  private fitMode: FitMode = 'frame';
  /** phone layout: the panel is a document under the map, which fills the screen when opened */
  private mobile = false;
  private loaded = false;
  /** the latest view change requested before the style had loaded or the container had a size */
  private pendingView: (() => void) | null = null;

  /** `initial` is the ride the page opened on, so the map starts on it rather than flying there from the home view */
  constructor(el: HTMLElement, events: GuideMapEvents, initial?: Ride) {
    this.events = events;
    this.pal = palette();
    const map = (this.map = new maplibregl.Map({
      container: el,
      style: mapStyle(),
      bounds: box(initial ? bounds([initial.route]) : HOME),
      fitBoundsOptions: { padding: 20 },
      pitch: savedPerspective() === '3d' ? PITCH : 0,
      minZoom: 9,
      maxZoom: MAX_ZOOM[savedPerspective()],
      maxPitch: 60,
      maxBounds: box(MAX_BOUNDS),
      attributionControl: false,
      canvasContextAttributes: { antialias: true },
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      // turning and tilting are 3D's: right-drag (or ctrl-drag) turns and tilts, two fingers twist and tilt,
      // shift+arrows do both from the keyboard. allowTurning() switches them all off again in 2D.
      dragRotate: true,
      pitchWithRotate: true,
      touchZoomRotate: true,
      touchPitch: true,
    }));
    this.allowTurning(this.perspective === '3d');
    // PROTOTYPE: a handle for the screenshot script
    // a handle for the headless screenshot script, only on a page that spells the landmark flag out
    if (LANDMARK_PARAM) (window as unknown as { tdbMap?: MlMap }).tdbMap = map;
    map.addControl(new maplibregl.AttributionControl({ compact: false }), 'bottom-right');
    const scale = new maplibregl.ScaleControl({ maxWidth: 80, unit: units.get() });
    map.addControl(scale, 'bottom-left');
    // the scale bar is the map's own readout of the reader's choice, so it follows the store rather than a prop
    this.unwatchUnits = units.subscribe(() => scale.setUnit(units.get()));
    // the start switch sits on the overview too: a ride held hot by the list or the keyboard follows it at once
    this.unwatchRideIn = rideIn.subscribe(() => this.station());

    this.tip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'ride-tip', offset: 14, maxWidth: 'none' });
    // the tooltip carries the hot ride's name, so the stylesheet drops the copy beside its start dot while it is open;
    // a ride made hot from the list or the keyboard has no tooltip, and keeps its label. That holds zoomed in too,
    // where every ride's name shows (paintNames): the others' go as they dim, and the hot one's goes with them
    this.tip.on('open', () => document.body.classList.add('tipped'));
    this.tip.on('close', () => document.body.classList.remove('tipped'));
    this.rider = marker(map, [0, 0], '<div class="rider"></div>', 'rider-mk');
    this.rider.getElement().style.opacity = '0';

    map.on('load', () => {
      this.loaded = true;
      // the camera already opened at the saved pitch; this hangs the mesh under it
      this.attachTerrain(this.perspective);
      this.addRoutes();
      this.addStarts();
      this.addLabels();
      this.loadWater();
      this.addLandmarks();
      this.paint();
      this.flushView();
    });
    // the DEM host is slow and can fail; 3D that can't load shouldn't leave the map tilted over flat ground
    map.on('error', e => {
      if ((e as { sourceId?: string }).sourceId === SRC.terrain && this.perspective === '3d') this.setPerspective('2d');
    });
    map.on('zoom', () => this.paintNames());
    map.on('rotate', () => {
      this.events.onBearing?.(map.getBearing());
      this.tellFit();
    });
    map.on('pitch', () => this.tellFit());
    // every camera move but a fit's own leaves the frame: a drag, a zoom button, the preview, the compass
    map.on('movestart', () => {
      this.framed = this.framing;
      this.framing = false;
      this.tellFit();
    });
    map.on('moveend', () => this.tellFit());

    this.observer = new ResizeObserver(() => {
      map.resize();
      this.flushView();
    });
    this.observer.observe(el);
  }

  destroy() {
    this.unwatchUnits();
    this.unwatchRideIn();
    this.clearTimers(this.timers);
    this.clearTimers(this.flyTimers);
    this.observer.disconnect();
    this.map.remove();
    document.body.classList.remove('names', 'tipped');
  }

  // ---- layers

  private addRoutes() {
    const { map, pal } = this;
    const features = RIDES.map(r => {
      const slug = areaSlug(r.area);
      const c = pal.area[slug] ?? { base: pal.route, hot: pal.routeHot };
      return { ...line(r.route), properties: { slug: r.slug, color: c.base, hot: c.hot } };
    });
    (map.getSource(SRC.routes) as maplibregl.GeoJSONSource).setData(collection(features));

    const state = (key: string) => ['boolean', ['feature-state', key], false] as unknown as maplibregl.ExpressionSpecification;
    const hot = state('hot'), faint = state('faint'), dim = state('dim');
    // the way in from the station: the ride's own colour, thinner and lighter, under the ride itself. Not dashed:
    // the way there and the way back run the same road for most of their length, and two dashed lines in opposite
    // directions read as one solid one where their dashes interleave.
    map.addLayer({ id: LYR.approachHalo, type: 'line', source: SRC.approach, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': pal.halo, 'line-width': 5, 'line-opacity': 0.7 } });
    map.addLayer({
      id: LYR.approach,
      type: 'line',
      source: SRC.approach,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': 1.6, 'line-opacity': 0.6 },
    });
    map.addLayer({
      id: LYR.routeHalo,
      type: 'line',
      source: SRC.routes,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': pal.halo,
        'line-width': 7,
        // the halo belongs to the line it sits under, so it fades with it
        'line-opacity': ['case', faint, 0, dim, 0.3, 1],
      },
    });
    map.addLayer({ id: LYR.climb, type: 'line', source: SRC.climbs, layout: { 'line-cap': 'butt' }, paint: { 'line-color': ['get', 'color'], 'line-width': 7, 'line-opacity': 0.45 } });
    map.addLayer({
      id: LYR.route,
      type: 'line',
      source: SRC.routes,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': ['case', hot, ['get', 'hot'], ['get', 'color']],
        'line-width': ['case', hot, 4, faint, 2, 2.4],
        'line-opacity': ['case', faint, 0.16, dim, 0.3, 1],
      },
    });
    map.addLayer({ id: LYR.leg, type: 'line', source: SRC.leg, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 6, 'line-opacity': 0.9 } });
    map.addLayer({ id: LYR.progress, type: 'line', source: SRC.progress, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 4 } });
    // an invisible fat line carries the pointer, the way the old SVG hit path did
    map.addLayer({ id: LYR.routeHit, type: 'line', source: SRC.routes, paint: { 'line-color': '#000', 'line-width': 16, 'line-opacity': 0 } });

    map.on('mousemove', LYR.routeHit, e => this.overRoute(e.features?.[0], e.lngLat));
    map.on('mouseleave', LYR.routeHit, () => this.overRoute(undefined));
    map.on('click', LYR.routeHit, e => {
      const slug = e.features?.[0]?.properties?.slug;
      if (typeof slug === 'string') this.events.onOpen(slug);
    });
  }

  /** the route under the cursor: the tooltip follows the pointer along the line, as the sticky tooltip did */
  private overRoute(f: MapGeoJSONFeature | undefined, at?: maplibregl.LngLat) {
    const slug = typeof f?.properties?.slug === 'string' ? f.properties.slug : null;
    if (this.ride || !slug || !at) {
      this.map.getCanvas().style.cursor = '';
      this.tip.remove();
      if (!this.ride) this.events.onHover(null);
      return;
    }
    const r = RIDES.find(x => x.slug === slug);
    if (!r) return;
    this.map.getCanvas().style.cursor = 'pointer';
    this.showTip(at, r);
    this.events.onHover(slug);
  }

  private addStarts() {
    for (const r of RIDES) {
      const html = `<div class="start-dot${r.transit ? ' transit' : ''}" data-area="${esc(areaSlug(r.area))}"><span>${pad2(r.num)}</span><em class="${esc(r.labelSide || 'r')}">${esc(r.name)}</em></div>`;
      const m = marker(this.map, r.route[0], html);
      const el = m.getElement();
      el.addEventListener('mouseenter', () => {
        if (this.ride) return;
        this.events.onHover(r.slug);
        this.showTip(ll(r.route[0]), r);
      });
      el.addEventListener('mouseleave', () => {
        if (this.ride) return;
        this.events.onHover(null);
        this.tip.remove();
      });
      el.addEventListener('click', () => {
        this.tip.remove();
        this.events.onOpen(r.slug);
      });
      this.starts.set(r.slug, m);
    }
  }

  /** Labels fade by zoom: water always, peaks + minor towns from ~9.5, major towns always. */
  private addLabels() {
    for (const l of LABELS) {
      const m = marker(this.map, l.ll, `<span>${esc(l.t)}</span>`, `lbl lbl-${l.k}`);
      this.labels.push({ l, m });
    }
    this.paintNames();
  }

  /**
   * The landmarks: three.js models in 3D, and small drawn silhouettes where there are no models to see (2D, and 3D from
   * far out). The silhouettes are a few KB and load with the map; the models bring three.js with them, so they load
   * the first time the reader is in 3D and never for one who stays in 2D.
   */
  private landmarkIds: string[] = [];
  private modelsRequested = false;
  private addLandmarks() {
    if (LANDMARK === 'extrude') {
      addExtrudedLandmarks(this.map);
      this.landmarkIds = [LANDMARK_LYR];
    } else if (LANDMARK === 'big') {
      import('./landmarkMarks').then(({ addLandmarkMarks }) => addLandmarkMarks(this.map));
    }
    this.showLandmarks(this.perspective);
  }
  private showLandmarks(mode: Perspective) {
    if (mode === '3d' && !this.modelsRequested && (LANDMARK === 'three' || LANDMARK === 'big')) {
      this.modelsRequested = true;
      import('./landmarks3d').then(({ threeLandmarks, LANDMARK_3D }) => {
        // a page that spells out ?landmark= also gets the layer's costs to read, as it gets the map handle
        const stats = LANDMARK_PARAM ? { calls: 0, triangles: 0, renderMs: 0, rebuildMs: 0, rebuilds: 0, builds: {}, geometries: 0, textures: 0, pickMs: 0 } : undefined;
        if (stats) (window as unknown as { tdbLandmarkStats?: object }).tdbLandmarkStats = stats;
        this.map.addLayer(threeLandmarks(this.map, LANDMARK === 'big', stats));
        this.landmarkIds = [LANDMARK_3D];
        this.showLandmarks(this.perspective);
      });
    }
    for (const id of this.landmarkIds) if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', mode === '3d' ? 'visible' : 'none');
  }

  /** the polygons are ~400 KB; loading them as their own chunk keeps them off the app's critical path */
  private loadWater() {
    import('../data/bay-water.json')
      .then(mod => {
        if (!this.map.getSource(SRC.water)) return;
        const fc = mod.default as FeatureCollection<Polygon, { kind: string }>;
        (this.map.getSource(SRC.water) as maplibregl.GeoJSONSource).setData(fc);
        (this.map.getSource(SRC.coast) as maplibregl.GeoJSONSource).setData(coastlines(fc));
      })
      .catch(err => {
        // offline before the chunk arrived, or a stale page after a redeploy: the relief stands on its own
        console.warn('water polygons failed to load; the map draws relief only', err);
      });
  }

  // ---- state from React

  setHot(slug: string | null) {
    this.hot = slug;
    if (!this.ride) this.paint();
    this.station();
  }

  /**
   * Where the reader rides in from, for the open ride or else the hovered one: the station's dot and name for a trip
   * in, the name alone for a ride that begins at its station (its numbered dot is the station, already ringed). The
   * way in itself is drawn only for an open ride.
   */
  private station() {
    this.fromDot?.remove();
    this.fromDot = null;
    const hot = this.ride ? undefined : RIDES.find(x => x.slug === this.hot);
    const t = this.ride ?? (hot && tripFor(hot, rideIn.get()));
    if (!t || !(t.approach || (rideIn.get() && t.transit))) return;
    const kind = `${this.ride ? '' : ' hint'}${t.approach ? (t.transit ? ' transit' : '') : ' bare'}`;
    // a ride that begins at its station shows its own name beside the same dot: the station's goes across from it.
    // A station ridden in from is an end of the trip, and the view is fitted to the trip: lettered outwards from
    // its eastern edge, the name would run off the map or under the controls, so it is lettered inwards
    const [[, w], [, e]] = bounds([t.route]);
    const left = t.approach ? t.route[0][1] > (w + e) / 2 : t.labelSide !== 'l';
    const side = left ? ' class="l"' : '';
    const html = `<div class="from-dot${kind}" data-area="${esc(areaSlug(t.area))}"><em${side}>${esc(t.startLabel ?? place(t.start))}</em></div>`;
    this.fromDot = marker(this.map, t.route[0], html);
  }

  setArea(area: Area | null) {
    if (area === this.area) return;
    this.area = area;
    this.paint();
    if (this.ride) return;
    if (area) this.fly(bounds(ridesIn(area).map(r => r.route)), 1.1, 'area');
    else this.fly(HOME, 1.1, 'home');
  }

  setPanelCovered(covered: boolean, refit: boolean) {
    this.covered = covered;
    this.map.resize();
    if (refit) this.refit(0.7);
  }

  setMobile(mobile: boolean) {
    this.mobile = mobile;
    this.map.resize();
  }

  /** the container just became visible (the phone map was mounted hidden): re-measure and settle on the current view */
  refresh() {
    this.map.resize();
    if (!this.previewing) this.refit(0.7);
  }

  getPerspective(): Perspective {
    return this.perspective;
  }

  /**
   * Tilt into 3D, or back down flat. The terrain mesh is only attached in 3D, so 2D costs no extra tiles.
   * 2D is the atlas view, so it also squares the map back to north; 3D keeps whatever bearing the reader turned to,
   * and choosing it again from 3D settles the tilt back to its default.
   */
  setPerspective(mode: Perspective, animate = true) {
    this.attachTerrain(mode);
    storage.set(VIEW_KEY, mode);
    if (!this.loaded) return;
    const to = mode === '2d' ? { pitch: 0, bearing: 0 } : { pitch: PITCH };
    if (this.map.getPitch() === to.pitch && (to.bearing === undefined || this.map.getBearing() === 0)) return;
    if (animate && !reducedMotion()) this.map.easeTo({ ...to, duration: TILT_MS });
    else this.map.jumpTo(to);
  }

  /** the perspective's terrain mesh, without moving the camera: a caller that is already flying carries the pitch */
  private attachTerrain(mode: Perspective) {
    const changed = mode !== this.perspective;
    this.perspective = mode;
    this.allowTurning(mode === '3d');
    // past 14 is 3D's alone: leaving it there pulls the camera back to the 2D cap
    this.map.setMaxZoom(MAX_ZOOM[mode]);
    if (changed) this.events.onPerspective?.(mode);
    if (this.loaded) this.map.setTerrain(mode === '3d' ? { source: SRC.terrain, exaggeration: 1 } : null);
    if (this.loaded) this.showLandmarks(mode);
  }

  /** 2D stays north-up and flat, so every way of turning or tilting the map (mouse, touch, keyboard) is 3D-only */
  private allowTurning(on: boolean) {
    const { dragRotate, touchZoomRotate, touchPitch, keyboard } = this.map;
    if (on) {
      dragRotate.enable();
      touchZoomRotate.enableRotation();
      touchPitch.enable();
      keyboard.enableRotation();
    } else {
      dragRotate.disable();
      touchZoomRotate.disableRotation();
      touchPitch.disable();
      keyboard.disableRotation();
    }
  }

  // ---- the reader's own camera moves (compass, zoom and fit buttons)

  /** swing back to north, keeping the tilt; the compass is the plain way back once the map has been turned */
  resetNorth() {
    this.map.resetNorth({ duration: this.instant() ? 0 : NORTH_MS });
  }

  zoomIn() {
    this.map.zoomIn({ duration: this.instant() ? 0 : ZOOM_MS });
  }

  zoomOut() {
    this.map.zoomOut({ duration: this.instant() ? 0 : ZOOM_MS });
  }

  /**
   * frame what is open: the ride, the region, or the whole guide. A frame keeps the heading and tilt the reader
   * turned to; pressed again while nothing has moved since, it faces north at the perspective's standard tilt,
   * so the two presses together are "show me the ride, the usual way"
   */
  fit() {
    if (this.fitMode === 'north') {
      this.framing = true;
      this.map.easeTo({ bearing: 0, pitch: this.pitch(), duration: this.instant() ? 0 : NORTH_MS });
      this.framing = false;
      return;
    }
    this.refit(0.9);
  }

  /** the map is off north, or off the perspective's standard tilt */
  private turned() {
    return Math.abs(this.map.getBearing()) > 0.5 || Math.abs(this.map.getPitch() - this.pitch()) > 0.5;
  }

  private tellFit() {
    const mode: FitMode = this.framed && this.turned() ? 'north' : 'frame';
    if (mode === this.fitMode) return;
    this.fitMode = mode;
    this.events.onFit?.(mode);
  }

  /** a running preview re-centres the camera every few frames, which would cut an eased move short: step instead */
  private instant() {
    return reducedMotion() || this.previewing;
  }

  /** the pitch the current perspective flies at; every camera move states it, so none undoes the tilt */
  private pitch() {
    return this.perspective === '3d' ? PITCH : 0;
  }

  /** the tilt a fit keeps: the reader's own in 3D, unless the map is mid-ease to the standard one */
  private tilt() {
    return this.perspective === '3d' && !this.map.isEasing() ? this.map.getPitch() : this.pitch();
  }

  /** a ride as planned, or the same ride in from its alternative start: a different object, drawn afresh */
  openRide(ride: Ride) {
    if (ride === this.ride) return;
    this.resetRide();
    this.ride = ride;
    this.tip.remove();
    this.station();
    this.paint();

    const colour = this.hotColour(ride);
    if (ride.approach) this.setData(SRC.approach, ride.approach.lines.map(l => ({ ...line(l), properties: { color: this.colour(ride) } })));
    document.body.classList.toggle('ridein', !!ride.approach);
    this.setData(SRC.climbs, climbs(ride).map(({ a, b }) => ({ ...line(sliceBetween(ride.route, ride.cum, a, b)), properties: { color: colour } })));
    this.pins = ride.photos.map((ph, i) => {
      const m = marker(this.map, pointAt(ride.route, ride.cum, ph.f), `<i>${i + 1}</i>`, 'photo-pin');
      const el = m.getElement();
      el.style.opacity = '0';
      el.setAttribute('aria-label', `Photo ${i + 1}: ${ph.cap}`);
      const html = () => {
        const u = units.get();
        return `<span>${esc(ph.cap)}</span><small>${dist(ph.f * ride.lengthMi, u)} ${distUnit(u)} in</small>`;
      };
      el.addEventListener('mouseenter', () => {
        this.events.onPhotoHover(i);
        this.tip.setLngLat(ll(pointAt(ride.route, ride.cum, ph.f))).setHTML(html()).addTo(this.map);
      });
      el.addEventListener('mouseleave', () => {
        this.events.onPhotoHover(null);
        this.tip.remove();
      });
      el.addEventListener('click', () => this.events.onPhotoClick(i));
      this.later(() => (el.style.opacity = '1'), 900 + i * 120);
      return m;
    });
    this.fly(bounds([ride.route]), 1.3, 'ride');
  }

  closeRide() {
    if (!this.ride) return;
    this.resetRide();
    this.ride = null;
    this.paint();
    this.station();
    if (this.area) this.fly(bounds(ridesIn(this.area).map(r => r.route)), 1.1, 'area');
    else this.fly(HOME, 1.2, 'home');
  }

  setRider(f: number | null) {
    const el = this.rider.getElement();
    if (!this.ride || f == null) {
      el.style.opacity = '0';
      return;
    }
    this.rider.setLngLat(ll(pointAt(this.ride.route, this.ride.cum, f)));
    el.style.opacity = '1';
  }

  setHotPhoto(i: number | null) {
    this.pins.forEach((m, k) => m.getElement().firstElementChild?.parentElement?.classList.toggle('hot', k === i));
  }

  setLeg(leg: Leg | null) {
    if (!this.ride || !leg) return this.setData(SRC.leg, []);
    this.setData(SRC.leg, [{ ...line(sliceBetween(this.ride.route, this.ride.cum, leg.a, leg.b)), properties: { color: this.hotColour(this.ride) } }]);
  }

  // ---- flyover: React drives the clock, the map follows

  beginFlyover() {
    const r = this.ride;
    if (!r) return;
    this.clearTimers(this.flyTimers);
    this.flying = this.previewing = true;
    this.lastFollow = 0;
    this.paint();
    this.setData(SRC.progress, [{ ...line([r.route[0]]), properties: { color: this.hotColour(r) } }]);
    // the preview is what 3D is for; the map comes back to where it was when it ends
    if (!reducedMotion() && this.perspective !== '3d') {
      this.beforeFlyover = this.perspective;
      // terrain only: the tilt rides along with the fly-in below, which would otherwise cancel a separate ease
      this.attachTerrain('3d');
    }
    this.map.flyTo({
      center: ll(r.route[0]),
      zoom: Math.min(13.5, this.map.getZoom() + 1.75),
      pitch: this.pitch(),
      duration: reducedMotion() ? 0 : 1400,
    });
  }

  /** the preview's last camera move, so the map is re-centred a few times a second rather than every frame */
  private lastFollow = 0;

  flyoverFrame(f: number) {
    const r = this.ride;
    if (!r || !this.flying) return;
    this.setData(SRC.progress, [{ ...line(sliceTo(r.route, r.cum, f)), properties: { color: this.hotColour(r) } }]);
    // the camera glides between positions at ~20 Hz rather than restarting an ease every frame
    const now = performance.now();
    if (now - this.lastFollow < FOLLOW_MS && f < 1) return;
    this.lastFollow = now;
    this.map.easeTo({ center: ll(pointAt(r.route, r.cum, f)), duration: FOLLOW_MS, easing: t => t, animate: !reducedMotion() });
  }

  endFlyover(finished: boolean) {
    const r = this.ride;
    if (!r || !this.flying) return;
    this.previewing = false;
    const fit = (duration: number) => this.fly(bounds([r.route]), duration, 'ride');
    const done = () => {
      this.flying = false;
      this.setData(SRC.progress, []);
      this.restorePerspective(true);
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

  /** undo the tilt a preview asked for; a perspective the reader chose themselves is left alone */
  private restorePerspective(animate: boolean) {
    if (this.beforeFlyover === null) return;
    const back = this.beforeFlyover;
    this.beforeFlyover = null;
    this.setPerspective(back, animate);
  }

  private hotColour(r: Ride) {
    return (this.pal.area[areaSlug(r.area)] ?? { hot: this.pal.routeHot }).hot;
  }

  private colour(r: Ride) {
    return (this.pal.area[areaSlug(r.area)] ?? { base: this.pal.route }).base;
  }

  private setData(id: string, features: Feature[]) {
    const src = this.map.getSource(id) as maplibregl.GeoJSONSource | undefined;
    src?.setData(collection(features));
  }

  private resetRide() {
    this.clearTimers(this.timers);
    this.clearTimers(this.flyTimers);
    this.flying = this.previewing = false;
    for (const m of this.pins) m.remove();
    this.pins = [];
    this.fromDot?.remove();
    this.fromDot = null;
    this.setData(SRC.approach, []);
    document.body.classList.remove('ridein');
    this.setData(SRC.climbs, []);
    this.setData(SRC.leg, []);
    this.setData(SRC.progress, []);
    this.restorePerspective(false);
    this.rider.getElement().style.opacity = '0';
    this.tip.remove();
  }

  /** mirror hot / area / ride state onto the route layers and start dots */
  private paint() {
    if (!this.loaded) return;
    const { ride, hot, area } = this;
    for (const r of RIDES) {
      const inArea = !area || r.area === area;
      const dot = this.starts.get(r.slug)?.getElement().firstElementChild;
      let s: { hot: boolean; dim: boolean; faint: boolean };
      if (ride) {
        // the open ride may be the trip in from the station, a different object for the same ride
        const open = r.slug === ride.slug;
        s = { hot: open, dim: open && this.flying, faint: !open };
        dot?.classList.remove('hot');
        dot?.classList.toggle('dim', !inArea);
      } else {
        const isHot = r.slug === hot;
        s = { hot: isHot, dim: hot ? !isHot : !inArea, faint: false };
        dot?.classList.toggle('hot', isHot);
        dot?.classList.toggle('dim', s.dim);
      }
      this.map.setFeatureState({ source: SRC.routes, id: r.slug }, s);
    }
    document.body.classList.toggle('ride', !!ride);
    this.paintNames();
  }

  /** route names show when there's room: region filter active, or zoomed past 11 */
  private paintNames() {
    document.body.classList.toggle('names', !!this.area || (this.loaded && this.map.getZoom() >= 11));
    if (!this.loaded) return;
    const z = this.map.getZoom();
    for (const { l, m } of this.labels) {
      const on = l.k === 'water' || l.major ? z < 12.5 : z >= 9.5 && z < 13.5;
      m.getElement().classList.toggle('off', !on);
    }
  }

  private pad(kind: 'home' | 'ride' | 'area') {
    if (this.mobile) {
      // nothing covers the left edge; the toggle button sits along the bottom
      if (kind === 'home') return { top: 16, left: 16, right: 16, bottom: TOGGLE_PX };
      if (kind === 'ride') return { top: 90, left: 24, right: 24, bottom: TOGGLE_PX + 16 };
      return { top: 40, left: 24, right: 24, bottom: TOGGLE_PX };
    }
    const f = this.panelPx();
    // the legend and the key strip take the bottom band; a ride's fit keeps 110 px clear of it, the others a little
    if (kind === 'home') return { top: 20, left: 20 + f, right: 20, bottom: 60 };
    if (kind === 'ride') return { top: 90, left: 70 + f, right: 70, bottom: 110 };
    // a region shows its rides' names; one lettered to the left of its dot (labelSide 'l') needs the room to be read
    // beside the panel rather than under it
    const lettered = this.area && ridesIn(this.area).some(r => r.labelSide === 'l') ? LEFT_LABEL_PX : 0;
    return { top: 70, left: 70 + f + lettered, right: 70, bottom: 100 };
  }

  /** map px the floating panel covers along the left edge, gap included; 0 when it is hidden or does not float */
  private panelPx() {
    if (this.mobile) return 0;
    // the floating panel's actual width (0 in a layout where it doesn't cover the map)
    const side = document.getElementById('side');
    const panel = document.documentElement.classList.contains('float') && side ? side.offsetWidth : 0;
    const px = panel ? panel + PANEL_GAP_PX : 0;
    // on a narrow window the panel covers most of the map; padding for it would leave no room to fit anything
    return this.covered && !this.previewing && px < this.map.getContainer().clientWidth * 0.6 ? px : 0;
  }

  /** the tooltip keeps inside the map by itself, but the panel floats over the map's left edge: keep clear of that too */
  private showTip(at: maplibregl.LngLatLike, r: Ride) {
    this.tip.setPadding({ left: this.panelPx() });
    this.tip.setLngLat(at).setHTML(tipHtml(r)).addTo(this.map);
  }

  private refit(duration: number) {
    if (this.ride) this.fly(bounds([this.ride.route]), duration, 'ride');
    else if (this.area) this.fly(bounds(ridesIn(this.area).map(r => r.route)), duration, 'area');
    else this.fly(HOME, duration, 'home');
  }

  /** animate to bounds once the map has a view; before that, jump there */
  private fly(b: [LatLng, LatLng], duration: number, kind: 'home' | 'ride' | 'area') {
    this.view(() => {
      // fitBounds squares the map unless told otherwise: in 3D the view the reader turned to survives a fit
      const bearing = this.perspective === '3d' ? this.map.getBearing() : 0;
      const opts = { padding: this.pad(kind), pitch: this.tilt(), bearing, duration: reducedMotion() ? 0 : duration * 1000 };
      this.framing = true;
      this.map.fitBounds(box(b), opts);
      this.framing = false;
    });
  }

  private sized() {
    const el = this.map.getContainer();
    return this.loaded && el.clientWidth > 0 && el.clientHeight > 0;
  }

  private view(fn: () => void) {
    if (this.sized()) {
      this.map.resize();
      fn();
    } else this.pendingView = fn;
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
