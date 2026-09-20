// PROTOTYPE: the Golden Gate Bridge as a landmark on the 3D map, built from its published dimensions rather than a
// downloaded model, so it costs a few hundred bytes of code and nothing to license. Two renderings share this frame:
// MapLibre's own fill-extrusion layer (this file) and a three.js custom layer (landmarks3d.ts, loaded on demand).
import type { Feature, FeatureCollection, Polygon } from 'geojson';
import type { Map as MlMap } from 'maplibre-gl';

/** tower centres on the bridge axis (lat, lng); approximate, read off the Hawk Hill ride's planned route */
const SOUTH_TOWER: [number, number] = [37.814, -122.478];
const NORTH_TOWER: [number, number] = [37.8255, -122.4794];
/** metres: tower height above water, deck underside, cable at mid-span, side-span length, anchorage height */
export const GG = { tower: 227, deck: 67, deckTop: 75, sag: 152, side: 343, anchor: 20, halfSpan: 640, width: 27, cable: 13.5, leg: 11 };
/** the bridge's colour: international orange, dulled to sit on the paper */
export const BRIDGE_COLOR = '#c4452c';

const M_PER_DEG_LAT = 111_320;
const mid = [(SOUTH_TOWER[0] + NORTH_TOWER[0]) / 2, (SOUTH_TOWER[1] + NORTH_TOWER[1]) / 2] as const;
const mPerDegLng = M_PER_DEG_LAT * Math.cos((mid[0] * Math.PI) / 180);
const dx = (NORTH_TOWER[1] - SOUTH_TOWER[1]) * mPerDegLng, dy = (NORTH_TOWER[0] - SOUTH_TOWER[0]) * M_PER_DEG_LAT;
const len = Math.hypot(dx, dy);
/** unit vectors in metres (east, north): along the bridge towards Marin, and across it to the right */
export const ALONG = [dx / len, dy / len] as const;
export const ACROSS = [ALONG[1], -ALONG[0]] as const;

/** a point on the bridge, in metres along the axis from mid-span and across it, as [lng, lat] */
export function at(along: number, across: number): [number, number] {
  const e = along * ALONG[0] + across * ACROSS[0], n = along * ALONG[1] + across * ACROSS[1];
  return [mid[1] + e / mPerDegLng, mid[0] + n / M_PER_DEG_LAT];
}

/** height of a main cable above water at `x` metres from mid-span */
export function cableHeight(x: number): number {
  const a = Math.abs(x);
  if (a <= GG.halfSpan) return GG.deckTop + GG.sag * (a / GG.halfSpan) ** 2;
  // side span: a shallow curve from the tower top to the anchorage
  const t = Math.min(1, (a - GG.halfSpan) / GG.side);
  return GG.tower - (GG.tower - GG.anchor) * (1 - (1 - t) ** 2);
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
    for (const side of [-GG.leg, GG.leg]) f.push(rect(s, side, 16, 10, { base: 0, h: GG.tower, part: 'tower' }));
    for (const b of [30, 100, 150, 200]) f.push(rect(s, 0, 8, 2 * GG.leg + 10, { base: b, h: b + 10, part: 'tower' }));
  }
  f.push(rect(60, 0, 2380, GG.width, { base: GG.deck, h: GG.deckTop, part: 'deck' }));
  const step = 20, end = GG.halfSpan + GG.side;
  for (const side of [-GG.cable, GG.cable]) {
    for (let x = -end; x < end; x += step) {
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
