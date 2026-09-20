// PROTOTYPE: the Golden Gate Bridge as a three.js scene drawn through a MapLibre custom layer, loaded on demand from
// GuideMap so three.js (~140 KB gzipped) only arrives once the reader is in 3D. The bridge is built from the bridge
// district's published dimensions rather than a downloaded model. Every footing stands on the map's own terrain
// mesh, thin members keep a minimum size in pixels so the bridge still reads with the map zoomed out, and the light
// comes from the north-west like the hillshade's.
import maplibregl, { type CustomLayerInterface, type CustomRenderMethodInput, type Map as MlMap, type MapMouseEvent } from 'maplibre-gl';
import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  CylinderGeometry,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  type Material,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  type Object3D,
  PerspectiveCamera,
  Raycaster,
  RepeatWrapping,
  Scene,
  SRGBColorSpace,
  TubeGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';
import { esc, reducedMotion } from '../lib/html';
import { dist, distUnit, elev, elevUnit, units } from '../lib/measure';
import { ALONG, BRIDGE_COLOR, GG, at, cableHeight } from './landmarks';
import { LYR } from './style';

export const LANDMARK_3D = 'landmark-three';

/** metres per map pixel at the bridge's latitude for a zoom level */
const metresPerPixel = (zoom: number) => (156543.03 * Math.cos((37.82 * Math.PI) / 180)) / 2 ** zoom;
/** suspenders are 50 ft apart; closer than this they would draw as a wall, so they only appear from about zoom 13.5 */
const SUSPENDER_MAX_PX = 11;
/** the classic view from Battery Spencer: over the north tower, down the bridge towards the city */
const POSTCARD = { center: at(470, 0), zoom: 14, pitch: 62, bearing: 150 };

/** a texture drawn on a canvas, so no image file and no CSP entry */
function canvas(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): CanvasTexture {
  const el = document.createElement('canvas');
  el.width = w;
  el.height = h;
  draw(el.getContext('2d')!);
  const t = new CanvasTexture(el);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  return t;
}

interface Mats {
  steel: Material;
  dark: Material;
  concrete: Material;
  road: Material;
  lattice: Material;
  rope: Material;
}

function materials(): Mats {
  const shade = 'rgba(40,10,5,0.4)';
  // the stiffening truss: chords top and bottom, diagonals between, one panel per 25 ft
  const lattice = canvas(64, 32, c => {
    c.fillStyle = BRIDGE_COLOR;
    c.fillRect(0, 0, 64, 32);
    c.strokeStyle = shade;
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(64, 32);
    c.moveTo(0, 32);
    c.lineTo(64, 0);
    c.moveTo(1.5, 0);
    c.lineTo(1.5, 32);
    c.stroke();
    c.fillStyle = shade;
    c.fillRect(0, 0, 64, 3);
    c.fillRect(0, 29, 64, 3);
  });
  lattice.repeat.set((GG.northEnd - GG.southEnd) / GG.truss, 1);
  // the roadway from above: six lanes of asphalt, a sidewalk each side, the railings in orange
  const road = canvas(4, 64, c => {
    c.fillStyle = '#8b877f';
    c.fillRect(0, 0, 4, 64);
    c.fillStyle = '#e6e1d4';
    c.fillRect(0, 0, 4, 7);
    c.fillRect(0, 57, 4, 7);
    c.fillStyle = BRIDGE_COLOR;
    c.fillRect(0, 0, 4, 2);
    c.fillRect(0, 62, 4, 2);
    c.fillStyle = '#c9b76a';
    c.fillRect(0, 31, 4, 2);
  });
  return {
    steel: new MeshLambertMaterial({ color: BRIDGE_COLOR }),
    dark: new MeshLambertMaterial({ color: '#8a2a1c' }),
    concrete: new MeshLambertMaterial({ color: '#d6cfc0' }),
    road: new MeshLambertMaterial({ map: road }),
    lattice: new MeshLambertMaterial({ map: lattice }),
    rope: new LineBasicMaterial({ color: BRIDGE_COLOR, transparent: true, opacity: 0.45 }),
  };
}

/** a box whose top is narrower than its base, like the tower legs */
function taperedBox(lx: number, h: number, lz: number, taper: number): BoxGeometry {
  const g = new BoxGeometry(lx, h, lz);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) p.setXYZ(i, p.getX(i) * taper, p.getY(i), p.getZ(i) * taper);
  g.computeVertexNormals();
  return g;
}

/** the terrain height under a footing: the lowest of a few samples around it, so nothing floats on a slope */
type Ground = (x: number, z: number, spread?: number) => number;

interface Built {
  group: Group;
  /** what the pointer can hit: the towers and cables (the deck is the ride's, which runs along it) */
  pick: Object3D[];
  dispose(): void;
}

/**
 * The bridge in its own frame: x along the axis from mid-span towards Marin, y up (metres above sea level), z across
 * to the east. `px` is the map's metres per pixel: anything thinner than about a pixel is widened to stay visible.
 */
function build(px: number, ground: Ground, mats: Mats): Built {
  const group = new Group();
  const geoms: BufferGeometry[] = [];
  const pick: Object3D[] = [];
  const w = (metres: number, minPx: number) => Math.max(metres, minPx * px);
  const add = (geo: BufferGeometry, mat: Material | Material[], x: number, y: number, z: number, pickable = false) => {
    geoms.push(geo);
    const m = new Mesh(geo, mat);
    m.position.set(x, y, z);
    group.add(m);
    if (pickable) pick.push(m);
    return m;
  };
  const column = (x: number, z: number, lx: number, lz: number, y0: number, y1: number, mat: Material, pickable = false) =>
    add(new BoxGeometry(lx, y1 - y0, lz), mat, x, (y0 + y1) / 2, z, pickable);
  const tube = (pts: Vector3[], segments: number, r: number, pickable = false) => add(new TubeGeometry(new CatmullRomCurve3(pts), segments, r, 6), mats.steel, 0, 0, 0, pickable);
  const deckUnder = GG.roadway - GG.truss;

  // ---- the towers, on their piers
  for (const s of [-GG.halfSpan, GG.halfSpan]) {
    const base = ground(s, 0, 30);
    const pierTop = Math.max(base, 0) + 5;
    if (s < 0) {
      // the south pier stands in open water inside its elliptical fender, longer across the current than along the bridge
      const geo = new CylinderGeometry(1, 1, pierTop - base, 40);
      geo.scale(23.5, 1, 45.5);
      add(geo, mats.concrete, s, (base + pierTop) / 2, 0);
    } else column(s, 0, 24, 48, base, pierTop, mats.concrete);
    const legAlong = w(GG.legAlong, 1.6);
    for (const side of [-GG.leg, GG.leg]) {
      const h = GG.tower - pierTop;
      add(taperedBox(legAlong, h, w(GG.legAcross, 1.4), 0.72), mats.steel, s, pierTop + h / 2, side, true);
    }
    // portal struts between the legs: one below the roadway, four above, and the cap; each stepped like the original
    const strut = (y: number, depth: number, along: number) => {
      add(new BoxGeometry(along, depth, 2 * GG.leg), mats.steel, s, y, 0, true);
      add(new BoxGeometry(along * 0.55, depth * 0.45, 2 * GG.leg - 9), mats.steel, s, y + depth * 0.7, 0);
    };
    strut(40, 8, legAlong * 0.95);
    for (const y of [88, 128, 165, 198]) strut(y, 8, legAlong * 0.85);
    strut(222.5, 9, legAlong * 0.8);
    // X-bracing between the legs below the roadway
    const dy = deckUnder - 4 - (pierTop + 3), dz = 2 * (GG.leg - 5);
    const len = Math.hypot(dy, dz), phi = Math.atan2(dz, dy);
    for (const sign of [-1, 1]) {
      const m = add(new BoxGeometry(w(3, 1), len, 2.5), mats.steel, s, pierTop + 3 + dy / 2, 0);
      m.rotation.x = sign * phi;
    }
  }

  // ---- the deck: a stiffening truss with the roadway on top, from the toll plaza to Vista Point
  const len = GG.northEnd - GG.southEnd;
  const depth = w(GG.truss, 1);
  add(new BoxGeometry(len, depth, w(2 * GG.halfDeck, 1.6)), [mats.steel, mats.steel, mats.road, mats.dark, mats.lattice, mats.lattice], GG.southEnd + len / 2, GG.roadway - depth / 2, 0);

  // ---- the main cables and their suspenders
  for (const side of [-GG.leg, GG.leg]) {
    const pts: Vector3[] = [];
    for (let x = -GG.anchor; x <= GG.anchor; x += 8) pts.push(new Vector3(x, cableHeight(x), side));
    tube(pts, 320, w(GG.cableR, 0.6), true);
  }
  if (px <= SUSPENDER_MAX_PX) {
    const v: number[] = [];
    const every = px > 5 ? 2 : 1;
    for (let k = -71; k <= 71; k += every) {
      const x = k * GG.suspender;
      if (Math.abs(x) > GG.anchor - 14 || Math.abs(Math.abs(x) - GG.halfSpan) < 12) continue;
      for (const side of [-GG.leg, GG.leg]) v.push(x, GG.roadway, side, x, cableHeight(x), side);
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(v, 3));
    geoms.push(geo);
    group.add(new LineSegments(geo, mats.rope));
  }

  // ---- the ends: pylons flanking the roadway, the anchorage housings under it, the Fort Point arch, the viaducts
  const pylonZ = GG.halfDeck + 5;
  for (const x of [-1081, -983, 983, 1040]) for (const side of [-pylonZ, pylonZ]) column(x, side, w(12, 1.5), w(10, 1.5), ground(x, side, 8), GG.roadway + 22, mats.concrete);
  for (const x of [-1104, 1013]) column(x, 0, 46, 40, ground(x, 0, 20), GG.roadway - 1, mats.concrete);
  // the 320 ft steel arch over Fort Point: two ribs with spandrel columns up to the deck
  const archY = (x: number) => 60 - 38 * ((x + 1032) / 49) ** 2;
  for (const side of [-10, 10]) {
    const pts: Vector3[] = [];
    for (let x = -1081; x <= -983; x += 3.5) pts.push(new Vector3(x, archY(x), side));
    tube(pts, 40, w(1.2, 0.6));
    for (let x = -1069; x < -983; x += 12.25) column(x, side, w(1.6, 0.8), w(1.6, 0.8), archY(x), deckUnder, mats.steel);
  }
  // steel bents under the approach viaducts, down to whatever the ground is there
  const bents: number[] = [];
  for (let x = -1150; x >= -1360; x -= 30) bents.push(x);
  for (let x = 1060; x <= 1320; x += 30) bents.push(x);
  for (const x of bents) {
    let top = -Infinity;
    for (const side of [-11, 11]) {
      const y0 = ground(x, side, 6);
      top = Math.max(top, y0);
      if (y0 < deckUnder - 2) column(x, side, w(1.6, 0.9), w(1.6, 0.9), y0, deckUnder, mats.steel);
    }
    if (top < deckUnder - 12) add(new BoxGeometry(w(1.2, 0.8), w(1.2, 0.8), 22), mats.steel, x, (top + deckUnder) / 2, 0);
  }

  // the frame's +x is the bridge axis; model space is x east, y up, z south
  group.rotation.y = Math.atan2(ALONG[1], ALONG[0]);
  return {
    group,
    pick,
    dispose() {
      group.removeFromParent();
      for (const g of geoms) g.dispose();
    },
  };
}

const tipHtml = () => {
  const u = units.get();
  return `<span>Golden Gate Bridge</span><small>${esc(`${dist(1.7, u)} ${distUnit(u)} · towers ${elev(746, u)} ${elevUnit(u)} above the water`)}</small>`;
};

export function threeLandmarks(map: MlMap): CustomLayerInterface {
  const scene = new Scene();
  const camera = new PerspectiveCamera();
  const origin = at(0, 0);
  const mvp = new Matrix4();
  const ray = new Raycaster();
  let renderer: WebGLRenderer | null = null;
  let mats: Mats | null = null;
  let built: Built | null = null;
  /** the zoom band (quarter zooms) the model was last built for, and whether it stood on terrain heights */
  let band = -1;
  let onTerrain = false;
  let zoomTimer = 0;
  let tip: maplibregl.Popup | null = null;

  const ground: Ground = (x, z, spread = 0) => {
    const samples = spread ? [[x, z], [x - spread, z], [x + spread, z], [x, z - spread], [x, z + spread]] : [[x, z]];
    let lowest = Infinity;
    for (const [sx, sz] of samples) {
      const [lng, lat] = at(sx, sz);
      const e = map.queryTerrainElevation({ lng, lat });
      if (e != null) lowest = Math.min(lowest, e);
    }
    // no terrain yet: water inside the side spans, a low shore beyond them
    return lowest === Infinity ? (Math.abs(x) < GG.side + GG.halfSpan ? 0 : 15) : lowest;
  };
  const terrainReady = () => map.queryTerrainElevation({ lng: origin[0], lat: origin[1] }) != null;
  const visible = () => map.getLayer(LANDMARK_3D) !== undefined && map.getLayoutProperty(LANDMARK_3D, 'visibility') !== 'none';

  const rebuild = () => {
    if (!mats) return;
    built?.dispose();
    built = build(metresPerPixel(map.getZoom()), ground, mats);
    scene.add(built.group);
    scene.updateMatrixWorld(true);
    band = Math.round(map.getZoom() * 4);
    onTerrain = terrainReady();
    map.triggerRepaint();
  };
  const onZoom = () => {
    window.clearTimeout(zoomTimer);
    zoomTimer = window.setTimeout(() => {
      if (Math.round(map.getZoom() * 4) !== band) rebuild();
    }, 150);
  };
  // the terrain arrives after the style, and again after each switch to 3D: stand the footings on it once it has
  const onIdle = () => {
    if (!onTerrain && terrainReady()) rebuild();
  };

  /** whether a screen point is over the bridge, by casting a ray back through the last frame's projection */
  const hit = (p: { x: number; y: number }) => {
    if (!built || !renderer || !visible()) return false;
    const c = map.getCanvas();
    const nx = (p.x / c.clientWidth) * 2 - 1, ny = 1 - (p.y / c.clientHeight) * 2;
    const inv = mvp.clone().invert();
    const near = new Vector3(nx, ny, -1).applyMatrix4(inv), far = new Vector3(nx, ny, 1).applyMatrix4(inv);
    ray.set(near, far.sub(near).normalize());
    return ray.intersectObjects(built.pick, false).length > 0;
  };
  const onMove = (e: MapMouseEvent) => {
    const over = hit(e.point) && !document.body.classList.contains('tipped');
    if (over) {
      map.getCanvas().style.cursor = 'pointer';
      if (!tip) tip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'ride-tip', offset: 14, maxWidth: 'none' });
      tip.setLngLat(e.lngLat).setHTML(tipHtml());
      if (!tip.isOpen()) tip.addTo(map);
    } else if (tip?.isOpen()) {
      tip.remove();
      map.getCanvas().style.cursor = '';
    }
  };
  const onClick = (e: MapMouseEvent) => {
    if (!hit(e.point) || map.queryRenderedFeatures(e.point, { layers: [LYR.routeHit] }).length) return;
    tip?.remove();
    map.flyTo({ ...POSTCARD, duration: reducedMotion() ? 0 : 2200 });
  };

  return {
    id: LANDMARK_3D,
    type: 'custom',
    renderingMode: '3d',
    onAdd(_map, gl) {
      mats = materials();
      // sun from the north-west, as the hillshade has it; the sky and the paper fill the shadows
      const sun = new DirectionalLight('#fff4e2', 3.4);
      sun.position.set(-1, 1.4, -1);
      scene.add(sun, new HemisphereLight('#fff9ef', '#b8a98c', 1.5));
      renderer = new WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
      renderer.autoClear = false;
      rebuild();
      map.on('zoom', onZoom);
      map.on('idle', onIdle);
      map.on('mousemove', onMove);
      map.on('click', onClick);
    },
    onRemove() {
      map.off('zoom', onZoom);
      map.off('idle', onIdle);
      map.off('mousemove', onMove);
      map.off('click', onClick);
      window.clearTimeout(zoomTimer);
      tip?.remove();
      built?.dispose();
      built = null;
      renderer?.dispose();
      renderer = null;
    },
    render(gl, args: CustomRenderMethodInput) {
      if (!renderer || !built) return;
      const model = map.transform.getMatrixForModel(origin, 0);
      mvp.fromArray(args.defaultProjectionData.mainMatrix as unknown as number[]).multiply(new Matrix4().fromArray(model as unknown as number[]));
      camera.projectionMatrix.copy(mvp);
      camera.projectionMatrixInverse.copy(mvp).invert();
      renderer.resetState();
      renderer.setViewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      renderer.render(scene, camera);
    },
  };
}
