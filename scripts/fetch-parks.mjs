#!/usr/bin/env node
// Builds src/data/bay-parks.json: the parks, preserves and other protected open space inside the map's bounds, as a
// GeoJSON FeatureCollection of polygons filled in green under the relief.
//
// Sources (OpenStreetMap via Overpass, ODbL):
//   leisure=park|nature_reserve and boundary=protected_area|national_park, as closed ways and as relations; kept when
//   larger than MIN_AREA_KM2. Overlapping boundaries (a state park inside the GGNRA) are all kept: the fill is opaque,
//   so they don't stack. Marine reserves are dropped by name; what is left of them lies under the water layer anyway.
//
// Usage: node scripts/fetch-parks.mjs [--tolerance=80] [--min-area=1] [--cache=/tmp/overpass-parks.json]
//   (Node >= 18, no dependencies; --cache keeps the raw Overpass response so tuning runs don't refetch ~20 MB)

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BBOX, DATA, arg, area, overpass, pointInRing, polygonFeature, relationRings } from './lib/osm-polygons.mjs';

const OUT = resolve(DATA, 'bay-parks.json');
const TOLERANCE_M = Number(arg('tolerance', 80));
const MIN_AREA_KM2 = Number(arg('min-area', 1));
const CACHE = arg('cache', '');
const MAX_BYTES = 400 * 1024;
const MARINE = /marine|sanctuary|estuar/i;

console.log('fetching parks + protected areas from Overpass…');
const data = await overpass(`[out:json][timeout:300];
(
  way[leisure~"^(park|nature_reserve)$"](${BBOX});
  relation[leisure~"^(park|nature_reserve)$"](${BBOX});
  way[boundary~"^(protected_area|national_park)$"](${BBOX});
  relation[boundary~"^(protected_area|national_park)$"](${BBOX});
);
out geom;`, CACHE);
const ways = data.elements.filter(e => e.type === 'way' && e.geometry);
const rels = data.elements.filter(e => e.type === 'relation');
console.log(`  ${ways.length} ways, ${rels.length} relations`);

const features = [];
const park = (outer, holes, tags = {}) => {
  if (Math.abs(area(outer)) < MIN_AREA_KM2 || MARINE.test(tags.name || '')) return;
  const f = polygonFeature(outer, holes, { name: tags.name }, TOLERANCE_M, MIN_AREA_KM2 / 4);
  if (f) features.push(f);
};
for (const w of ways) {
  if (w.nodes[0] !== w.nodes[w.nodes.length - 1]) continue;
  park(w.geometry.map(p => [p.lon, p.lat]), [], w.tags);
}
for (const rel of rels) {
  const inners = relationRings(rel, 'inner');
  for (const outer of relationRings(rel, ['outer', ''])) park(outer, inners.filter(i => pointInRing(i[0], outer)), rel.tags);
}

const json = JSON.stringify({ type: 'FeatureCollection', features });
console.log(`  ${features.length} park polygon(s) ≥ ${MIN_AREA_KM2} km², ${(json.length / 1024).toFixed(0)} KB`);
if (json.length > MAX_BYTES) throw new Error(`output exceeds ${MAX_BYTES / 1024} KB; raise --tolerance or --min-area`);
await writeFile(OUT, json + '\n');
console.log(`wrote ${OUT}`);
