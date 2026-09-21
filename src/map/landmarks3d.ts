// Landmarks as three.js scenes drawn through one MapLibre custom layer, loaded on demand from GuideMap so
// three.js (~140 KB gzipped) only arrives once the reader is in 3D. Each landmark is built from published dimensions
// rather than a downloaded model, in its own frame (metres from an origin, x along a bearing, y up from sea level, z
// across to the right). Every footing stands on the map's own terrain mesh, thin members keep a minimum size in
// pixels so the models still read with the map zoomed out, and the light comes from the north-west like the
// hillshade's. Hovering a landmark names it; clicking one flies to its postcard view.
import maplibregl, { type CustomLayerInterface, type CustomRenderMethodInput, type Map as MlMap, type MapMouseEvent } from 'maplibre-gl';
import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineLoop,
  LineSegments,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  RepeatWrapping,
  Scene,
  ShapeUtils,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { esc, reducedMotion } from '../lib/html';
import { dist, distUnit, elev, elevUnit, units } from '../lib/measure';
import { BRIDGE, BRIDGE_COLOR, type Frame, frame, GG, cableHeight } from './landmarks';
import { LYR } from './style';

export const LANDMARK_3D = 'landmark-three';

/** metres per map pixel at this latitude for a zoom level */
const metresPerPixel = (zoom: number) => (156543.03 * Math.cos((37.8 * Math.PI) / 180)) / 2 ** zoom;
const Y = new Vector3(0, 1, 0);

// ---- materials

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
  white: Material;
  concrete: Material;
  stone: Material;
  ochre: Material;
  terracotta: Material;
  roof: Material;
  /** the map's own water and shoreline colours, for a pond drawn as part of a landmark */
  water: Material;
  shore: Material;
  road: Material;
  lattice: Material;
  rope: Material;
  /** storeys, one repeat of the texture each: the pyramid's quartz with its window bands, the tower's glass with its fins */
  quartz: Material;
  glass: Material;
  aluminium: Material;
  /** what is seen between the pyramid's legs */
  shadow: Material;
  /** the open screen that carries a glass tower's walls on past its roof */
  crown: Material;
  /** a soft shadow laid on the ground, and an inked edge on the main masses */
  shadow2: Material;
  ink: Material;
  /** the map's own ground colour, for an island that grows with what stands on it */
  land: Material;
}

function materials(): Mats {
  const shade = 'rgba(40,10,5,0.4)';
  const css = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  // the bridge's stiffening truss: chords top and bottom, diagonals between, one panel per 25 ft
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
  // the bridge's roadway from above: six lanes of asphalt, a sidewalk each side, the railings in orange
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
  const storey = (wall: string, band: string, from: number, to: number) =>
    canvas(4, 16, c => {
      c.fillStyle = wall;
      c.fillRect(0, 0, 4, 16);
      c.fillStyle = band;
      c.fillRect(0, from, 4, to - from);
    });
  const blob = canvas(64, 64, c => {
    const g = c.createRadialGradient(32, 32, 2, 32, 32, 32);
    g.addColorStop(0, 'rgba(60,45,25,0.42)');
    g.addColorStop(0.6, 'rgba(60,45,25,0.2)');
    g.addColorStop(1, 'rgba(60,45,25,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
  });
  return {
    shadow2: new MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    // the colour that the layer's warm sun and sky light to the map's --ground on level ground; slopes shade from there
    land: new MeshLambertMaterial({ color: '#d7d6d0', side: DoubleSide }),
    ink: new LineBasicMaterial({ color: css('--ink', '#2a241c'), transparent: true, opacity: 0.3 }),
    quartz: new MeshLambertMaterial({ map: storey('#f3f0e8', '#8d969a', 5, 11) }),
    glass: new MeshLambertMaterial({ map: storey('#c6d6dd', '#f6f8f7', 0, 6) }),
    aluminium: new MeshLambertMaterial({ color: '#cdd2d3' }),
    shadow: new MeshLambertMaterial({ color: '#6f7375' }),
    crown: new MeshLambertMaterial({ map: storey('#d3dfe3', '#f6f8f7', 0, 5), transparent: true, opacity: 0.85, side: DoubleSide }),
    steel: new MeshLambertMaterial({ color: BRIDGE_COLOR }),
    dark: new MeshLambertMaterial({ color: '#8a2a1c' }),
    white: new MeshLambertMaterial({ color: '#f4efe4' }),
    concrete: new MeshLambertMaterial({ color: '#d6cfc0' }),
    stone: new MeshLambertMaterial({ color: '#e4dccb', side: DoubleSide }),
    ochre: new MeshLambertMaterial({ color: '#d8c39c', side: DoubleSide }),
    terracotta: new MeshLambertMaterial({ color: '#b5674b' }),
    roof: new MeshLambertMaterial({ color: '#bcb4a5', side: DoubleSide }),
    water: new MeshBasicMaterial({ color: css('--water', '#c6d2cb'), side: DoubleSide }),
    shore: new LineBasicMaterial({ color: css('--coast', '#8b8574') }),
    road: new MeshLambertMaterial({ map: road }),
    lattice: new MeshLambertMaterial({ map: lattice }),
    rope: new LineBasicMaterial({ color: BRIDGE_COLOR, transparent: true, opacity: 0.45 }),
  };
}

// ---- the kit a landmark is built with

/** the terrain height under a footing: the lowest of a few samples around it, so nothing floats on a slope */
type Ground = (x: number, z: number, spread?: number) => number;

interface Kit {
  /** the map's metres per pixel: anything thinner than about a pixel is widened to stay visible */
  px: number;
  w(metres: number, minPx: number): number;
  ground: Ground;
  mats: Mats;
  group: Group;
  /** what the pointer can hit */
  pick: Object3D[];
  /** every geometry made, so it can be disposed on a rebuild */
  geoms: BufferGeometry[];
  /** whether landmarks grow, and what is drawn only while one is grown or only at its true size */
  grows: boolean;
  whenGrown: Object3D[];
  whenTrue: Object3D[];
  add(geo: BufferGeometry, mat: Material | Material[], x: number, y: number, z: number, pickable?: boolean): Mesh;
  /** a box from y0 up to y1, centred on x, z */
  column(x: number, z: number, lx: number, lz: number, y0: number, y1: number, mat: Material, pickable?: boolean): Mesh;
  cylinder(x: number, z: number, rTop: number, rBottom: number, y0: number, y1: number, mat: Material, segments?: number, pickable?: boolean): Mesh;
  /** a square bar between two points */
  bar(a: Vector3, b: Vector3, t: number, mat: Material, pickable?: boolean): Mesh;
  tube(pts: Vector3[], segments: number, r: number, mat: Material, pickable?: boolean): Mesh;
  /** a box whose top is narrower than its base */
  taperedBox(lx: number, h: number, lz: number, taper: number): BoxGeometry;
  /**
   * a profile of [radial offset, height] pairs swept along an arc of radius r about centre c, from angle a0 to a1
   * (angles in the x-z plane, x = cos): a curved wall, a lintel, a ring
   */
  sweep(profile: [number, number][], c: Vector3, r: number, a0: number, a1: number, segments: number, y0: number, mat: Material, pickable?: boolean): Mesh;
  /**
   * a skin over rings of [x, z] points at rising heights, every ring with the same number of points, flat-shaded;
   * the texture repeats once per `storey` metres of height
   */
  loft(sections: { y: number; ring: [number, number][] }[], storey: number, mat: Material, pickable?: boolean): Mesh;
  /** a flat polygon at height y, with holes and with an outline in a second material when given */
  sheet(outline: [number, number][], y: number, mat: Material, edge?: Material, holes?: [number, number][][]): Mesh;
}

function kit(px: number, ground: Ground, mats: Mats, inked = false): Kit {
  const group = new Group();
  const geoms: BufferGeometry[] = [];
  const pick: Object3D[] = [];
  const add: Kit['add'] = (geo, mat, x, y, z, pickable = false) => {
    geoms.push(geo);
    const m = new Mesh(geo, mat);
    m.position.set(x, y, z);
    group.add(m);
    if (pickable) {
      pick.push(m);
      if (inked) {
        const e = new EdgesGeometry(geo, 25);
        geoms.push(e);
        m.add(new LineSegments(e, mats.ink));
      }
    }
    return m;
  };
  return {
    px,
    w: (metres, minPx) => Math.max(metres, minPx * px),
    ground,
    mats,
    group,
    pick,
    geoms,
    grows: inked,
    whenGrown: [],
    whenTrue: [],
    add,
    column: (x, z, lx, lz, y0, y1, mat, pickable) => add(new BoxGeometry(lx, y1 - y0, lz), mat, x, (y0 + y1) / 2, z, pickable),
    cylinder: (x, z, rTop, rBottom, y0, y1, mat, segments = 12, pickable) => add(new CylinderGeometry(rTop, rBottom, y1 - y0, segments), mat, x, (y0 + y1) / 2, z, pickable),
    bar(a, b, t, mat, pickable) {
      const d = new Vector3().subVectors(b, a);
      const m = add(new BoxGeometry(t, d.length(), t), mat, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, pickable);
      m.quaternion.setFromUnitVectors(Y, d.normalize());
      return m;
    },
    tube(pts, segments, r, mat, pickable) {
      // a tube is round, so it has no edge to ink, and looking for one costs more than building the tube
      const m = add(new TubeGeometry(new CatmullRomCurve3(pts), segments, r, 6), mat, 0, 0, 0);
      if (pickable) pick.push(m);
      return m;
    },
    taperedBox(lx, h, lz, taper) {
      const g = new BoxGeometry(lx, h, lz);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) p.setXYZ(i, p.getX(i) * taper, p.getY(i), p.getZ(i) * taper);
      g.computeVertexNormals();
      return g;
    },
    sweep(profile, c, r, a0, a1, segments, y0, mat, pickable) {
      const pos: number[] = [];
      const idx: number[] = [];
      const n = profile.length;
      for (let i = 0; i <= segments; i++) {
        const a = a0 + ((a1 - a0) * i) / segments;
        for (const [d, h] of profile) pos.push(c.x + (r + d) * Math.cos(a), y0 + h, c.z + (r + d) * Math.sin(a));
      }
      for (let i = 0; i < segments; i++)
        for (let j = 0; j < n - 1; j++) {
          const p = i * n + j, q = p + n;
          idx.push(p, q, p + 1, q, q + 1, p + 1);
        }
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      return add(g, mat, 0, 0, 0, pickable);
    },
    loft(sections, storey, mat, pickable) {
      const pos: number[] = [];
      const uv: number[] = [];
      const n = sections[0].ring.length;
      for (let i = 0; i < sections.length - 1; i++) {
        const lo = sections[i], hi = sections[i + 1];
        for (let j = 0; j < n; j++) {
          const k = (j + 1) % n;
          const corners: [{ y: number; ring: [number, number][] }, number, number][] = [[lo, j, j], [lo, k, j + 1], [hi, j, j], [hi, j, j], [lo, k, j + 1], [hi, k, j + 1]];
          for (const [sec, at, u] of corners) {
            pos.push(sec.ring[at][0], sec.y, sec.ring[at][1]);
            uv.push(u / n, (sec.y - sections[0].y) / storey);
          }
        }
      }
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
      g.computeVertexNormals();
      return add(g, mat, 0, 0, 0, pickable);
    },
    sheet(outline, y, mat, edge, holes = []) {
      const rings = [outline, ...holes];
      const all = rings.flat();
      const pos = all.flatMap(([x, z]) => [x, y, z]);
      const idx: number[] = [];
      const v2 = (ring: [number, number][]) => ring.map(([x, z]) => new Vector2(x, z));
      // every triangle faces up, whichever way its ring was wound
      for (const [a, b, c] of ShapeUtils.triangulateShape(v2(outline), holes.map(v2))) {
        const up = (all[c][0] - all[a][0]) * (all[b][1] - all[a][1]) - (all[c][1] - all[a][1]) * (all[b][0] - all[a][0]) > 0;
        idx.push(a, up ? b : c, up ? c : b);
      }
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      const m = add(g, mat, 0, 0, 0);
      if (edge)
        for (const ring of rings) {
          const e = new BufferGeometry();
          e.setAttribute('position', new Float32BufferAttribute(ring.flatMap(([x, z]) => [x, y, z]), 3));
          geoms.push(e);
          m.add(new LineLoop(e, edge));
        }
      return m;
    },
  };
}

/**
 * One mesh per material for everything in a built landmark that nothing needs to reach on its own: a landmark is
 * hundreds of small parts (every column of the Palace is one), and each part is a draw call on every frame. Left
 * alone: what the pointer can hit (the ride keeps the bridge's deck because the deck is not among them), what is
 * shown or hidden with the growth, and anything that carries an inked edge.
 */
function mergeParts(k: Kit) {
  const keep = new Set<Object3D>([...k.pick, ...k.whenGrown, ...k.whenTrue]);
  const byMaterial = new Map<Material, Mesh[]>();
  for (const o of k.group.children) {
    if (!(o instanceof Mesh) || keep.has(o) || o.children.length || Array.isArray(o.material)) continue;
    byMaterial.set(o.material, [...(byMaterial.get(o.material) ?? []), o]);
  }
  for (const [material, meshes] of byMaterial) {
    if (meshes.length < 2) continue;
    const textured = 'map' in material && material.map != null;
    const parts = meshes.map(m => {
      m.updateMatrix();
      const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrix);
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && !(textured && name === 'uv')) g.deleteAttribute(name);
      return g;
    });
    const merged = mergeGeometries(parts);
    for (const g of parts) g.dispose();
    if (!merged) continue;
    for (const m of meshes) {
      m.geometry.dispose();
      k.geoms.splice(k.geoms.indexOf(m.geometry), 1);
      k.group.remove(m);
    }
    k.geoms.push(merged);
    k.group.add(new Mesh(merged, material));
  }
}

// ---- the landmarks

interface Landmark {
  name: string;
  frame: Frame;
  /** the line under the name in the tooltip, in the reader's units */
  detail(): string;
  /** the view a click flies to */
  postcard: { center: [number, number]; zoom: number; pitch: number; bearing: number };
  /**
   * How it grows when the map is zoomed out. 'all' grows every way about its foot, 'up'
   * only upwards (its plan is tied to the ground it stands on), 'across' upwards and across its axis but not along it
   * (the bridge, whose length is the strait's), 'island' every way about sea level together with its own copy of the
   * ground it stands on; `most` caps the growth, `tall` is the height that is kept at GROW_PX pixels (250 m unless given), and `shadow` is
   * the blob it lays to the south-east: its length, its width and how far out its middle lies, on the ground under
   * the origin or on the sea
   */
  grow: { how: 'all' | 'up' | 'across' | 'island'; most: number; tall?: number; shadow?: [number, number, number]; shadowOnSea?: boolean; sea?: boolean };
  build(k: Kit): void;
}

/** suspenders are 50 ft apart; closer than this they would draw as a wall, so they only appear from about zoom 13.5 */
const SUSPENDER_MAX_PX = 11;

/**
 * The Golden Gate Bridge: x along the axis from mid-span towards Marin, z across to the east. Dimensions are the
 * bridge district's; see landmarks.ts.
 */
const goldenGate: Landmark = {
  name: 'Golden Gate Bridge',
  frame: BRIDGE,
  detail: () => {
    const u = units.get();
    return `${dist(1.7, u)} ${distUnit(u)} · towers ${elev(746, u)} ${elevUnit(u)} above the water`;
  },
  // the classic view from Battery Spencer: over the north tower, down the bridge towards the city
  postcard: { center: BRIDGE.at(470, 0), zoom: 14, pitch: 60, bearing: 150 },
  grow: { how: 'up', most: 3, sea: true },
  build(k) {
    const { w, ground, mats, add, column, tube } = k;
    const deckUnder = GG.roadway - GG.truss;

    // the towers, on their piers
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
        add(k.taperedBox(legAlong, h, w(GG.legAcross, 1.4), 0.72), mats.steel, s, pierTop + h / 2, side, true);
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

    // the deck: a stiffening truss with the roadway on top, from the toll plaza to Vista Point
    const len = GG.northEnd - GG.southEnd;
    const depth = w(GG.truss, 1);
    add(new BoxGeometry(len, depth, w(2 * GG.halfDeck, 1.6)), [mats.steel, mats.steel, mats.road, mats.dark, mats.lattice, mats.lattice], GG.southEnd + len / 2, GG.roadway - depth / 2, 0);

    // the main cables and their suspenders
    for (const side of [-GG.leg, GG.leg]) {
      const pts: Vector3[] = [];
      // the cable is a smooth curve: a point every 24 m and 160 lengths of tube draw it as well as three times as many
      // (the tower tops, where it turns, are always among the points)
      const xs = new Set([-GG.halfSpan, GG.halfSpan, GG.anchor]);
      for (let x = -GG.anchor; x < GG.anchor; x += 24) if (Math.abs(Math.abs(x) - GG.halfSpan) > 12) xs.add(x);
      for (const x of [...xs].sort((p, q) => p - q)) pts.push(new Vector3(x, cableHeight(x), side));
      tube(pts, 160, w(GG.cableR, 0.6), mats.steel, true);
    }
    if (k.px <= SUSPENDER_MAX_PX) {
      const v: number[] = [];
      const every = k.px > 5 ? 2 : 1;
      for (let i = -71; i <= 71; i += every) {
        const x = i * GG.suspender;
        if (Math.abs(x) > GG.anchor - 14 || Math.abs(Math.abs(x) - GG.halfSpan) < 12) continue;
        for (const side of [-GG.leg, GG.leg]) v.push(x, GG.roadway, side, x, cableHeight(x), side);
      }
      const geo = new BufferGeometry();
      geo.setAttribute('position', new Float32BufferAttribute(v, 3));
      k.geoms.push(geo);
      k.group.add(new LineSegments(geo, mats.rope));
    }

    // the ends: pylons flanking the roadway, the anchorage housings under it, the Fort Point arch, the viaducts
    const pylonZ = GG.halfDeck + 5;
    for (const x of [-1081, -983, 983, 1040]) for (const side of [-pylonZ, pylonZ]) column(x, side, w(12, 1.5), w(10, 1.5), ground(x, side, 8), GG.roadway + 22, mats.concrete);
    for (const x of [-1104, 1013]) column(x, 0, 46, 40, ground(x, 0, 20), GG.roadway - 1, mats.concrete);
    // the 320 ft steel arch over Fort Point: two ribs with spandrel columns up to the deck
    const archY = (x: number) => 60 - 38 * ((x + 1032) / 49) ** 2;
    for (const side of [-10, 10]) {
      const pts: Vector3[] = [];
      for (let x = -1081; x <= -983; x += 3.5) pts.push(new Vector3(x, archY(x), side));
      tube(pts, 40, w(1.2, 0.6), mats.steel);
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
  },
};

/**
 * Sutro Tower on Mount Sutro: three lattice legs that lean in to a waist two thirds of the way up and flare out
 * again into the three antenna masts, banded red and white. 977 ft tall; the band heights are read off photographs.
 * The origin is the centre of the tower's triangle in OpenStreetMap, whose legs stand 21 m out: one due west, the
 * other two to the north-east and the south-east.
 */
const SUTRO = frame(37.75524, -122.45286, 0);
const sutroTower: Landmark = {
  name: 'Sutro Tower',
  frame: SUTRO,
  detail: () => {
    const u = units.get();
    return `${elev(977, u)} ${elevUnit(u)} tall · the city's television mast since 1973`;
  },
  postcard: { center: SUTRO.at(-20, -100), zoom: 15.5, pitch: 60, bearing: -100 },
  grow: { how: 'all', most: 8, shadow: [370, 90, 125] },
  build(k) {
    const { w, ground, mats, bar } = k;
    const base = ground(0, 0, 25);
    const H = 298;
    // the legs' distance from the centre by height above the base: splayed at the foot, a narrow waist, a wide top
    const radius = (h: number) => (h < 190 ? 21 - 13 * (h / 190) : 8 + 7 * ((h - 190) / 72));
    const angles = [-Math.PI / 2, -Math.PI / 2 + (2 * Math.PI) / 3, -Math.PI / 2 + (4 * Math.PI) / 3];
    const at = (h: number, a: number) => new Vector3(radius(h) * Math.cos(a), base + h, radius(h) * Math.sin(a));
    const bands = [0, 55, 110, 150, 190, 226, 262];
    const legW = w(3, 1.2);
    for (const a of angles) {
      for (let i = 1; i < bands.length; i++) bar(at(bands[i - 1], a), at(bands[i], a), legW, i % 2 ? mats.steel : mats.white, true);
      // the antenna mast on each prong
      bar(at(262, a), new Vector3(radius(262) * Math.cos(a), base + H, radius(262) * Math.sin(a)), w(2, 0.9), mats.white);
    }
    // horizontal bracing between the legs, heaviest at the waist platform and the top
    for (const h of [30, 80, 130, 190, 226, 262]) {
      const t = h === 190 || h === 262 ? w(5, 1.2) : w(2.2, 0.8);
      for (let i = 0; i < 3; i++) bar(at(h, angles[i]), at(h, angles[(i + 1) % 3]), t, mats.steel);
    }
  },
};

/**
 * Alcatraz: the island is in the terrain and the water data already (its outline gives the frame: x along the island
 * towards the south-east, z across to the south-west). The cellhouse on the plateau, the lighthouse beside it, the
 * water tower and the two industries buildings at the north-west end, the barracks at the dock.
 */
const ALCATRAZ = frame(37.82685, -122.4228, 126.6);
const alcatraz: Landmark = {
  name: 'Alcatraz',
  frame: ALCATRAZ,
  detail: () => {
    const u = units.get();
    return `the prison island, 1934 to 1963 · lighthouse ${elev(84, u)} ${elevUnit(u)}`;
  },
  postcard: { center: ALCATRAZ.at(0, 0), zoom: 15.5, pitch: 60, bearing: -45 },
  grow: { how: 'island', most: 3, tall: 60, shadow: [520, 260, 90], shadowOnSea: true, sea: true },
  build(k) {
    const { w, ground, mats, column, cylinder, bar, add } = k;
    if (k.grows) {
      // the island itself, read off the terrain on a 15 m grid (asking the terrain is the slow part of a build), so that it grows with its buildings; at true size
      // the terrain's own island is the one that shows. Each cell is cut where the ground meets the sea, which gives
      // the island a coast that does not step with the grid, and the line drawn along it.
      const X0 = -330, Z0 = -150, NX = 42, NZ = 21, STEP = 15, SEA = 0.5;
      const h: number[] = [];
      for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) h.push(Math.max(ground(X0 + i * STEP, Z0 + j * STEP), 0));
      const at = (i: number, j: number) => h[Math.min(NZ - 1, Math.max(0, j)) * NX + Math.min(NX - 1, Math.max(0, i))];
      type P = [number, number, number, number, number, number];
      /** a grid point with the slope's normal there, so that the island shades as one surface rather than by cell */
      const point = (i: number, j: number): P => {
        const nx = -(at(i + 1, j) - at(i - 1, j)) / (2 * STEP), nz = -(at(i, j + 1) - at(i, j - 1)) / (2 * STEP), n = Math.hypot(nx, 1, nz);
        return [X0 + i * STEP, at(i, j), Z0 + j * STEP, nx / n, 1 / n, nz / n];
      };
      const pos: number[] = [], nor: number[] = [], coast: number[] = [];
      for (let j = 0; j < NZ - 1; j++)
        for (let i = 0; i < NX - 1; i++) {
          const ring = [point(i, j), point(i, j + 1), point(i + 1, j + 1), point(i + 1, j)];
          if (!ring.some(q => q[1] > SEA)) continue;
          const poly: P[] = [], shore: P[] = [];
          ring.forEach((q, n) => {
            const r = ring[(n + 1) % 4];
            if (q[1] > SEA) poly.push(q);
            if (q[1] > SEA !== r[1] > SEA) {
              const t = (SEA - q[1]) / (r[1] - q[1]);
              const cut = q.map((v, c) => v + (r[c] - v) * t) as P;
              cut[1] = 0;
              poly.push(cut);
              shore.push(cut);
            }
          });
          for (let n = 1; n < poly.length - 1; n++)
            for (const q of [poly[0], poly[n], poly[n + 1]]) {
              pos.push(q[0], q[1], q[2]);
              nor.push(q[3], q[4], q[5]);
            }
          for (let n = 0; n + 1 < shore.length; n += 2) coast.push(shore[n][0], 0.3, shore[n][2], shore[n + 1][0], 0.3, shore[n + 1][2]);
        }
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
      const island = add(g, mats.land, 0, 0, 0);
      const line = new BufferGeometry();
      line.setAttribute('position', new Float32BufferAttribute(coast, 3));
      k.geoms.push(line);
      island.add(new LineSegments(line, mats.shore));
      k.whenGrown.push(island);
    }
    // footprints from OpenStreetMap, as centre, size and turn in the island's frame; the prison stands 9° off its axis
    const block = (x: number, z: number, lx: number, lz: number, turn: number, h: number, pickable = false) => {
      const y = ground(x, z, Math.min(lx, lz) / 2);
      column(x, z, lx, lz, y, y + h, mats.stone, pickable).rotation.y = (-turn * Math.PI) / 180;
      return y;
    };
    // the cellhouse, three storeys with a raised centre, the administration block at its south-east end and the
    // dining hall at the other
    const top = block(5, 27, 65, 49, 9, 17, true);
    // the ridge starts inside the block below it: two faces at the same height would flicker against each other
    add(new BoxGeometry(65, 4, 22), mats.stone, 5, top + 18, 27).rotation.y = (-9 * Math.PI) / 180;
    block(46, 26, 15, 35, 9, 11);
    block(-53, 18, 52, 20, 9, 9);
    // the lighthouse, an octagonal concrete tower with its lantern
    const lh = ground(75, 27, 4);
    cylinder(75, 27, w(2.6, 0.8), w(3.4, 0.8), lh, lh + 23, mats.stone, 8, true);
    cylinder(75, 27, w(2.2, 0.8), w(2.2, 0.8), lh + 23, lh + 25.6, mats.dark, 8);
    // the water tower north-west of the cellhouse: a tank on four legs
    const wt = ground(-128, -5, 6);
    for (const [dx, dz] of [[-4, -4], [4, -4], [4, 4], [-4, 4]]) bar(new Vector3(-128 + dx, wt, -5 + dz), new Vector3(-128 + dx * 0.7, wt + 18, -5 + dz * 0.7), w(0.8, 0.6), mats.concrete);
    cylinder(-128, -5, 5.5, 5.5, wt + 18, wt + 27, mats.concrete, 16);
    // the two industries buildings along the north-west shore, and the barracks (Building 64) above the dock
    block(-173, 41, 93, 21, 24, 12);
    block(-254, 33, 42, 29, 0, 12);
    block(88, -43, 86, 22, 0, 14);
  },
};

/**
 * The Palace of Fine Arts: the rotunda is the origin, on the lagoon's west shore, and the site's axis runs 10° west
 * of north with the Marina's streets (x along it, z across it to the lagoon). The colonnade and the exhibition hall
 * behind it are arcs about one centre, 65 m out in the lagoon: the colonnade 97 m from it, from the rotunda's
 * shoulders round to 55° each side, where it turns to run straight to the lagoon and then out along it to a pylon;
 * the hall from 116 m to 157 m, 60° each side. That plan and the lagoon's outline are OpenStreetMap's. Dimensions
 * from the National Register description as given by SAH Archipedia and the state landmark record: the rotunda an
 * open octagon 160 ft across and 162 ft to the top of its dome on eight piers, each with a pair of Corinthian
 * columns outside and one inside; the colonnade two rows of columns under a lintel with planter boxes on groups of
 * four columns and the weeping maidens at their corners; the exhibition hall 135 ft wide and 45 ft at its crown.
 */
const PALACE = frame(37.80292, -122.44843, -10);
const ARC = new Vector3(0, 0, 65);
const ARC_R = 97;
const DEG = Math.PI / 180;
/** a point on a circle about the arc's centre, by its angle from the axis through the rotunda */
const onArc = (deg: number, r: number) => {
  const a = -Math.PI / 2 + deg * DEG;
  return { a, x: ARC.x + r * Math.cos(a), z: ARC.z + r * Math.sin(a) };
};
const LAGOON: [number, number][] = [
  [101, 65], [123, 61], [126, 64], [123, 71], [123, 85], [108, 101], [78, 112], [58, 104], [35, 114], [-7, 111], [-11, 109], [-13, 100],
  [-18, 97], [-31, 100], [-53, 113], [-57, 112], [-66, 104], [-80, 108], [-90, 98], [-99, 95], [-107, 80], [-116, 86], [-120, 86], [-121, 80],
  [-118, 73], [-120, 65], [-110, 51], [-100, 42], [-77, 40], [-70, 37], [-66, 31], [-68, 13], [-65, 5], [-52, -7], [-41, -12], [-37, -10],
  [-35, -3], [-40, 17], [-37, 32], [-28, 39], [-2, 50], [23, 40], [37, 30], [39, 20], [34, 6], [34, -2], [38, -9], [47, -9], [62, 3], [67, 11],
  [66, 34], [72, 48], [85, 42], [98, 44], [101, 51], [88, 53], [88, 58], [90, 62],
];
const LAGOON_ISLAND: [number, number][] = [[99, 75], [79, 76], [59, 81], [58, 93], [66, 98], [107, 92], [112, 80]];
const palaceOfFineArts: Landmark = {
  name: 'Palace of Fine Arts',
  frame: PALACE,
  detail: () => {
    const u = units.get();
    return `1915 exposition · rotunda ${elev(162, u)} ${elevUnit(u)}`;
  },
  postcard: { center: PALACE.at(0, 40), zoom: 16, pitch: 60, bearing: -100 },
  grow: { how: 'all', most: 6, tall: 90, shadow: [150, 130, 25] },
  build(k) {
    const { w, ground, mats, add, column, cylinder, sweep, sheet } = k;
    // filled, flat land: one floor for the whole site, the highest of a few samples so nothing sinks into the mesh
    const g = Math.max(ground(0, 0), ground(80, 20), ground(-80, 20), ground(0, -70), ground(0, 80));
    const colR = w(0.75, 0.45);
    const shaft = (x: number, z: number, y0: number, y1: number) => cylinder(x, z, colR, colR * 1.15, y0, y1, mats.ochre, 6);

    // the rotunda: eight piers on an octagon, paired columns on a high base outside and one inside each, an arch
    // between each pair of piers under a band, the entablature ring, the attic ring and the dome
    const R = 22;
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4, ca = Math.cos(a), sa = Math.sin(a);
      column(R * ca, R * sa, 5, 5, g, g + 22, mats.ochre, true).rotation.y = -a;
      column((R + 3.2) * ca, (R + 3.2) * sa, 3.5, 7.5, g, g + 3, mats.ochre).rotation.y = -a;
      for (const t of [-2.4, 2.4]) shaft((R + 3.2) * ca - t * sa, (R + 3.2) * sa + t * ca, g + 3, g + 20.5);
      shaft((R - 3.5) * ca, (R - 3.5) * sa, g, g + 20.5);
      const m = a + Math.PI / 8, apothem = R * Math.cos(Math.PI / 8);
      add(new TorusGeometry(6.5, w(1.1, 0.5), 6, 12, Math.PI), mats.ochre, apothem * Math.cos(m), g + 14.5, apothem * Math.sin(m)).rotation.y = -m - Math.PI / 2;
      column(apothem * Math.cos(m), apothem * Math.sin(m), 2 * R * Math.sin(Math.PI / 8), 2.5, g + 19.5, g + 22, mats.ochre).rotation.y = -m - Math.PI / 2;
    }
    const ring = (r: number, half: number, y0: number, y1: number) =>
      sweep([[-half, y0], [-half, y1], [half, y1], [half, y0], [-half, y0]], new Vector3(0, 0, 0), r, 0, 2 * Math.PI, 8, g, mats.ochre, true);
    ring(R + 1.5, w(1.7, 0.5), 22, 26);
    ring(R - 1.5, w(1.3, 0.5), 26, 32.5);
    add(new SphereGeometry(17, 24, 12, 0, 2 * Math.PI, 0, Math.PI / 2), mats.terracotta, 0, g + 32.5, 0, true);

    // the colonnade: two rows of columns under a lintel, 15° to 55° round the arc each side of the rotunda, then
    // straight to the lagoon and out along it; a planter box on four columns with the maidens at its corners at
    // intervals and at each turn, and a pylon at each end
    const TOP = 13, LINTEL = 15.5, STEP = 4.6, TURN = 55, SHORE = 32, END = 107;
    const hw = w(0.9, 0.4);
    const lintel: [number, number][] = [[-hw, TOP], [-hw, LINTEL], [hw, LINTEL], [hw, TOP], [-hw, TOP]];
    /** a straight run of one row: its columns and its lintel, which stops short of b so that two runs meet without overlapping */
    const run = (ax: number, az: number, bx: number, bz: number) => {
      const len = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len;
      for (let d = STEP; d < len; d += STEP) shaft(ax + ux * d, az + uz * d, g, g + TOP);
      const l = len - hw;
      column(ax + (ux * l) / 2, az + (uz * l) / 2, Math.abs(ux) * l + Math.abs(uz) * 2 * hw, Math.abs(uz) * l + Math.abs(ux) * 2 * hw, g + TOP, g + LINTEL, mats.ochre, true);
    };
    const planter = (x: number, z: number, across: number, turn: number) => {
      const c = Math.cos(turn), sn = Math.sin(turn);
      column(x, z, 8, across + 3, g + LINTEL, g + LINTEL + 4.5, mats.ochre, true).rotation.y = -turn;
      for (const dx of [-3, 3])
        for (const dz of [-across / 2 - 1, across / 2 + 1]) cylinder(x + dx * c - dz * sn, z + dx * sn + dz * c, w(0.5, 0.35), w(0.6, 0.35), g + LINTEL + 4.5, g + LINTEL + 7.5, mats.stone, 6);
    };
    for (const side of [-1, 1]) {
      const rows = [ARC_R - 4.5, ARC_R + 4.5];
      for (const r of rows) {
        sweep(lintel, ARC, r, onArc(15 * side, r).a, onArc(TURN * side, r).a, 16, g, mats.ochre, true);
        for (let deg = 15; deg <= TURN; deg += STEP / r / DEG) {
          const p = onArc(deg * side, r);
          shaft(p.x, p.z, g, g + TOP);
        }
      }
      for (const deg of [20, 31.5, 43]) {
        const p = onArc(deg * side, ARC_R);
        planter(p.x, p.z, 9, p.a + Math.PI / 2);
      }
      // the straight runs carry on from where the two rows leave the arc, so they stand a little closer together;
      // the row on the inside of the turn is the shorter one
      const [inner, outer] = rows.map((r) => onArc(TURN * side, r));
      const gap = Math.abs(outer.x - inner.x) / 2;
      run(inner.x, inner.z, inner.x, SHORE + gap);
      run(outer.x, outer.z, outer.x, SHORE - gap);
      run(inner.x, SHORE + gap, END * side, SHORE + gap);
      run(outer.x, SHORE - gap, END * side, SHORE - gap);
      const mid = (inner.x + outer.x) / 2;
      planter(mid, (inner.z + outer.z) / 2 + 2, 2 * gap, Math.PI / 2);
      planter(mid, SHORE, 2 * gap, Math.PI / 2);
      column((END + 3.5) * side, SHORE, 7, 11, g, g + 19, mats.ochre, true);
    }

    // the exhibition hall behind the colonnade: 135 ft wide, 45 ft to the crown of its arched roof
    const HALL = 116;
    const ha0 = onArc(-60, HALL).a, ha1 = onArc(60, HALL).a;
    // grown, the Palace is its rotunda and colonnade: the hall and the lagoon are its setting, and show at true size
    k.whenTrue.push(sweep([[0, 0], [0, 9], [41, 9], [41, 0], [0, 0]], ARC, HALL, ha0, ha1, 24, g, mats.stone, true));
    k.whenTrue.push(sweep([[0, 9], [3, 11.2], [9, 12.8], [20.5, 13.7], [32, 12.8], [38, 11.2], [41, 9]], ARC, HALL, ha0, ha1, 24, g, mats.roof, true));
    for (const a of [ha0, ha1]) {
      const wall = column(ARC.x + (HALL + 20.5) * Math.cos(a), ARC.z + (HALL + 20.5) * Math.sin(a), 41, 1.2, g, g + 13.2, mats.stone);
      wall.rotation.y = -a;
      k.whenTrue.push(wall);
    }

    // the lagoon and its island
    k.whenTrue.push(sheet(LAGOON, g + 1, mats.water, mats.shore, [LAGOON_ISLAND]));
  },
};

/** a square ring, half-width a, with its faces across the frame's axes */
const square = (a: number): [number, number][] => [[a, a], [a, -a], [-a, -a], [-a, a]];

/**
 * The Transamerica Pyramid: 853 ft, a square 45 m at the street that would come to a point at the tip. The frame is
 * its footprint in OpenStreetMap, which stands with the Financial District's streets, 9° off north. Off photographs:
 * the storey of crossed legs at the foot, 48 storeys of window bands, the two wings (the lift shaft on the east face,
 * the stair on the west) that stand clear of the faces from about the 29th floor as the faces lean away from them,
 * and the aluminium spire over the top 212 ft.
 */
const PYRAMID = frame(37.795167, -122.402785, -9);
const transamerica: Landmark = {
  name: 'Transamerica Pyramid',
  frame: PYRAMID,
  detail: () => {
    const u = units.get();
    return `${elev(853, u)} ${elevUnit(u)} · the city's tallest from 1972 to 2018`;
  },
  postcard: { center: PYRAMID.at(60, 0), zoom: 15.5, pitch: 60, bearing: 170 },
  grow: { how: 'all', most: 8, shadow: [325, 78, 110] },
  build(k) {
    const { w, ground, mats, add, bar, column, loft, taperedBox } = k;
    const g = ground(0, 0, 20);
    const H = 260, FOOT = 14, SPIRE = 195, A = 22.5;
    const half = (h: number) => A * (1 - h / H);
    // the legs: on each face a row of Vs from the street up to the first floor's edge, around a dark core
    column(0, 0, 2 * half(0) - 8, 2 * half(0) - 8, g, g + FOOT, mats.shadow, true);
    const t = w(1.6, 0.7);
    for (let f = 0; f < 4; f++) {
      const c = Math.cos((f * Math.PI) / 2), sn = Math.sin((f * Math.PI) / 2);
      const at = (along: number, h: number) => new Vector3(half(h) * c - along * sn, g + h, half(h) * sn + along * c);
      for (let i = 0; i < 5; i++) {
        const foot = (-0.8 + 0.4 * i) * half(0), span = 0.2 * half(FOOT);
        bar(at(foot, 0), at(foot - span, FOOT), t, mats.white);
        bar(at(foot, 0), at(foot + span, FOOT), t, mats.white);
      }
    }
    loft([{ y: g + FOOT, ring: square(half(FOOT)) }, { y: g + SPIRE, ring: square(half(SPIRE)) }], (SPIRE - FOOT) / 48, mats.quartz, true);
    loft([{ y: g + SPIRE, ring: square(half(SPIRE)) }, { y: g + H, ring: square(w(0.4, 0.5)) }], H, mats.aluminium, true);
    // the wings, plain concrete: they lean in a little themselves, and end flat where the spire begins
    for (const side of [-1, 1]) {
      add(taperedBox(7, SPIRE + 2 - 95, 10, 0.8), mats.concrete, 0, g + (95 + SPIRE + 2) / 2, side * 9, true);
    }
  },
};

/**
 * Salesforce Tower: 1,070 ft, a square with rounded corners, 46 m across at the street and turned with the streets
 * south of Market (its corners point north, east, south and west; the outline is OpenStreetMap's). Off photographs:
 * the walls rise straight for the lower third and then curve in to about two thirds of the width, a white fin at
 * every floor, and the last 150 ft are an open screen round the roof rather than floors.
 */
const SALESFORCE = frame(37.789776, -122.396935, 45);
const salesforceTower: Landmark = {
  name: 'Salesforce Tower',
  frame: SALESFORCE,
  detail: () => {
    const u = units.get();
    return `${elev(1070, u)} ${elevUnit(u)} · the city's tallest since 2018`;
  },
  postcard: { center: SALESFORCE.at(0, 0), zoom: 15.5, pitch: 60, bearing: -120 },
  grow: { how: 'all', most: 8, shadow: [400, 98, 137] },
  build(k) {
    const { ground, mats, loft, sheet } = k;
    const g = ground(0, 0, 20);
    const H = 326, ROOF = 280, STRAIGHT = 110, A = 23;
    // a squircle: |x|^4 + |z|^4 = a^4
    const ring = (a: number): [number, number][] =>
      Array.from({ length: 32 }, (_, i) => {
        const th = -(i / 32) * 2 * Math.PI, c = Math.cos(th), sn = Math.sin(th);
        const r = a / (c ** 4 + sn ** 4) ** 0.25;
        return [r * c, r * sn];
      });
    const half = (h: number) => A * (h < STRAIGHT ? 1 : 1 - 0.38 * ((h - STRAIGHT) / (H - STRAIGHT)) ** 2);
    const levels = (from: number, to: number, steps: number) => Array.from({ length: steps + 1 }, (_, i) => from + ((to - from) * i) / steps).map(h => ({ y: g + h, ring: ring(half(h)) }));
    loft([...levels(0, STRAIGHT, 1), ...levels(STRAIGHT, ROOF, 8).slice(1)], ROOF / 61, mats.glass, true);
    loft(levels(ROOF, H, 3), ROOF / 61, mats.crown, true);
    sheet(ring(half(ROOF)), g + ROOF, mats.glass);
  },
};

const LANDMARKS: Landmark[] = [goldenGate, sutroTower, alcatraz, palaceOfFineArts, transamerica, salesforceTower];

/** the postcard view of a landmark by its name, for the drawing that stands in for it at the home view */
export const postcardOf = (name: string) => LANDMARKS.find(l => l.name === name)?.postcard;

// ---- the layer

interface Built {
  scene: Scene;
  group: Group;
  whenGrown: Object3D[];
  whenTrue: Object3D[];
  pick: Object3D[];
  geoms: BufferGeometry[];
  mvp: Matrix4;
  /** the terrain the footings were built on: its height under the origin and 100 m out each way, null where none */
  floor: (number | null)[];
}

function lights(scene: Scene) {
  // sun from the north-west, as the hillshade has it; the sky and the paper fill the shadows
  const sun = new DirectionalLight('#fff4e2', 3.4);
  sun.position.set(-1, 1.4, -1);
  scene.add(sun, new HemisphereLight('#fff9ef', '#b8a98c', 1.5));
}

/** unless ?landmark=three asks for true size throughout: something 250 m tall stays about this many pixels tall however far out the map is */
const GROW_PX = 44;
const GROW_M = 250;
/** from this zoom in, everything is its true size */
const TRUE_FROM = 14.5;

/** what the layer costs, for a page that spells out ?landmark= (see GuideMap): read by the measuring script, never shown */
export interface LandmarkStats {
  /** draw calls and triangles in the last frame, and the script time it took to submit them */
  calls: number;
  triangles: number;
  renderMs: number;
  /** how long the last rebuild of the models took, and how many there have been */
  rebuildMs: number;
  rebuilds: number;
  /** the last build of each landmark, in ms */
  builds: Record<string, number>;
  /** geometries and textures the renderer holds: a count that climbs with every rebuild is a leak */
  geometries: number;
  textures: number;
  /** the last pointer hit test, in ms */
  pickMs: number;
}

export function threeLandmarks(map: MlMap, big = false, stats?: LandmarkStats): CustomLayerInterface {
  const growth = (l: Landmark) => {
    if (!big) return 1;
    const z = map.getZoom();
    const wanted = Math.min(l.grow.most, Math.max(1, (GROW_PX * metresPerPixel(z)) / (l.grow.tall ?? GROW_M)));
    // a low landmark, measured by a small height, would otherwise still be grown at the zoom cap: whatever it is
    // measured by, it eases to its true size over the zoom and a half below TRUE_FROM
    const allowed = 1 + (l.grow.most - 1) * Math.min(1, Math.max(0, (TRUE_FROM - z) / 1.5));
    return Math.min(wanted, allowed);
  };
  const scaleOf = (l: Landmark, s: number): [number, number, number] => (l.grow.how === 'all' || l.grow.how === 'island' ? [s, s, s] : l.grow.how === 'up' ? [1, s, 1] : [1, s, s]);
  const camera = new PerspectiveCamera();
  const main = new Matrix4(), modelMatrix = new Matrix4();
  const ray = new Raycaster();
  let renderer: WebGLRenderer | null = null;
  let mats: Mats | null = null;
  const built = new Map<Landmark, Built>();
  /** the zoom band (quarter zooms) the models were last built for */
  let band = -1;
  let zoomTimer = 0;
  let tip: maplibregl.Popup | null = null;

  // a grown model is scaled about its datum (the ground under its origin, or the sea), so a footing is built where
  // the scaling will carry it to the terrain that is really under it
  const groundFor =
    (f: Frame, memo: Map<string, number | null>, [sx, sy, sz]: [number, number, number] = [1, 1, 1], datum = 0): Ground =>
    (x0, z0, spread = 0) => {
      const x = x0 * sx, z = z0 * sz;
      const samples = spread ? [[x, z], [x - spread, z], [x + spread, z], [x, z - spread], [x, z + spread]] : [[x, z]];
      let lowest = Infinity;
      for (const [sx, sz] of samples) {
        const key = `${Math.round(sx * 10)},${Math.round(sz * 10)}`;
        let e = memo.get(key);
        if (e === undefined) {
          const [lng, lat] = f.at(sx, sz);
          e = map.queryTerrainElevation({ lng, lat });
          memo.set(key, e);
        }
        if (e != null) lowest = Math.min(lowest, e);
      }
      return lowest === Infinity ? 0 : (lowest - datum) / sy;
    };
  const floorOf = (l: Landmark): (number | null)[] =>
    [[0, 0], [100, 0], [-100, 0], [0, 100], [0, -100]].map(([x, z]) => {
      const [lng, lat] = l.frame.at(x, z);
      return map.queryTerrainElevation({ lng, lat });
    });
  /** the same ground, to within what a footing could show */
  const sameFloor = (a: (number | null)[], b: (number | null)[], within = 0.25) => a.every((v, i) => (v == null || b[i] == null ? v === b[i] : Math.abs(v - b[i]!) < within));
  // asking the terrain for a height is the slow part of a build (Alcatraz reads its island off it, the bridge stands
  // its viaducts on it), and the answers only change when the terrain's tiles do: they are kept per landmark until
  // the ground under it has changed. A few states are kept, not one: the terrain passes through the same ones again
  // as its tiles come and go with the zoom.
  const asked = new Map<Landmark, { floor: (number | null)[]; at: Map<string, number | null> }[]>();
  const memoFor = (l: Landmark, floor: (number | null)[], within: number) => {
    const states = asked.get(l) ?? [];
    asked.set(l, states);
    let m = states.find(st => sameFloor(st.floor, floor, within) && st.at.size < 20000);
    if (!m) {
      states.push((m = { floor, at: new Map() }));
      if (states.length > 4) states.shift();
    }
    return m.at;
  };
  /** whether a landmark is on screen, or near enough to come on with a short pan: the rest are not worth building */
  // by distance on the ground rather than by projecting to the screen, which is meaningless for a point past the
  // horizon of a pitched view: within a screen and a half of the centre, plus the length of the longest landmark
  const near = (l: Landmark) => {
    const c = map.getCenter(), canvas = map.getCanvas();
    const dx = (l.frame.origin[0] - c.lng) * 111_320 * Math.cos((c.lat * Math.PI) / 180), dy = (l.frame.origin[1] - c.lat) * 111_320;
    return Math.hypot(dx, dy) < 1.5 * Math.hypot(canvas.clientWidth, canvas.clientHeight) * metresPerPixel(map.getZoom()) + 1500;
  };
  /** built for another zoom band and out of sight since: built again when they come near */
  const stale = new Set<Landmark>();
  const visible = () => map.getLayer(LANDMARK_3D) !== undefined && map.getLayoutProperty(LANDMARK_3D, 'visibility') !== 'none';

  const dispose = (b: Built) => {
    for (const g of b.geoms) g.dispose();
    b.scene.clear();
  };
  const buildOne = (l: Landmark) => {
    if (!mats) return;
    const old = built.get(l);
    if (old) dispose(old);
    const s = growth(l), scale = scaleOf(l, s);
    // a grown island shows its own copy of the ground, so what it stands on only has to agree with that copy: the
    // metre or two by which the terrain shifts between zoom levels is not worth reading the whole island again for
    const floor = floorOf(l), memo = memoFor(l, floor, l.grow.how === 'island' && s > 1.02 ? 3 : 0.25);
    stale.delete(l);
    const datum = l.grow.sea ? 0 : (map.queryTerrainElevation({ lng: l.frame.origin[0], lat: l.frame.origin[1] }) ?? 0);
    // an island carries its own ground, so its footings stand where they really do and the whole of it is scaled
    const k = kit(metresPerPixel(map.getZoom()) / scale[0], l.grow.how === 'island' ? groundFor(l.frame, memo) : groundFor(l.frame, memo, scale, datum), mats, big);
    l.build(k);
    mergeParts(k);
    if (big && l.grow.shadow) {
      // the sun stands north-west, as the hillshade has it: the shadow lies to the south-east, as long as the thing is tall
      const [len, wide, out] = l.grow.shadow;
      const y = l.grow.shadowOnSea ? (1 - datum) / scale[1] : 1;
      const m = k.add(new PlaneGeometry(len, wide), mats.shadow2, 0, y, 0);
      m.rotation.set(-Math.PI / 2, 0, -Math.PI / 4 - l.frame.rotationY, 'YXZ');
      m.position.set(out, y, 0).applyAxisAngle(Y, -Math.PI / 4 - l.frame.rotationY);
      m.renderOrder = -1;
      // a shadow on the sea belongs to the grown island: at true size it would lie round the terrain's own island,
      // whose shore it does not follow
      if (l.grow.shadowOnSea) k.whenGrown.push(m);
    }
    k.group.rotation.y = l.frame.rotationY;
    k.group.position.y = datum;
    k.group.scale.set(...scale);
    const scene = new Scene();
    lights(scene);
    scene.add(k.group);
    scene.updateMatrixWorld(true);
    built.set(l, { scene, group: k.group, whenGrown: k.whenGrown, whenTrue: k.whenTrue, pick: k.pick, geoms: k.geoms, mvp: old?.mvp ?? new Matrix4(), floor });
  };
  const rebuild = () => {
    const t0 = performance.now();
    for (const l of LANDMARKS) {
      const t1 = performance.now();
      if (built.has(l) && !near(l)) stale.add(l);
      else buildOne(l);
      if (stats) stats.builds[l.name] = performance.now() - t1;
    }
    if (stats) {
      stats.rebuildMs = performance.now() - t0;
      stats.rebuilds++;
    }
    band = Math.round(map.getZoom() * 4);
    map.triggerRepaint();
  };
  const onZoom = () => {
    window.clearTimeout(zoomTimer);
    zoomTimer = window.setTimeout(() => {
      // while the terrain's tiles for the new zoom are still coming in it answers with heights that will not last:
      // a build now would be built again on idle, so idle gets it
      if (Math.round(map.getZoom() * 4) !== band && map.areTilesLoaded()) rebuild();
    }, 150);
  };
  // the terrain arrives after the style and after each switch to 3D, and it sharpens as its tiles come in: a model
  // built during a flight stands on the coarse parent tiles, so when the ground under it has changed by the time the
  // map is idle, it is built again on the ground that is actually there
  const onIdle = () => {
    if (!visible()) return;
    if (Math.round(map.getZoom() * 4) !== band) return rebuild();
    let any = false;
    for (const l of LANDMARKS) {
      const b = built.get(l);
      if (!b || !near(l)) continue;
      if (stale.has(l) || !sameFloor(b.floor, floorOf(l))) {
        buildOne(l);
        any = true;
      }
    }
    if (any) map.triggerRepaint();
  };

  /** the landmark under a screen point, by casting a ray back through each one's last projection */
  const hit = (p: { x: number; y: number }): Landmark | null => {
    if (!renderer || !visible()) return null;
    const c = map.getCanvas();
    const nx = (p.x / c.clientWidth) * 2 - 1, ny = 1 - (p.y / c.clientHeight) * 2;
    for (const l of LANDMARKS) {
      const b = built.get(l);
      if (!b) continue;
      const inv = b.mvp.clone().invert();
      const near = new Vector3(nx, ny, -1).applyMatrix4(inv), far = new Vector3(nx, ny, 1).applyMatrix4(inv);
      ray.set(near, far.sub(near).normalize());
      if (ray.intersectObjects(b.pick.filter(o => o.visible), false).length) return l;
    }
    return null;
  };
  let moved: MapMouseEvent | null = null;
  const onMove = (e: MapMouseEvent) => {
    // a mouse reports far more often than the screen is drawn, and a hit test casts a ray at every part: one a frame
    if (!moved) requestAnimationFrame(() => {
      const last = moved!;
      moved = null;
      if (renderer) point(last);
    });
    moved = e;
  };
  const point = (e: MapMouseEvent) => {
    const t0 = performance.now();
    const over = document.body.classList.contains('tipped') ? null : hit(e.point);
    if (over) {
      map.getCanvas().style.cursor = 'pointer';
      if (!tip) tip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'ride-tip', offset: 14, maxWidth: 'none' });
      tip.setLngLat(e.lngLat).setHTML(`<span>${esc(over.name)}</span><small>${esc(over.detail())}</small>`);
      if (!tip.isOpen()) tip.addTo(map);
    } else if (tip?.isOpen()) {
      tip.remove();
      map.getCanvas().style.cursor = '';
    }
    if (stats) stats.pickMs = performance.now() - t0;
  };
  // a click on a ride line opens the ride, as anywhere else; the rest of a landmark swings to its postcard view
  const onClick = (e: MapMouseEvent) => {
    const l = hit(e.point);
    if (!l || map.queryRenderedFeatures(e.point, { layers: [LYR.routeHit] }).length) return;
    tip?.remove();
    map.flyTo({ ...l.postcard, duration: reducedMotion() ? 0 : 2200 });
  };

  return {
    id: LANDMARK_3D,
    type: 'custom',
    renderingMode: '3d',
    onAdd(_map, gl) {
      mats = materials();
      renderer = new WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
      renderer.autoClear = false;
      renderer.info.autoReset = false;
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
      for (const b of built.values()) dispose(b);
      built.clear();
      renderer?.dispose();
      renderer = null;
    },
    render(gl, args: CustomRenderMethodInput) {
      if (!renderer) return;
      const t0 = performance.now();
      renderer.info.reset();
      renderer.resetState();
      renderer.setViewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      main.fromArray(args.defaultProjectionData.mainMatrix as unknown as number[]);
      for (const l of LANDMARKS) {
        const b = built.get(l);
        if (!b) continue;
        if (big) {
          const s = growth(l);
          b.group.scale.set(...scaleOf(l, s));
          for (const o of b.whenGrown) o.visible = s > 1.02;
          for (const o of b.whenTrue) o.visible = s < 1.3;
        }
        const model = map.transform.getMatrixForModel(l.frame.origin, 0);
        b.mvp.copy(main).multiply(modelMatrix.fromArray(model as unknown as number[]));
        camera.projectionMatrix.copy(b.mvp);
        camera.projectionMatrixInverse.copy(b.mvp).invert();
        renderer.render(b.scene, camera);
      }
      if (stats) {
        stats.calls = renderer.info.render.calls;
        stats.triangles = renderer.info.render.triangles;
        stats.renderMs = performance.now() - t0;
        stats.geometries = renderer.info.memory.geometries;
        stats.textures = renderer.info.memory.textures;
      }
    },
  };
}
