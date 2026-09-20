// PROTOTYPE: the Golden Gate Bridge as a landmark on the 3D map, built from its published dimensions rather than a
// downloaded model, so it costs a few hundred bytes of code and nothing to license. Two renderings share this frame:
// MapLibre's own fill-extrusion layer (this file) and a three.js custom layer (landmarks3d.ts, loaded on demand).
import type { Feature, FeatureCollection, Polygon } from 'geojson';
import type { Map as MlMap } from 'maplibre-gl';

/**
 * The bridge's frame: mid-span on the centreline (lat, lng) and the axis bearing towards Marin, degrees clockwise
 * from north. Both come from the Hawk Hill ride's planned route (which runs along the west sidewalk, 9 m off the
 * centreline) and the water data's shorelines: the south pier stands 1,100 ft off Fort Point and the north pier at
 * the Marin shore, and the mid-span that gives agrees with the published centre (37.81972, -122.47861) to 4 m.
 */
export const MID: [number, number] = [37.81968, -122.4786];
export const BEARING = -5.37;

/**
 * Dimensions in metres, heights above sea level: goldengate.org design & construction statistics. Towers 746 ft
 * above water and 500 ft above the roadway, so the roadway is at 75 m; the truss under it is 25 ft deep, which puts
 * its underside at the published 220 ft clearance. Main span 4,200 ft, side spans 1,125 ft, cable sag 475 ft, tower
 * legs 33 × 54 ft at the base, suspenders every 50 ft, deck 90 ft wide. The rest (leg spacing, strut heights, the
 * 320 ft Fort Point arch, pylons, anchorages and approach viaducts) is scaled from photographs.
 */
export const GG = {
  tower: 227,
  roadway: 75,
  truss: 7.6,
  halfSpan: 640,
  side: 343,
  sag: 144.8,
  halfDeck: 13.7,
  /** the legs sit between the roadway and the sidewalks, and the cables ride on top of them */
  leg: 14.5,
  legAlong: 16,
  legAcross: 10,
  cableR: 0.46,
  suspender: 15.24,
  /** where the cables enter the anchorages, along the axis from mid-span, and how high */
  anchor: 1104,
  anchorY: 78,
  /** the deck's ends: the toll plaza abutment and Vista Point */
  southEnd: -1370,
  northEnd: 1330,
} as const;
/** International Orange, as the bridge district specifies it */
export const BRIDGE_COLOR = '#d2452b';

const M_PER_DEG_LAT = 111_320;
const mPerDegLng = M_PER_DEG_LAT * Math.cos((MID[0] * Math.PI) / 180);
const rad = (BEARING * Math.PI) / 180;
/** unit vectors in metres (east, north): along the bridge towards Marin, and across it to the right (east) */
export const ALONG = [Math.sin(rad), Math.cos(rad)] as const;
export const ACROSS = [ALONG[1], -ALONG[0]] as const;

/** a point on the bridge, in metres along the axis from mid-span and across it, as [lng, lat] */
export function at(along: number, across: number): [number, number] {
  const e = along * ALONG[0] + across * ACROSS[0], n = along * ALONG[1] + across * ACROSS[1];
  return [MID[1] + e / mPerDegLng, MID[0] + n / M_PER_DEG_LAT];
}

/** height of a main cable above the water at `x` metres from mid-span */
export function cableHeight(x: number): number {
  const a = Math.abs(x);
  if (a <= GG.halfSpan) return GG.tower - GG.sag + GG.sag * (a / GG.halfSpan) ** 2;
  // side span: nearly straight from the tower top down into the anchorage, with a little sag of its own
  const t = Math.min(1, (a - GG.halfSpan) / (GG.anchor - GG.halfSpan));
  return GG.tower + (GG.anchorY - GG.tower) * t - 4 * 8 * t * (1 - t);
}

type Part = { base: number; h: number; part: string };

function rect(along: number, across: number, l: number, w: number, p: Part): Feature<Polygon, Part> {
  const ring = [at(along - l / 2, across - w / 2), at(along + l / 2, across - w / 2), at(along + l / 2, across + w / 2), at(along - l / 2, across + w / 2)];
  ring.push(ring[0]);
  return { type: 'Feature', properties: p, geometry: { type: 'Polygon', coordinates: [ring] } };
}

/** the bridge as extrudable footprints: towers, deck, and each main cable as a run of short stepped blocks */
export function goldenGate(): FeatureCollection<Polygon, Part> {
  const f: Feature<Polygon, Part>[] = [];
  for (const s of [-GG.halfSpan, GG.halfSpan]) {
    for (const side of [-GG.leg, GG.leg]) f.push(rect(s, side, GG.legAlong, GG.legAcross, { base: 0, h: GG.tower, part: 'tower' }));
    for (const b of [36, 84, 124, 161, 194, 218]) f.push(rect(s, 0, 12, 2 * GG.leg, { base: b, h: b + 8, part: 'tower' }));
  }
  const len = GG.northEnd - GG.southEnd;
  f.push(rect(GG.southEnd + len / 2, 0, len, 2 * GG.halfDeck, { base: GG.roadway - GG.truss, h: GG.roadway, part: 'deck' }));
  const step = 20;
  for (const side of [-GG.leg, GG.leg]) {
    for (let x = -GG.anchor; x < GG.anchor; x += step) {
      const h0 = cableHeight(x), h1 = cableHeight(x + step);
      f.push(rect(x + step / 2, side, step, 2.5, { base: Math.min(h0, h1) - 1, h: Math.max(h0, h1) + 1, part: 'cable' }));
    }
  }
  return { type: 'FeatureCollection', features: f };
}

export const LANDMARK_SRC = 'landmarks', LANDMARK_LYR = 'landmark-extrude';

/** MapLibre's own extrusion: no new dependency, one layer, a few KB of GeoJSON */
export function addExtrudedLandmarks(map: MlMap) {
  map.addSource(LANDMARK_SRC, { type: 'geojson', data: goldenGate() });
  map.addLayer({
    id: LANDMARK_LYR,
    type: 'fill-extrusion',
    source: LANDMARK_SRC,
    paint: {
      'fill-extrusion-color': BRIDGE_COLOR,
      'fill-extrusion-base': ['get', 'base'],
      'fill-extrusion-height': ['get', 'h'],
      'fill-extrusion-vertical-gradient': true,
    },
  });
}
