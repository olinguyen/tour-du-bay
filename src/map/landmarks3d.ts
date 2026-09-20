// PROTOTYPE: landmarks as three.js scenes drawn through one MapLibre custom layer, loaded on demand from GuideMap so
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
  Raycaster,
  RepeatWrapping,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  TubeGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';
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
  return {
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
  /** a flat polygon at height y, fanned from its first point, with an outline in a second material when given */
  sheet(outline: [number, number][], y: number, mat: Material, edge?: Material): Mesh;
}

function kit(px: number, ground: Ground, mats: Mats): Kit {
  const group = new Group();
  const geoms: BufferGeometry[] = [];
  const pick: Object3D[] = [];
  const add: Kit['add'] = (geo, mat, x, y, z, pickable = false) => {
    geoms.push(geo);
    const m = new Mesh(geo, mat);
    m.position.set(x, y, z);
    group.add(m);
    if (pickable) pick.push(m);
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
    add,
    column: (x, z, lx, lz, y0, y1, mat, pickable) => add(new BoxGeometry(lx, y1 - y0, lz), mat, x, (y0 + y1) / 2, z, pickable),
    cylinder: (x, z, rTop, rBottom, y0, y1, mat, segments = 12, pickable) => add(new CylinderGeometry(rTop, rBottom, y1 - y0, segments), mat, x, (y0 + y1) / 2, z, pickable),
    bar(a, b, t, mat, pickable) {
      const d = new Vector3().subVectors(b, a);
      const m = add(new BoxGeometry(t, d.length(), t), mat, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, pickable);
      m.quaternion.setFromUnitVectors(Y, d.normalize());
      return m;
    },
    tube: (pts, segments, r, mat, pickable) => add(new TubeGeometry(new CatmullRomCurve3(pts), segments, r, 6), mat, 0, 0, 0, pickable),
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
    sheet(outline, y, mat, edge) {
      const pos: number[] = [];
      const idx: number[] = [];
      for (const [x, z] of outline) pos.push(x, y, z);
      for (let i = 1; i < outline.length - 1; i++) idx.push(0, i + 1, i);
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      if (edge) {
        const e = new BufferGeometry();
        e.setAttribute('position', new Float32BufferAttribute(pos, 3));
        geoms.push(e);
        group.add(new LineLoop(e, edge));
      }
      return add(g, mat, 0, 0, 0);
    },
  };
}

// ---- the landmarks

interface Landmark {
  name: string;
  frame: Frame;
  /** the line under the name in the tooltip, in the reader's units */
  detail(): string;
  /** the view a click flies to */
  postcard: { center: [number, number]; zoom: number; pitch: number; bearing: number };
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
      for (let x = -GG.anchor; x <= GG.anchor; x += 8) pts.push(new Vector3(x, cableHeight(x), side));
      tube(pts, 320, w(GG.cableR, 0.6), mats.steel, true);
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
 * again into the three antenna masts, banded red and white. 977 ft tall; the footprint and band heights are read
 * off photographs.
 */
const SUTRO = frame(37.7553, -122.4528, 0);
const sutroTower: Landmark = {
  name: 'Sutro Tower',
  frame: SUTRO,
  detail: () => {
    const u = units.get();
    return `${elev(977, u)} ${elevUnit(u)} tall · the city's television mast since 1973`;
  },
  postcard: { center: SUTRO.at(-20, -100), zoom: 15.5, pitch: 60, bearing: -100 },
  build(k) {
    const { w, ground, mats, bar } = k;
    const base = ground(0, 0, 25);
    const H = 298;
    // the legs' distance from the centre by height above the base: splayed at the foot, a narrow waist, a wide top
    const radius = (h: number) => (h < 190 ? 22 - 14 * (h / 190) : 8 + 7 * ((h - 190) / 72));
    const angles = [Math.PI / 2, Math.PI / 2 + (2 * Math.PI) / 3, Math.PI / 2 + (4 * Math.PI) / 3];
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
 * water tower and the industries building at the north-west end, the barracks at the dock.
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
  build(k) {
    const { w, ground, mats, column, cylinder, bar, add } = k;
    // the cellhouse, three storeys with a raised centre
    const top = ground(-20, 10, 40);
    column(-20, 10, 150, 45, top, top + 17, mats.stone, true);
    // the ridge starts inside the block below it: two faces at the same height would flicker against each other
    add(new BoxGeometry(150, 4, 22), mats.stone, -20, top + 18, 10);
    // the lighthouse, an octagonal concrete tower with its lantern
    const lh = ground(65, 25, 6);
    cylinder(65, 25, w(2.6, 0.8), w(3.4, 0.8), lh, lh + 23, mats.stone, 8, true);
    cylinder(65, 25, w(2.2, 0.8), w(2.2, 0.8), lh + 23, lh + 25.6, mats.dark, 8);
    // the water tower at the north-west end: a tank on four legs
    const wt = ground(-150, -20, 8);
    for (const [dx, dz] of [[-4, -4], [4, -4], [4, 4], [-4, 4]]) bar(new Vector3(-150 + dx, wt, -20 + dz), new Vector3(-150 + dx * 0.7, wt + 18, -20 + dz * 0.7), w(0.8, 0.6), mats.concrete);
    cylinder(-150, -20, 5.5, 5.5, wt + 18, wt + 27, mats.concrete, 16);
    // the industries building along the north-west shore, and the barracks above the dock on the bay side
    const ind = ground(-190, 20, 12);
    column(-190, 20, 80, 22, ind, ind + 12, mats.stone);
    const dock = ground(90, -55, 12);
    column(90, -55, 100, 22, dock, dock + 14, mats.stone);
  },
};

/**
 * The Palace of Fine Arts: the rotunda is the origin, and the colonnade and the exhibition hall behind it curve
 * around the lagoon to its east (x north, z east). Dimensions from the National Register description as given by
 * SAH Archipedia and the state landmark record: the rotunda an open octagon 160 ft across and 162 ft to the top of
 * its dome on eight piers, each with a pair of Corinthian columns outside and one inside; the colonnade two rows
 * of columns under a lintel with planter boxes on groups of four columns and the weeping maidens at their corners;
 * the exhibition hall 135 ft wide and 45 ft at its crown, 950 ft along its face. The lagoon is sketched.
 */
const PALACE = frame(37.80292, -122.44843, 0);
/** the arc the colonnade and hall follow: its centre lies out in the lagoon, so the rotunda sits at angle -90° */
const ARC = new Vector3(0, 0, 240);
const ARC_R = ARC.z;
const onArc = (s: number, r: number) => {
  const a = -Math.PI / 2 + s / ARC_R;
  return { a, x: ARC.x + r * Math.cos(a), z: ARC.z + r * Math.sin(a) };
};
const palaceOfFineArts: Landmark = {
  name: 'Palace of Fine Arts',
  frame: PALACE,
  detail: () => {
    const u = units.get();
    return `1915 exposition · rotunda ${elev(162, u)} ${elevUnit(u)}`;
  },
  postcard: { center: PALACE.at(0, 40), zoom: 16, pitch: 60, bearing: -95 },
  build(k) {
    const { w, ground, mats, add, column, cylinder, sweep, sheet } = k;
    // filled, flat land: one floor for the whole site, the highest of a few samples so nothing sinks into the mesh
    const g = Math.max(ground(0, 0), ground(140, 45), ground(-140, 45), ground(0, -70), ground(0, 110));
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

    // the colonnade, out to 150 m each side of the rotunda: two rows of columns 30 ft apart under a lintel, a planter
    // box on four columns every 45 m with the maidens at its corners, and a pylon at each end
    const ROW = 4.5, TOP = 13, LINTEL = 15.5;
    const lintel: [number, number][] = [[-w(0.9, 0.4), TOP], [-w(0.9, 0.4), LINTEL], [w(0.9, 0.4), LINTEL], [w(0.9, 0.4), TOP], [-w(0.9, 0.4), TOP]];
    for (const side of [-1, 1]) {
      for (const r of [ARC_R - ROW, ARC_R + ROW]) {
        sweep(lintel, ARC, r, onArc(26 * side, r).a, onArc(150 * side, r).a, 24, g, mats.ochre, true);
        for (let s = 26; s <= 150; s += 4.6) {
          const p = onArc(s * side, r);
          shaft(p.x, p.z, g, g + TOP);
        }
      }
      for (const sb of [45, 90, 135]) {
        const p = onArc(sb * side, ARC_R);
        column(p.x, p.z, 8, 2 * ROW + 3, g + LINTEL, g + LINTEL + 4.5, mats.ochre, true).rotation.y = -p.a - Math.PI / 2;
        for (const ds of [-3, 3])
          for (const dr of [-ROW - 1, ROW + 1]) {
            const q = onArc(sb * side + ds, ARC_R + dr);
            cylinder(q.x, q.z, w(0.5, 0.35), w(0.6, 0.35), g + LINTEL + 4.5, g + LINTEL + 7.5, mats.stone, 6);
          }
      }
      const e = onArc(155 * side, ARC_R);
      column(e.x, e.z, 7, 11, g, g + 19, mats.ochre, true).rotation.y = -e.a - Math.PI / 2;
    }

    // the exhibition hall behind the colonnade: 135 ft wide, 45 ft to the crown of its arched roof
    const HALL = ARC_R + 30, half = 145 / HALL;
    const ha0 = -Math.PI / 2 - half, ha1 = -Math.PI / 2 + half;
    sweep([[0, 0], [0, 9], [41, 9], [41, 0], [0, 0]], ARC, HALL, ha0, ha1, 24, g, mats.stone, true);
    sweep([[0, 9], [3, 11.2], [9, 12.8], [20.5, 13.7], [32, 12.8], [38, 11.2], [41, 9]], ARC, HALL, ha0, ha1, 24, g, mats.roof, true);
    for (const a of [ha0, ha1]) column(ARC.x + (HALL + 20.5) * Math.cos(a), ARC.z + (HALL + 20.5) * Math.sin(a), 41, 1.2, g, g + 13.2, mats.stone).rotation.y = -a;

    // the lagoon, sketched: it fills the curve of the colonnade, wider in the middle, with an irregular far shore
    const shore: [number, number][] = [];
    for (let s = -128; s <= 128; s += 16) {
      const p = onArc(s, ARC_R - 14 - 0.15 * Math.abs(s));
      shore.push([p.x, p.z]);
    }
    for (const xz of [[128, 78], [110, 98], [85, 114], [55, 126], [20, 130], [-15, 124], [-45, 120], [-75, 112], [-100, 100], [-120, 82]] as [number, number][]) shore.push(xz);
    sheet(shore, g + 1, mats.water, mats.shore);
  },
};

const LANDMARKS: Landmark[] = [goldenGate, sutroTower, alcatraz, palaceOfFineArts];

// ---- the layer

interface Built {
  scene: Scene;
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

export function threeLandmarks(map: MlMap): CustomLayerInterface {
  const camera = new PerspectiveCamera();
  const ray = new Raycaster();
  let renderer: WebGLRenderer | null = null;
  let mats: Mats | null = null;
  const built = new Map<Landmark, Built>();
  /** the zoom band (quarter zooms) the models were last built for */
  let band = -1;
  let zoomTimer = 0;
  let tip: maplibregl.Popup | null = null;

  const groundFor =
    (f: Frame): Ground =>
    (x, z, spread = 0) => {
      const samples = spread ? [[x, z], [x - spread, z], [x + spread, z], [x, z - spread], [x, z + spread]] : [[x, z]];
      let lowest = Infinity;
      for (const [sx, sz] of samples) {
        const [lng, lat] = f.at(sx, sz);
        const e = map.queryTerrainElevation({ lng, lat });
        if (e != null) lowest = Math.min(lowest, e);
      }
      return lowest === Infinity ? 0 : lowest;
    };
  const floorOf = (l: Landmark): (number | null)[] =>
    [[0, 0], [100, 0], [-100, 0], [0, 100], [0, -100]].map(([x, z]) => {
      const [lng, lat] = l.frame.at(x, z);
      return map.queryTerrainElevation({ lng, lat });
    });
  /** the same ground, to within what a footing could show */
  const sameFloor = (a: (number | null)[], b: (number | null)[]) => a.every((v, i) => (v == null || b[i] == null ? v === b[i] : Math.abs(v - b[i]!) < 0.25));
  const visible = () => map.getLayer(LANDMARK_3D) !== undefined && map.getLayoutProperty(LANDMARK_3D, 'visibility') !== 'none';

  const dispose = (b: Built) => {
    for (const g of b.geoms) g.dispose();
    b.scene.clear();
  };
  const buildOne = (l: Landmark) => {
    if (!mats) return;
    const old = built.get(l);
    if (old) dispose(old);
    const k = kit(metresPerPixel(map.getZoom()), groundFor(l.frame), mats);
    l.build(k);
    k.group.rotation.y = l.frame.rotationY;
    const scene = new Scene();
    lights(scene);
    scene.add(k.group);
    scene.updateMatrixWorld(true);
    built.set(l, { scene, pick: k.pick, geoms: k.geoms, mvp: old?.mvp ?? new Matrix4(), floor: floorOf(l) });
  };
  const rebuild = () => {
    for (const l of LANDMARKS) buildOne(l);
    band = Math.round(map.getZoom() * 4);
    map.triggerRepaint();
  };
  const onZoom = () => {
    window.clearTimeout(zoomTimer);
    zoomTimer = window.setTimeout(() => {
      if (Math.round(map.getZoom() * 4) !== band) rebuild();
    }, 150);
  };
  // the terrain arrives after the style and after each switch to 3D, and it sharpens as its tiles come in: a model
  // built during a flight stands on the coarse parent tiles, so when the ground under it has changed by the time the
  // map is idle, it is built again on the ground that is actually there
  const onIdle = () => {
    if (!visible()) return;
    let any = false;
    for (const l of LANDMARKS) {
      const b = built.get(l);
      if (b && !sameFloor(b.floor, floorOf(l))) {
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
      if (ray.intersectObjects(b.pick, false).length) return l;
    }
    return null;
  };
  const onMove = (e: MapMouseEvent) => {
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
      renderer.resetState();
      renderer.setViewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      const main = new Matrix4().fromArray(args.defaultProjectionData.mainMatrix as unknown as number[]);
      for (const l of LANDMARKS) {
        const b = built.get(l);
        if (!b) continue;
        const model = map.transform.getMatrixForModel(l.frame.origin, 0);
        b.mvp.copy(main).multiply(new Matrix4().fromArray(model as unknown as number[]));
        camera.projectionMatrix.copy(b.mvp);
        camera.projectionMatrixInverse.copy(b.mvp).invert();
        renderer.render(b.scene, camera);
      }
    },
  };
}
