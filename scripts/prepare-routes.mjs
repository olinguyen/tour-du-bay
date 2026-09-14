// Content-preparation tool, not a build step: turns scripts/route-plans.json into src/data/routes.generated.ts
// by asking BRouter for road-following geometry (with terrain elevation) between each segment's via points.
// Node 18+: node scripts/prepare-routes.mjs [--check | segment-id ...]
//   (no args)     request every segment that is missing or whose via points / routing inputs changed, then publish
//   segment-id …  request just those segments again (even if unchanged), reuse the rest, then publish
//   --check       validate the published file against the plan offline; never writes or fetches
import * as fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { isDeepStrictEqual } from 'node:util';

const endpoint = 'https://brouter.de/brouter';
const alternativeIndex = 0;
const FT_PER_M = 3.28084;
/** consecutive parts must meet within this many metres; a route must begin this close to its named start */
const JOIN_M = 30, START_M = 150;

// Options let the regression tests use temporary files, an offline router and no pacing.
export async function prepareRoutes({
  root = new URL('../', import.meta.url),
  args = process.argv.slice(2),
  fetchRoute = fetch,
  pause = delay,
  files = fs,
  log = console,
} = {}) {
  const plans = JSON.parse(await files.readFile(new URL('scripts/route-plans.json', root), 'utf8'));
  const destination = new URL('src/data/routes.generated.ts', root);
  const checkpointPath = new URL('scripts/.route-data-checkpoint.json', root);
  const checkOnly = args.includes('--check');
  const requested = new Set(args.filter(argument => argument !== '--check'));
  if (!isRecord(plans.segments)) throw new Error('Missing segments');
  for (const id of requested) if (!Object.hasOwn(plans.segments, id)) throw new Error(`Unknown segment: ${id}`);
  if (checkOnly && requested.size) throw new Error('--check validates the complete collection');
  if (typeof plans.profile !== 'string' || !plans.profile.trim()) throw new Error('Missing routing profile');
  const inputs = { endpoint, profile: plans.profile, alternativeIndex };
  const vias = Object.fromEntries(Object.keys(plans.segments).map(id => [id, waypoints(plans, id)]));
  validateItineraries(plans);
  for (const [id, plan] of Object.entries(plans.segments)) {
    if (!['core', 'connector'].includes(plan.role)) throw new Error(`${id}: invalid role`);
  }
  const catalog = catalogSlugs(await files.readFile(new URL('src/data/rides.ts', root), 'utf8'));

  const previousText = await readOptional(destination, files);
  if (checkOnly && previousText === null) throw new Error('Missing published route file');
  const previous = previousText === null ? {} : parseBundle(previousText);
  const baseHash = previousText === null ? null : createHash('sha256').update(previousText).digest('hex');
  let checkpoint = { version: 1, baseHash, segments: {} };
  if (!checkOnly) {
    const savedText = await readOptional(checkpointPath, files);
    if (savedText !== null) {
      const saved = JSON.parse(savedText);
      if (saved.version !== 1 || !isRecord(saved.segments)) throw new Error('Invalid route checkpoint');
      if (saved.baseHash === baseHash) checkpoint = saved;
      else log.warn('Ignoring route checkpoint: the published route file has changed');
    }
  }
  // Retained geometry: the published rides' parts, then any checkpointed parts whose routing inputs still match.
  const segments = publishedSegments(previous);
  for (const [id, part] of Object.entries(checkpoint.segments)) {
    if (!Object.hasOwn(vias, id) || !sameInputs(part, inputs, vias[id])) {
      delete checkpoint.segments[id];
      continue;
    }
    validateSegment(id, part);
    segments[id] = part;
  }

  if (!checkOnly) {
    for (const [id, plan] of Object.entries(plans.segments)) {
      const via = vias[id];
      if (requested.size && !requested.has(id)) continue;
      // Without explicit ids, only missing or stale segments are requested; published or checkpointed ones are kept.
      if (!requested.size && segments[id] && sameInputs(segments[id], inputs, via)) continue;
      const url = new URL(inputs.endpoint);
      url.search = new URLSearchParams({ lonlats: via.map(point => point.join(',')).join('|'), profile: inputs.profile, alternativeidx: String(inputs.alternativeIndex), format: 'geojson' });
      const response = await fetchRoute(url, { signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(`${id}: HTTP ${response.status}: ${await response.text()}`);
      const text = await response.text();
      let result;
      try { result = JSON.parse(text); } catch { throw new Error(`${id}: ${text.slice(0, 300)}`); }
      const feature = routeFeature(id, result);
      const properties = feature.properties || {};
      const coordinates = feature.geometry.coordinates;
      if (!Array.isArray(coordinates)) throw new Error(`${id}: at least two geometry points required`);
      // BRouter answers [lon, lat, metres]; the site wants [lat, lng, feet].
      const filled = fillElevation(id, coordinates);
      if (filled) log.warn(`${id}: ${filled} shoreline point${filled === 1 ? '' : 's'} without terrain elevation took the nearest neighbour's`);
      coordinates.forEach((point, i) => validateCoordinate(`${id}: point ${i}`, point, true));
      const part = {
        role: plan.role,
        via,
        inputs,
        coordinates: coordinates.map(([lon, lat, ele]) => [lat, lon, Math.round(ele * FT_PER_M)]),
        distanceMeters: routeMetric(properties['track-length']),
        ascentMeters: routeMetric(properties['filtered ascend']),
        generatedAt: new Date().toISOString(),
      };
      validateSegment(id, part);
      const tags = (properties.messages || []).slice(1).map(message => message[9] || '');
      const unsuitable = tags.filter(tag =>
        /(?:^|\s)(?:highway=(?:motorway|steps)|route=ferry|bicycle=no)(?:\s|$)/.test(tag)
        || (/(?:^|\s)access=private(?:\s|$)/.test(tag) && !/(?:^|\s)bicycle=(?:yes|designated|permissive)(?:\s|$)/.test(tag)));
      if (unsuitable.length) throw new Error(`${id}: review unsuitable ways: ${[...new Set(unsuitable)].join('; ')}`);
      // A via point that snapped to a trail beside the road shows up here; the plan then needs a point on the road itself.
      const soft = (properties.messages || []).slice(1).filter(message => /(?:^|\s)highway=(?:path|footway|track|pedestrian)(?:\s|$)/.test(message[9] || ''));
      const softMeters = soft.reduce((sum, message) => sum + (Number(message[3]) || 0), 0);
      if (softMeters > 100) log.warn(`${id}: ${Math.round(softMeters)} m on paths, footways or tracks; check the via points sit on the road`);
      segments[id] = part;
      checkpoint.segments[id] = part;
      // Only this private checkpoint may be incomplete or have disconnected joins.
      await atomicWrite(checkpointPath, `${JSON.stringify(checkpoint)}\n`, files);
      log.log(`${id}: ${part.coordinates.length} points, ${(part.distanceMeters / 1609.344).toFixed(1)} mi`);
      await pause(1100);
    }
    // Role is editorial metadata; updating it does not change routing provenance.
    for (const [id, plan] of Object.entries(plans.segments)) {
      if (segments[id]) segments[id] = { ...segments[id], role: plan.role };
    }
  }

  const routes = checkOnly ? previous : assemble(plans, segments, previous);
  validateCollection(routes, plans, inputs, vias, catalog, log);
  if (!checkOnly) {
    const text = serialize(routes, plans.profile);
    if (text === previousText) log.log('Nothing changed; the published file is left as it is');
    else await atomicWrite(destination, text, files);
    // Publication has succeeded. A cleanup failure must not report generation failure.
    try { await files.rm(checkpointPath, { force: true }); }
    catch (error) { log.warn(`Published successfully; could not remove checkpoint: ${error.message}`); }
  }
  log.log(`${checkOnly ? 'Validated' : 'Prepared'} ${Object.keys(routes).length} routes in ${fileURLToPath(destination)}`);
  return routes;
}

/** Concatenate each itinerary's parts into one ride; a retained ride keeps its original preparation date. */
function assemble(plans, segments, previous) {
  const routes = {};
  for (const [slug, itinerary] of Object.entries(plans.itineraries)) {
    const parts = itinerary.parts.map(id => {
      if (!segments[id]) throw new Error(`${slug}: missing segment ${id}; finish generating before publishing`);
      return { id, ...segments[id] };
    });
    const source = {
      service: 'BRouter',
      profile: plans.profile,
      prepared: parts.reduce((latest, part) => (part.generatedAt > latest ? part.generatedAt : latest), ''),
      start: itinerary.startId,
      via: parts.flatMap(part => part.via.map(latLng)),
      parts: parts.map(part => ({
        id: part.id, role: part.role, via: part.via.map(latLng), inputs: part.inputs, count: part.coordinates.length,
        distanceMeters: part.distanceMeters, ascentMeters: part.ascentMeters, generatedAt: part.generatedAt,
      })),
    };
    if (itinerary.references) source.references = itinerary.references;
    const points = parts.flatMap(part => part.coordinates);
    const old = previous[slug];
    if (old && isDeepStrictEqual(old.points, points) && isDeepStrictEqual({ ...old.source, prepared: source.prepared }, source)) {
      source.prepared = old.source.prepared;
    }
    routes[slug] = { source, points };
  }
  return routes;
}

/** Recover per-segment geometry from a published file: each part's coordinates are a run of `count` points. */
function publishedSegments(routes) {
  const segments = {};
  for (const route of Object.values(routes)) {
    let offset = 0;
    for (const part of route.source.parts) {
      const { id, count, ...rest } = part;
      // A part with a broken count leaves the position of everything after it unknown; validation names the fault.
      if (!Number.isInteger(count) || count < 0) break;
      segments[id] ??= { ...rest, via: part.via.map(latLng), coordinates: route.points.slice(offset, offset + count) };
      offset += count;
    }
  }
  return segments;
}

function serialize(routes, profile) {
  const lines = Object.entries(routes).map(([slug, route]) => {
    const points = route.points.map(point => JSON.stringify(point)).join(',');
    return `  ${JSON.stringify(slug)}: {\n    "source": ${JSON.stringify(route.source)},\n    "points": [${points}]\n  }`;
  });
  return `// GENERATED by scripts/prepare-routes.mjs — do not edit
// Planned, road-following routes from BRouter (profile "${profile}") over OpenStreetMap ways; elevation is BRouter's
// terrain model, so bridges, tunnels and road cuts follow the ground rather than the road. Regenerate with
// \`npm run routes\` after editing scripts/route-plans.json; \`node scripts/prepare-routes.mjs --check\` validates offline.
export type RoutePoint = [lat: number, lng: number, eleFt: number];
export type RouteVia = [lat: number, lng: number];
export interface RoutePart {
  id: string;
  role: 'core' | 'connector';
  via: RouteVia[];
  inputs: { endpoint: string; profile: string; alternativeIndex: number };
  /** number of consecutive entries of \`points\` this part contributes */
  count: number;
  distanceMeters: number;
  ascentMeters: number;
  generatedAt: string;
}
export interface RouteSource {
  service: string;
  profile: string;
  prepared: string;
  /** id of the named start in scripts/route-plans.json */
  start: string;
  /** every planned via point, in ride order */
  via: RouteVia[];
  parts: RoutePart[];
  references?: string[];
}
export interface GeneratedRoute {
  points: RoutePoint[];
  source: RouteSource;
}

export const ROUTES: Record<string, GeneratedRoute> = {
${lines.join(',\n')}
};
`;
}

async function readOptional(path, files) {
  try { return await files.readFile(path, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/** Read ROUTES back out of the generated module; the literal is plain JSON. */
function parseBundle(text) {
  const match = text.match(/\nexport const ROUTES\s*:[^=]*=\s*(\{[\s\S]*\});\s*$/);
  if (!match) throw new Error('Unreadable published route file: expected an exported ROUTES literal');
  let routes;
  try { routes = JSON.parse(match[1]); }
  catch (error) { throw new Error('Unreadable published route file: invalid literal', { cause: error }); }
  if (!isRecord(routes)) throw new Error('Invalid published route file');
  for (const [slug, route] of Object.entries(routes)) {
    if (!isRecord(route) || !isRecord(route.source) || !Array.isArray(route.source.parts) || !Array.isArray(route.points)
      || !route.source.parts.every(part => isRecord(part) && typeof part.id === 'string' && Array.isArray(part.via))) {
      throw new Error(`${slug}: invalid published route`);
    }
  }
  return routes;
}

async function atomicWrite(destination, text, files) {
  await files.mkdir(new URL('./', destination), { recursive: true });
  const temporary = new URL(`${destination.href}.${randomUUID()}.tmp`);
  try {
    await files.writeFile(temporary, text, { flag: 'wx' });
    await files.rename(temporary, destination);
  } finally {
    try { await files.rm(temporary, { force: true }); } catch { /* Best-effort temporary-file cleanup. */ }
  }
}

function waypoints(plans, id, visiting = new Set()) {
  if (visiting.has(id)) throw new Error(`${id}: cyclic reverseVia`);
  const plan = plans.segments[id];
  if (!plan) throw new Error(`${id}: missing waypoint plan`);
  visiting.add(id);
  if ((plan.via !== undefined) === (plan.reverseVia !== undefined)) throw new Error(`${id}: supply either via or reverseVia`);
  const via = plan.via ?? [...waypoints(plans, plan.reverseVia, visiting)].reverse();
  if (!Array.isArray(via) || via.length < 2) throw new Error(`${id}: at least two waypoints required`);
  via.forEach((point, i) => validateCoordinate(`${id}: waypoint ${i}`, point, false));
  return via;
}

/** ride slugs declared in src/data/rides.ts */
function catalogSlugs(source) {
  const slugs = new Set();
  for (const match of source.matchAll(/^\s*\{?\s*slug:\s*(["'])([a-z0-9-]+)\1/gm)) {
    if (slugs.has(match[2])) throw new Error(`${match[2]}: duplicate ride slug`);
    slugs.add(match[2]);
  }
  return slugs;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function routeFeature(id, result) {
  if (!isRecord(result) || result.type !== 'FeatureCollection' || !Array.isArray(result.features)) {
    throw new Error(`${id}: expected a route FeatureCollection`);
  }
  let route;
  for (const feature of result.features) {
    if (!isRecord(feature) || feature.type !== 'Feature') throw new Error(`${id}: invalid route feature`);
    const type = feature.geometry?.type;
    if (type === 'LineString') {
      if (route) throw new Error(`${id}: expected exactly one route LineString`);
      route = feature;
    } else if (type !== 'Point' && feature.geometry !== null) {
      throw new Error(`${id}: unsupported route geometry: ${type ?? 'missing'}`);
    }
    // Only Point and explicit null geometries may accompany the route as metadata.
    // Reject other shapes instead of silently discarding route parts or diagnostics.
  }
  if (!route) throw new Error(`${id}: expected exactly one route LineString`);
  return route;
}

/** [lon, lat] (plans, BRouter) or [lat, lng, ft] (published) depending on `latLngFirst` */
function validateCoordinate(label, point, elevation, latLngFirst = false) {
  const [x, y] = latLngFirst ? [point?.[1], point?.[0]] : [point?.[0], point?.[1]];
  if (!Array.isArray(point) || point.length !== (elevation ? 3 : 2) || !point.every(Number.isFinite) || Math.abs(x) > 180 || Math.abs(y) > 90) {
    throw new Error(`${label}: invalid coordinates${elevation ? ' or missing elevation' : ''}`);
  }
}

const latLng = ([lon, lat]) => [lat, lon];

/**
 * The terrain model stops at the shoreline, so a beach-lot or pier point arrives as a bare [lon, lat]. Give such a
 * point the elevation of its nearest neighbour that has one (in place), returning how many were filled. A part with
 * no elevation at all, or more than a few percent missing, is rejected rather than guessed.
 */
function fillElevation(id, coordinates) {
  const has = point => Array.isArray(point) && point.length === 3 && Number.isFinite(point[2]);
  const bare = point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);
  const missing = coordinates.map((point, i) => (bare(point) ? i : -1)).filter(i => i >= 0);
  if (!missing.length) return 0;
  if (!coordinates.some(has)) throw new Error(`${id}: missing elevation`);
  if (missing.length > Math.max(2, coordinates.length * 0.05)) throw new Error(`${id}: ${missing.length} points lack elevation; move the via points off the shoreline`);
  for (const i of missing) {
    let j = 1;
    while (!has(coordinates[i - j]) && !has(coordinates[i + j])) j++;
    coordinates[i] = [coordinates[i][0], coordinates[i][1], (has(coordinates[i - j]) ? coordinates[i - j] : coordinates[i + j])[2]];
  }
  return missing.length;
}

function routeMetric(value) {
  return typeof value === 'number' || (typeof value === 'string' && value.trim()) ? Number(value) : NaN;
}

function validateSegment(id, part) {
  if (!Array.isArray(part?.coordinates) || part.coordinates.length < 2) throw new Error(`${id}: at least two geometry points required`);
  part.coordinates.forEach((point, i) => validateCoordinate(`${id}: point ${i}`, point, true, true));
  if (!part.coordinates.some((point, i) => i && distanceMeters(part.coordinates[i - 1], point) > 0)) {
    throw new Error(`${id}: zero-length geometry`);
  }
  for (const metric of ['distanceMeters', 'ascentMeters']) {
    if (!Number.isFinite(part[metric]) || part[metric] < 0) throw new Error(`${id}: invalid ${metric}; expected a finite nonnegative number`);
  }
}

function sameInputs(part, inputs, via) {
  return isDeepStrictEqual(part?.inputs, inputs) && isDeepStrictEqual(part?.via, via);
}

function validateItineraries(data) {
  if (!isRecord(data.starts) || !isRecord(data.itineraries)) throw new Error('Missing starts or itineraries');
  for (const [id, start] of Object.entries(data.starts)) {
    validateCoordinate(`${id}: start`, start?.coordinate, false);
    if (typeof start.name !== 'string' || !start.name.trim()) throw new Error(`${id}: missing start name`);
  }
  for (const [slug, itinerary] of Object.entries(data.itineraries)) {
    if (!Array.isArray(itinerary?.parts) || !itinerary.parts.length) throw new Error(`${slug}: empty or missing itinerary parts`);
    if (!Object.hasOwn(data.starts, itinerary.startId)) throw new Error(`${slug}: missing start ${itinerary.startId}`);
    for (const id of itinerary.parts) {
      if (typeof id !== 'string' || !Object.hasOwn(data.segments, id)) throw new Error(`${slug}: missing segment ${id}`);
    }
    if (itinerary.references !== undefined && !(Array.isArray(itinerary.references) && itinerary.references.every(url => typeof url === 'string'))) {
      throw new Error(`${slug}: references must be a list of URLs`);
    }
  }
}

/** Everything the published file must satisfy: provenance matches the plan, geometry is sound, joins meet, starts are near. */
function validateCollection(routes, plans, inputs, vias, catalog, log) {
  for (const slug of Object.keys(plans.itineraries)) {
    if (!Object.hasOwn(routes, slug)) throw new Error(`${slug}: missing route; finish generating before publishing`);
    if (!catalog.has(slug)) throw new Error(`${slug}: itinerary has no ride in src/data/rides.ts`);
  }
  for (const [slug, route] of Object.entries(routes)) {
    const itinerary = plans.itineraries[slug];
    if (!itinerary) throw new Error(`${slug}: route has no itinerary; remove it from the published file`);
    const { source } = route;
    if (source.start !== itinerary.startId) throw new Error(`${slug}: start differs from the plan`);
    if (!isDeepStrictEqual(source.references, itinerary.references)) throw new Error(`${slug}: references differ from the plan`);
    if (!isDeepStrictEqual(source.parts.map(part => part.id), itinerary.parts)) throw new Error(`${slug}: parts differ from the plan; regenerate`);
    if (!isDeepStrictEqual(source.via, source.parts.flatMap(part => part.via))) throw new Error(`${slug}: via list does not match its parts`);
    if (typeof source.prepared !== 'string' || !source.prepared) throw new Error(`${slug}: missing preparation date`);
    let offset = 0, previous = null;
    for (const part of source.parts) {
      const count = Number.isInteger(part.count) && part.count >= 0 ? part.count : 0;
      const coordinates = route.points.slice(offset, offset + count);
      offset += count;
      validateSegment(part.id, { ...part, coordinates });
      if (!Object.hasOwn(plans.segments, part.id)) throw new Error(`${part.id}: segment has no plan; regenerate ${slug}`);
      if (!sameInputs({ ...part, via: part.via.map(latLng) }, inputs, vias[part.id])) throw new Error(`${part.id}: stale geometry (waypoints or routing inputs); regenerate this part`);
      if (part.role !== plans.segments[part.id].role) throw new Error(`${part.id}: role differs from the plan`);
      if (previous && distanceMeters(previous.coordinates.at(-1), coordinates[0]) > JOIN_M) throw new Error(`${slug}: disconnected parts ${previous.id} / ${part.id}`);
      previous = { id: part.id, coordinates };
    }
    if (offset !== route.points.length) throw new Error(`${slug}: part counts do not cover the published points`);
    if (source.service !== 'BRouter' || source.profile !== inputs.profile) throw new Error(`${slug}: source differs from routing inputs`);
    if (distanceMeters(latLng(plans.starts[itinerary.startId].coordinate), route.points[0]) > START_M) throw new Error(`${slug}: route starts too far from its named start`);
  }
  for (const slug of catalog) {
    if (!Object.hasOwn(routes, slug)) throw new Error(`${slug}: ride has no planned route; add an itinerary to scripts/route-plans.json`);
  }
}

/** metres between two [lat, lng(, …)] points */
function distanceMeters(a, b) {
  const radians = Math.PI / 180;
  const latitude = (a[0] + b[0]) / 2 * radians;
  return Math.hypot((b[1] - a[1]) * Math.cos(latitude), b[0] - a[0]) * 111320;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) await prepareRoutes();
