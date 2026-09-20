// Offline regression checks for prepare-routes.mjs: temporary directories, a mocked router and injected
// filesystem failures. Run with `npm run test:routes` (Node 18+). No live routing requests are made.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { doublesBack, prepareRoutes, serializeModule } from './prepare-routes.mjs';
import { FT_PER_M } from '../src/lib/units.mjs';

const root = new URL('../', import.meta.url);
const noFetch = async () => { throw new Error('Unexpected routing request'); };
const noWrite = async () => { throw new Error('Unexpected filesystem write'); };
const quiet = { log() {}, warn() {} };
const inputs = { endpoint: 'https://brouter.de/brouter', profile: 'fastbike', alternativeIndex: 0 };
const latLng = ([lon, lat]) => [lat, lon];

const parse = text => JSON.parse(text);

/** what BRouter would answer for a part whose coordinates are stored as [lat, lng, ft] */
function response(part, properties = {}) {
  const coordinates = (part.coordinates || []).map(point =>
    Array.isArray(point) && point.length === 3 && point.every(Number.isFinite) ? [point[1], point[0], point[2] / FT_PER_M] : point);
  return new Response(JSON.stringify({ type: 'FeatureCollection', features: [{
    type: 'Feature',
    geometry: { type: 'LineString', coordinates },
    properties: { 'track-length': part.distanceMeters, 'filtered ascend': part.ascentMeters, ...properties },
  }] }));
}

function catalogSource(slugs = ['test-ride']) {
  return `export const RIDE_INPUTS = [\n${slugs.map(slug => `  { slug: "${slug}", name: "Ride",\n    miles: 1 },\n`).join('')}];\n`;
}

/** assemble published routes from segments the way the script does */
function publish(plans, segments) {
  const routes = {};
  for (const [slug, itinerary] of Object.entries(plans.itineraries)) {
    const parts = itinerary.parts.map(id => ({ id, ...segments[id] }));
    routes[slug] = {
      source: {
        service: 'BRouter', profile: plans.profile, prepared: '2026-01-01T00:00:00.000Z', start: itinerary.startId,
        via: parts.flatMap(part => part.via.map(latLng)),
        parts: parts.map(part => ({
          id: part.id, role: part.role, via: part.via.map(latLng), inputs: part.inputs, count: part.coordinates?.length,
          distanceMeters: part.distanceMeters, ascentMeters: part.ascentMeters, generatedAt: part.generatedAt,
        })),
        ...(itinerary.references ? { references: itinerary.references } : {}),
      },
      points: parts.flatMap(part => part.coordinates || []),
    };
  }
  return routes;
}

async function fixture(t) {
  const directory = await fs.mkdtemp(join(tmpdir(), 'tour-du-bay-routes-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = pathToFileURL(`${directory}/`);
  const destination = new URL('scripts/route-data.json', root);
  const modulePath = new URL('src/data/routes.generated.ts', root);
  const checkpoint = new URL('scripts/.route-data-checkpoint.json', root);
  const via = [[-122, 37], [-122.002, 37.002]];
  const plans = {
    profile: 'fastbike',
    starts: { station: { name: 'Station', coordinate: via[0] } },
    segments: { out: { role: 'core', via }, back: { role: 'connector', reverseVia: 'out' } },
    itineraries: { 'test-ride': { startId: 'station', parts: ['out', 'back'], references: ['https://example.test/ride'] } },
  };
  const part = {
    role: 'core', via, inputs: { ...inputs }, coordinates: [[37, -122, 33], [37.001, -122.001, 66], [37.002, -122.002, 98]],
    distanceMeters: 300, ascentMeters: 20, generatedAt: '2026-01-01T00:00:00.000Z',
  };
  const segments = {
    out: part,
    back: { ...structuredClone(part), role: 'connector', via: [...via].reverse(), coordinates: [...part.coordinates].reverse() },
  };
  const savePlans = () => fs.writeFile(new URL('scripts/route-plans.json', root), JSON.stringify(plans));
  // Both files together, the way a published pair looks. Fixtures that break the geometry on purpose have no
  // valid module to write; --check reaches the geometry long before it compares the two files.
  const saveData = async () => {
    const routes = publish(plans, segments);
    await fs.writeFile(destination, JSON.stringify(routes));
    let text = '';
    try { text = serializeModule(routes, plans.profile); } catch { return; }
    await fs.writeFile(modulePath, text);
  };
  const saveCatalog = slugs => fs.writeFile(new URL('src/data/rides.ts', root), catalogSource(slugs));
  await Promise.all([fs.mkdir(new URL('scripts/', root)), fs.mkdir(new URL('src/data/', root), { recursive: true })]);
  await Promise.all([savePlans(), saveData(), saveCatalog()]);
  return {
    root, destination, modulePath, checkpoint, plans, segments, savePlans, saveData, saveCatalog,
    read: () => fs.readFile(destination, 'utf8'),
    readModule: () => fs.readFile(modulePath, 'utf8'),
    run: (options = {}) => prepareRoutes({ root, args: ['--check'], fetchRoute: noFetch, pause: async () => {}, log: quiet, ...options }),
  };
}

test('the checked-in route files validate against the plan and catalog without writes or fetches', async () => {
  const destination = new URL('scripts/route-data.json', root);
  const modulePath = new URL('src/data/routes.generated.ts', root);
  const [before, beforeModule] = await Promise.all([fs.readFile(destination, 'utf8'), fs.readFile(modulePath, 'utf8')]);
  const routes = await prepareRoutes({
    root, args: ['--check'], fetchRoute: noFetch, log: quiet,
    files: { ...fs, mkdir: noWrite, writeFile: noWrite, rename: noWrite, rm: noWrite },
  });
  assert.equal(await fs.readFile(destination, 'utf8'), before);
  assert.equal(await fs.readFile(modulePath, 'utf8'), beforeModule);
  assert.match(beforeModule, /^\/\/ GENERATED by scripts\/prepare-routes\.mjs — do not edit\n/);
  assert.ok(Object.keys(routes).length >= 8);
  for (const route of Object.values(routes)) {
    assert.ok(route.points.length > 200);
    assert.ok(route.points.every(([lat, lng, ft]) => lat > 36 && lat < 39 && lng < -121 && lng > -123.5 && Number.isInteger(ft)));
  }
});

const malformed = [
  ['null interior point', part => { part.coordinates[1] = null; }, /invalid coordinates/],
  ['non-array point', part => { part.coordinates[1] = {}; }, /invalid coordinates/],
  ['nonfinite elevation', part => { part.coordinates[1][2] = Infinity; }, /invalid coordinates/],
  ['string ordinate', part => { part.coordinates[1][1] = '-122.001'; }, /invalid coordinates/],
  ['latitude out of bounds', part => { part.coordinates[1][0] = 999; }, /invalid coordinates/],
  ['longitude out of bounds', part => { part.coordinates[1][1] = -181; }, /invalid coordinates/],
  ['extra ordinate', part => { part.coordinates[1].push(1); }, /invalid coordinates/],
  ['missing coordinates', part => { delete part.coordinates; }, /two geometry points/],
  ['short segment', part => { part.coordinates = [part.coordinates[0]]; }, /two geometry points/],
  ['zero-length segment', part => { part.coordinates = [part.coordinates[0], part.coordinates[0]]; }, /zero-length/],
  ['negative distance', part => { part.distanceMeters = -1; }, /invalid distanceMeters/],
  ['nonfinite distance', part => { part.distanceMeters = Infinity; }, /invalid distanceMeters/],
  ['negative ascent', part => { part.ascentMeters = -1; }, /invalid ascentMeters/],
  ['missing ascent', part => { delete part.ascentMeters; }, /invalid ascentMeters/],
];

test('checking and generation reject the same malformed geometry and metrics', async t => {
  for (const [name, mutate, error] of malformed) {
    await t.test(name, async t => {
      const f = await fixture(t);
      const broken = structuredClone(f.segments.out);
      mutate(broken);
      f.segments.out = broken;
      await f.saveData();
      const before = await f.read();
      await assert.rejects(f.run(), error);
      await assert.rejects(f.run({ args: ['out'], fetchRoute: async () => response(broken) }), error);
      assert.equal(await f.read(), before);
      await assert.rejects(fs.readFile(f.checkpoint), { code: 'ENOENT' });
    });
  }
});

test('a shoreline point without elevation takes its nearest neighbour’s; a part without any is rejected', async t => {
  const feature = coordinates => new Response(JSON.stringify({ type: 'FeatureCollection', features: [{
    type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: { 'track-length': 300, 'filtered ascend': 20 },
  }] }));
  const f = await fixture(t);
  const warnings = [];
  await f.run({ args: ['out'], log: { log() {}, warn: message => warnings.push(message) },
    fetchRoute: async () => feature([[-122, 37, 10], [-122.001, 37.001], [-122.002, 37.002, 30]]) });
  assert.deepEqual(parse(await f.read())['test-ride'].points.slice(0, 3), [[37, -122, 33], [37.001, -122.001, 33], [37.002, -122.002, 98]]);
  assert.deepEqual(warnings, ['out: 1 shoreline point without terrain elevation took the nearest neighbour\'s']);
  const g = await fixture(t);
  await g.run({ args: ['out'], fetchRoute: async () => feature([[-122, 37], [-122.001, 37.001, 20], [-122.002, 37.002]]) });
  assert.deepEqual(parse(await g.read())['test-ride'].points.slice(0, 3).map(point => point[2]), [66, 66, 66]);
  // A published two-element point is still malformed: filling happens only on the way in from the router.
  const h = await fixture(t);
  h.segments.out.coordinates[1] = [37.001, -122.001];
  await h.saveData();
  await assert.rejects(h.run(), /missing elevation/);
  await assert.rejects(f.run({ args: ['out'], fetchRoute: async () => feature([[-122, 37], [-122.001, 37.001], [-122.002, 37.002]]) }), /out: missing elevation/);
  const many = Array.from({ length: 100 }, (_, i) => [-122 - i / 1000, 37 + i / 1000, i < 90 ? 10 : undefined].slice(0, i < 90 ? 3 : 2));
  await assert.rejects(f.run({ args: ['out'], fetchRoute: async () => feature(many) }), /out: 10 points lack elevation/);
});

test('router metric coercion accepts numeric strings but rejects absent, blank, and boolean values', async t => {
  for (const value of [null, '', ' ', false]) {
    const f = await fixture(t);
    await assert.rejects(f.run({ args: ['out'], fetchRoute: async () => response(f.segments.out, { 'filtered ascend': value }) }), /invalid ascentMeters/);
  }
  const f = await fixture(t);
  await f.run({ args: ['out'], fetchRoute: async () => response(f.segments.out, { 'track-length': '300', 'filtered ascend': '0' }) });
  assert.equal(parse(await f.read())['test-ride'].source.parts[0].ascentMeters, 0);
});

test('points are published as [lat, lng, whole feet] from the router’s [lon, lat, metres]', async t => {
  const f = await fixture(t);
  const metres = [[-122, 37, 10], [-122.001, 37.001, 20.4], [-122.002, 37.002, 30]];
  await f.run({ args: ['out'], fetchRoute: async () => new Response(JSON.stringify({ type: 'FeatureCollection', features: [{
    type: 'Feature', geometry: { type: 'LineString', coordinates: metres }, properties: { 'track-length': 300, 'filtered ascend': 20 },
  }] })) });
  const module = await f.readModule();
  assert.match(module, /^\/\/ GENERATED by scripts\/prepare-routes\.mjs — do not edit\n/);
  assert.match(module, /\nexport const PARTS: Record<string, EncodedRoute> = \{\n  "out": \{ "span": [\d.]+, "coords": \[[-\d,]+\], "cum": \[[-\d,]+\], "ele": \[[-\d,]+\] \},\n  "back": /);
  assert.match(module, /\nexport const ROUTES: Record<string, Itinerary> = \{\n  "test-ride": \{ "parts": \["out","back"\] \}\n\};\n$/);
  const published = parse(await f.read())['test-ride'];
  assert.deepEqual(published.points.slice(0, 3), [[37, -122, 33], [37.001, -122.001, 67], [37.002, -122.002, 98]]);
  assert.deepEqual(published.source.via, [[37, -122], [37.002, -122.002], [37.002, -122.002], [37, -122]]);
  assert.deepEqual(published.source.parts.map(part => part.count), [3, 3]);
  assert.deepEqual(published.source.references, ['https://example.test/ride']);
  assert.equal(published.source.start, 'station');
  await f.run();
});

test('additional route geometries and their diagnostics cannot be silently discarded', async t => {
  for (const [type, geometry, error] of [
    ['LineString', coordinates => ({ type: 'LineString', coordinates }), /out: expected exactly one route LineString/],
    ['MultiLineString', coordinates => ({ type: 'MultiLineString', coordinates: [coordinates] }), /out: unsupported route geometry: MultiLineString/],
    ['GeometryCollection', coordinates => ({ type: 'GeometryCollection', geometries: [{ type: 'LineString', coordinates }] }), /out: unsupported route geometry: GeometryCollection/],
  ]) {
    await t.test(type, async t => {
      const f = await fixture(t);
      const before = await f.read();
      const result = await response(f.segments.out).json();
      const extra = structuredClone(result.features[0]);
      extra.geometry = geometry((await response(f.segments.back).json()).features[0].geometry.coordinates);
      extra.properties.messages = [[], [...Array(9).fill(''), 'bicycle=no']];
      result.features.push(extra);
      await assert.rejects(f.run({ args: ['out'], fetchRoute: async () => new Response(JSON.stringify(result)) }), error);
      assert.equal(await f.read(), before);
      await assert.rejects(fs.readFile(f.checkpoint), { code: 'ENOENT' });
    });
  }
});

test('unsuitable ways in the router’s messages block publication', async t => {
  for (const [tag, ok] of [['highway=motorway', false], ['highway=steps', false], ['route=ferry', false], ['bicycle=no', false],
    ['access=private', false], ['access=private bicycle=yes', true], ['highway=residential', true]]) {
    await t.test(tag, async t => {
      const f = await fixture(t);
      const run = f.run({ args: ['out'], fetchRoute: async () => response(f.segments.out, { messages: [['header'], [...Array(9).fill(''), tag]] }) });
      if (ok) await run;
      else await assert.rejects(run, /out: review unsuitable ways/);
    });
  }
});

test('unexpected router response shapes fail before publication', async t => {
  for (const [name, mutate, error] of [
    ['null response', () => null, /out: expected a route FeatureCollection/],
    ['wrong collection type', result => ({ ...result, type: 'Feature' }), /out: expected a route FeatureCollection/],
    ['non-array features', result => ({ ...result, features: {} }), /out: expected a route FeatureCollection/],
    ['invalid feature after route', result => ({ ...result, features: [...result.features, null] }), /out: invalid route feature/],
    ['missing feature type', result => ({ ...result, features: [{ ...result.features[0], type: undefined }] }), /out: invalid route feature/],
    ['missing geometry after route', result => ({ ...result, features: [...result.features, { type: 'Feature' }] }), /out: unsupported route geometry: missing/],
    ['no route', result => ({ ...result, features: [{ type: 'Feature', geometry: null, properties: {} }] }), /out: expected exactly one route LineString/],
  ]) {
    await t.test(name, async t => {
      const f = await fixture(t);
      const before = await f.read();
      const result = mutate(await response(f.segments.out).json());
      await assert.rejects(f.run({ args: ['out'], fetchRoute: async () => new Response(JSON.stringify(result)) }), error);
      assert.equal(await f.read(), before);
      await assert.rejects(fs.readFile(f.checkpoint), { code: 'ENOENT' });
    });
  }
  const f = await fixture(t);
  await assert.rejects(f.run({ args: ['out'], fetchRoute: async () => new Response('busy', { status: 503 }) }), /out: HTTP 503: busy/);
  await assert.rejects(f.run({ args: ['out'], fetchRoute: async () => new Response('<html>Service unavailable</html>') }), /out: <html>Service unavailable/);
});

test('a single route is accepted with or without point and null-geometry metadata', async t => {
  for (const metadata of [false, true]) {
    await t.test(metadata ? 'with metadata' : 'route only', async t => {
      const f = await fixture(t);
      const part = f.segments.out;
      const result = await response(part).json();
      if (metadata) {
        result.features.unshift({ type: 'Feature', geometry: { type: 'Point', coordinates: part.via[0] }, properties: { name: 'Start' } });
        result.features.push({ type: 'Feature', geometry: null, properties: { note: 'Router metadata' } });
      }
      await f.run({ args: ['out'], fetchRoute: async () => new Response(JSON.stringify(result)) });
      const published = parse(await f.read())['test-ride'];
      assert.deepEqual(published.points.slice(0, 3), part.coordinates);
      assert.equal(published.source.parts[0].distanceMeters, part.distanceMeters);
      assert.equal(published.source.parts[0].ascentMeters, part.ascentMeters);
      await f.run();
    });
  }
});

test('failed writes and renames preserve the published file and existing checkpoint', async t => {
  for (const target of ['checkpoint', 'published']) {
    for (const operation of ['write', 'rename']) {
      await t.test(`${target} ${operation}`, async t => {
        const f = await fixture(t);
        const before = await f.read();
        // A request succeeds and is checkpointed, then the pacing pause fails: an interrupted run with a checkpoint.
        await assert.rejects(f.run({ args: ['out'], fetchRoute: async () => response(f.segments.out), pause: async () => { throw new Error('Interrupted'); } }), /Interrupted/);
        const savedCheckpoint = await fs.readFile(f.checkpoint, 'utf8');
        const matches = path => path.href.includes(target === 'checkpoint' ? '.route-data-checkpoint.json' : 'route-data.json.');
        const files = {
          ...fs,
          writeFile: async (path, text, options) => {
            if (operation === 'write' && matches(path)) {
              await fs.writeFile(path, text.slice(0, 30), options);
              throw new Error('Injected partial write failure');
            }
            return fs.writeFile(path, text, options);
          },
          rename: async (from, to) => {
            if (operation === 'rename' && matches(from)) throw new Error('Injected rename failure');
            return fs.rename(from, to);
          },
        };
        await assert.rejects(f.run({ args: ['out'], fetchRoute: async () => response(f.segments.out), files }), /Injected/);
        assert.equal(await f.read(), before);
        if (target === 'checkpoint') assert.equal(await fs.readFile(f.checkpoint, 'utf8'), savedCheckpoint);
        for (const directory of ['scripts/', 'src/data/']) {
          assert.ok(!(await fs.readdir(new URL(directory, f.root))).some(name => name.endsWith('.tmp')));
        }
      });
    }
  }
});

test('disconnected joins and distant starts cannot be published', async t => {
  for (const [name, mutate, error] of [
    ['join', part => { part.coordinates[2] = [38, -123, 30]; }, /disconnected parts out \/ back/],
    ['start', part => { part.coordinates[0] = [38, -123, 10]; }, /too far from its named start/],
  ]) {
    await t.test(name, async t => {
      const f = await fixture(t);
      const before = await f.read();
      const broken = structuredClone(f.segments.out);
      mutate(broken);
      await assert.rejects(f.run({ args: ['out'], fetchRoute: async () => response(broken) }), error);
      assert.equal(await f.read(), before);
      assert.ok(JSON.parse(await fs.readFile(f.checkpoint, 'utf8')).segments.out);
      await f.run(); // --check ignores the disconnected unpublished checkpoint.
    });
  }
});

test('an incomplete initial run resumes from its separate checkpoint', async t => {
  const f = await fixture(t);
  await fs.rm(f.destination);
  await assert.rejects(f.run(), /Missing published/);
  await assert.rejects(f.run({ args: ['out'], fetchRoute: async () => response(f.segments.out) }), /missing segment back/);
  await assert.rejects(fs.readFile(f.destination), { code: 'ENOENT' });
  let calls = 0;
  await f.run({ args: [], fetchRoute: async url => {
    calls++;
    assert.equal(url.searchParams.get('lonlats'), f.segments.back.via.map(point => point.join(',')).join('|'));
    assert.equal(url.searchParams.get('profile'), 'fastbike');
    assert.equal(url.searchParams.get('format'), 'geojson');
    return response(f.segments.back);
  } });
  assert.equal(calls, 1);
  const published = parse(await f.read())['test-ride'];
  assert.deepEqual(published.source.parts.map(part => part.inputs), [inputs, inputs]);
  assert.equal(published.points.length, 6);
  await assert.rejects(fs.readFile(f.checkpoint), { code: 'ENOENT' });
  await f.run();
});

test('the page\u2019s copy must match the data it was derived from', async t => {
  const f = await fixture(t);
  const before = await f.readModule();
  await fs.rm(f.modulePath);
  await assert.rejects(f.run(), /Missing published route module/);
  // A published pair that drifted apart is republished from the data, without asking the router anything.
  await fs.writeFile(f.modulePath, before.replace(/"span": [\d.]+/, '"span": 9'));
  await assert.rejects(f.run(), /does not match scripts\/route-data\.json/);
  await f.run({ args: [] });
  assert.equal(await f.readModule(), before);
  await f.run();
});

test('unreadable published data is never treated as a missing file', async t => {
  const f = await fixture(t);
  for (const text of ['garbage', '{"test-ride": }', JSON.stringify({ 'test-ride': { source: {}, points: [] } })]) {
    await fs.writeFile(f.destination, text);
    await assert.rejects(f.run({ args: ['out'] }), /published route/);
    assert.equal(await f.read(), text);
  }
  await f.saveData();
  const before = await f.read();
  await assert.rejects(f.run({ args: ['out'], files: { ...fs, readFile: async (path, ...args) => {
    if (path.href === f.destination.href) throw Object.assign(new Error('Cannot read published file'), { code: 'EACCES' });
    return fs.readFile(path, ...args);
  } } }), { code: 'EACCES' });
  assert.equal(await f.read(), before);
});

test('a changed published file invalidates an old checkpoint', async t => {
  const f = await fixture(t);
  await fs.rm(f.destination);
  const replacement = structuredClone(f.segments.out);
  replacement.coordinates[1][2] = 99;
  let calls = 0;
  await assert.rejects(f.run({ args: [], fetchRoute: async () => {
    if (calls++) throw new Error('Interrupted');
    return response(replacement);
  } }), /Interrupted/);
  assert.equal(JSON.parse(await fs.readFile(f.checkpoint, 'utf8')).baseHash, null);
  await f.saveData();
  await f.run({ args: ['back'], fetchRoute: async () => response(f.segments.back) });
  assert.deepEqual(parse(await f.read())['test-ride'].points.slice(0, 3), f.segments.out.coordinates);
});

test('a run without ids requests only missing or stale segments; ids force a request', async t => {
  const f = await fixture(t);
  const before = parse(await f.read());
  await f.run({ args: [] });
  assert.deepEqual(parse(await f.read()), before);
  const written = await f.read();
  await f.run({ args: [] });
  assert.equal(await f.read(), written);
  f.plans.segments.spur = { role: 'core', via: [[-122.002, 37.002], [-122.003, 37.003]] };
  f.plans.itineraries['test-ride'].parts = ['out', 'spur'];
  await f.savePlans();
  const spur = { ...f.segments.out, via: f.plans.segments.spur.via, coordinates: [[37.002, -122.002, 98], [37.003, -122.003, 131]] };
  const requested = [];
  await f.run({ args: [], fetchRoute: async url => {
    requested.push(url.searchParams.get('lonlats'));
    return response(spur);
  } });
  assert.deepEqual(requested, ['-122.002,37.002|-122.003,37.003']);
  const published = parse(await f.read())['test-ride'];
  assert.deepEqual(published.source.parts.map(part => part.id), ['out', 'spur']);
  assert.deepEqual(published.points.slice(3), spur.coordinates);
  assert.equal(published.source.parts[0].generatedAt, f.segments.out.generatedAt);
  requested.length = 0;
  await f.run({ args: ['out'], fetchRoute: async url => {
    requested.push(url.searchParams.get('lonlats'));
    return response(f.segments.out);
  } });
  assert.deepEqual(requested, ['-122,37|-122.002,37.002']);
});

test('time spent on paths, footways or tracks is reported but not fatal', async t => {
  for (const [meters, expected] of [[80, []], [150, ['out: 150 m on paths, footways or tracks; check the via points sit on the road']]]) {
    const f = await fixture(t);
    const warnings = [];
    const messages = [['header'], [...Array(3).fill(''), String(meters / 2), ...Array(5).fill(''), 'highway=path surface=dirt'],
      [...Array(3).fill(''), String(meters / 2), ...Array(5).fill(''), 'highway=footway'], [...Array(3).fill(''), '5000', ...Array(5).fill(''), 'highway=residential']];
    await f.run({ args: ['out'], log: { log() {}, warn: message => warnings.push(message) }, fetchRoute: async () => response(f.segments.out, { messages }) });
    assert.deepEqual(warnings, expected);
  }
});

test('a part that rides out to a via point and back the same way is reported but not fatal', async t => {
  // 37.001 to a via 0.002 degrees of longitude (about 178 m) off the route, and back through the same vertices
  const spur = [[37, -122, 33], [37.001, -122.001, 66], [37.001, -122.002, 66], [37.001, -122.003, 66], [37.001, -122.002, 66], [37.001, -122.001, 66], [37.002, -122.002, 98]];
  assert.equal(doublesBack([[37, -122, 33], [37.001, -122.001, 66], [37.002, -122.002, 98]]), null);
  // a loop closes on its start without retracing anything
  assert.equal(doublesBack([[37, -122, 0], [37.002, -122, 0], [37.002, -122.002, 0], [37, -122.002, 0], [37, -122, 0]]), null);
  assert.equal(Math.round(doublesBack(spur).meters), 356);

  const f = await fixture(t);
  const warnings = [];
  await f.run({ args: ['out'], log: { log() {}, warn: message => warnings.push(message) }, fetchRoute: async () => response({ ...f.segments.out, coordinates: spur }) });
  assert.deepEqual(warnings, ['out: rides 356 m out and back from 37.00100,-122.00100; check the via point there sits on the route']);
});

test('retained rides keep their preparation date; regenerated ones take the newest part', async t => {
  const f = await fixture(t);
  const before = parse(await f.read())['test-ride'].source.prepared;
  await f.run({ args: ['out'], fetchRoute: async () => response(f.segments.out) });
  const after = parse(await f.read())['test-ride'];
  assert.notEqual(after.source.prepared, before);
  assert.equal(after.source.prepared, after.source.parts[0].generatedAt);
  assert.equal(after.source.parts[1].generatedAt, f.segments.back.generatedAt);
});

test('profile drift fails checking and partial generation, then resumes without mislabeling retained geometry', async t => {
  const f = await fixture(t);
  const before = await f.read();
  f.plans.profile = 'trekking';
  await f.savePlans();
  await assert.rejects(f.run(), /out: stale geometry/);
  await assert.rejects(f.run({ args: ['out'], fetchRoute: async url => {
    assert.equal(url.searchParams.get('profile'), 'trekking');
    return response(f.segments.out);
  } }), /back: stale geometry/);
  assert.equal(await f.read(), before);
  const saved = JSON.parse(await fs.readFile(f.checkpoint, 'utf8'));
  assert.equal(saved.segments.out.inputs.profile, 'trekking');
  await f.run({ args: ['back'], fetchRoute: async () => response(f.segments.back) });
  const published = parse(await f.read())['test-ride'];
  assert.equal(published.source.profile, 'trekking');
  assert.ok(published.source.parts.every(part => part.inputs.profile === 'trekking'));
  await f.run();
});

test('published parts require their saved routing inputs and consistent source attribution', async t => {
  for (const [name, mutate, error] of [
    ['missing inputs', part => { delete part.inputs; }, /stale geometry/],
    ['changed endpoint', part => { part.inputs.endpoint += '/other'; }, /stale geometry/],
    ['changed alternative', part => { part.inputs.alternativeIndex = 1; }, /stale geometry/],
    ['changed profile', part => { part.inputs.profile = 'trekking'; }, /stale geometry/],
  ]) {
    await t.test(name, async t => {
      const f = await fixture(t);
      mutate(f.segments.out);
      await f.saveData();
      await assert.rejects(f.run(), error);
    });
  }
  for (const [name, mutate, error] of [
    ['profile', route => { route.source.profile = 'trekking'; }, /source differs/],
    ['service', route => { route.source.service = 'Other'; }, /source differs/],
    ['start', route => { route.source.start = 'elsewhere'; }, /start differs/],
    ['references', route => { route.source.references = []; }, /references differ/],
    ['via', route => { route.source.via.pop(); }, /via list does not match/],
    ['prepared', route => { delete route.source.prepared; }, /missing preparation date/],
    ['parts', route => { route.source.parts.reverse(); }, /parts differ from the plan/],
  ]) {
    await t.test(`published ${name}`, async t => {
      const f = await fixture(t);
      const routes = publish(f.plans, f.segments);
      mutate(routes['test-ride']);
      await fs.writeFile(f.destination, JSON.stringify(routes));
      await assert.rejects(f.run(), error);
    });
  }
});

test('reverseVia drift is stale even after regenerating the forward part', async t => {
  const f = await fixture(t);
  const before = await f.read();
  f.plans.segments.out.via.splice(1, 0, [-122.001, 37.001]);
  await f.savePlans();
  await assert.rejects(f.run(), /out: stale geometry/);
  await assert.rejects(f.run({ args: ['out'], fetchRoute: async () => response(f.segments.out) }), /back: stale geometry/);
  assert.equal(await f.read(), before);
});

test('roles are checked separately and synchronized without changing retained inputs, coordinates, or dates', async t => {
  const f = await fixture(t);
  f.plans.segments.back.role = 'core';
  await f.savePlans();
  await assert.rejects(f.run(), /back: role differs/);
  await f.run({ args: ['out'], fetchRoute: async () => response(f.segments.out) });
  const published = parse(await f.read())['test-ride'];
  const { coordinates, ...back } = f.segments.back;
  assert.deepEqual(published.source.parts[1], { id: 'back', ...back, via: back.via.map(latLng), role: 'core', count: 3 });
  assert.deepEqual(published.points.slice(3), coordinates);
  await f.run();
});

test('plans must reference known segments, starts and roles, and every itinerary needs a catalog ride', async t => {
  for (const [name, mutate, error] of [
    ['unknown part', plans => { plans.itineraries['test-ride'].parts.push('elsewhere'); }, /test-ride: missing segment elsewhere/],
    ['unknown start', plans => { plans.itineraries['test-ride'].startId = 'nowhere'; }, /test-ride: missing start nowhere/],
    ['empty parts', plans => { plans.itineraries['test-ride'].parts = []; }, /empty or missing itinerary parts/],
    ['bad role', plans => { plans.segments.out.role = 'detour'; }, /out: invalid role/],
    ['via and reverseVia', plans => { plans.segments.out.reverseVia = 'back'; }, /out: supply either via or reverseVia/],
    ['cyclic reverseVia', plans => { plans.segments.out = { role: 'core', reverseVia: 'back' }; }, /cyclic reverseVia/],
    ['one waypoint', plans => { plans.segments.out.via = [[-122, 37]]; }, /out: at least two waypoints/],
    ['bad references', plans => { plans.itineraries['test-ride'].references = 'https://example.test'; }, /references must be a list/],
    ['no profile', plans => { delete plans.profile; }, /Missing routing profile/],
    ['no start name', plans => { plans.starts.station.name = ' '; }, /station: missing start name/],
  ]) {
    await t.test(name, async t => {
      const f = await fixture(t);
      mutate(f.plans);
      await f.savePlans();
      await assert.rejects(f.run(), error);
      await assert.rejects(f.run({ args: ['out'], fetchRoute: async () => response(f.segments.out) }), error);
    });
  }
  const f = await fixture(t);
  await assert.rejects(f.run({ args: ['elsewhere'] }), /Unknown segment: elsewhere/);
  await assert.rejects(f.run({ args: ['--check', 'out'] }), /--check validates the complete collection/);
  await f.saveCatalog(['other-ride']);
  await assert.rejects(f.run(), /test-ride: itinerary has no ride in src\/data\/rides.ts/);
  await f.saveCatalog(['test-ride', 'test-ride']);
  await assert.rejects(f.run(), /test-ride: duplicate ride slug/);
  await f.saveCatalog(['test-ride', 'unplanned-ride']);
  await assert.rejects(f.run(), /unplanned-ride: ride has no planned route/);
});

test('renaming an itinerary in both plan and published file still requires a matching catalog ride', async t => {
  const f = await fixture(t);
  f.plans.itineraries.renamed = f.plans.itineraries['test-ride'];
  delete f.plans.itineraries['test-ride'];
  await Promise.all([f.saveData(), f.savePlans()]);
  const before = await f.read();
  await assert.rejects(f.run(), /renamed: itinerary has no ride/);
  await assert.rejects(f.run({ args: ['out'], fetchRoute: async () => response(f.segments.out) }), /renamed: itinerary has no ride/);
  assert.equal(await f.read(), before);
  await f.saveCatalog(['renamed']);
  await f.run();
  const routes = publish(f.plans, f.segments);
  routes.extra = routes.renamed;
  await fs.writeFile(f.destination, JSON.stringify(routes));
  await assert.rejects(f.run(), /extra: route has no itinerary/);
});

test('a transit itinerary is published beside the ride, shares its parts, and must ride every part of the ride', async t => {
  const f = await fixture(t);
  const via = [[-122.003, 37.003], [-122.002, 37.002]];
  f.plans.starts.town = { name: 'Town', coordinate: via[0] };
  f.plans.segments.approach = { role: 'connector', via };
  f.plans.segments.leave = { role: 'connector', reverseVia: 'approach' };
  f.plans.itineraries['test-ride'].transit = { startId: 'town', parts: ['approach', 'back', 'out', 'leave'] };
  await f.savePlans();
  await assert.rejects(f.run(), /transit itinerary differs from the plan/);
  const approach = { ...structuredClone(f.segments.out), role: 'connector', via, coordinates: [[37.003, -122.003, 10], [37.002, -122.002, 98]] };
  const responses = { approach, leave: { ...structuredClone(approach), via: [...via].reverse(), coordinates: [...approach.coordinates].reverse() } };
  await f.run({ args: [], fetchRoute: async url => response(responses[new URL(url).searchParams.get('lonlats').startsWith('-122.003') ? 'approach' : 'leave']) });
  const published = parse(await f.read())['test-ride'];
  assert.deepEqual(published.source.parts.map(part => part.id), ['out', 'back']);
  assert.deepEqual(published.transit.source.parts.map(part => part.id), ['approach', 'back', 'out', 'leave']);
  assert.equal(published.transit.source.start, 'town');
  assert.equal(published.transit.source.references, undefined);
  assert.deepEqual(published.transit.points.slice(0, 2), approach.coordinates);
  assert.equal(published.transit.points.length, 2 + 3 + 3 + 2);
  const module = await f.readModule();
  // each part is prepared once, and the ride lists both itineraries by part id
  assert.equal((module.match(/^  "out": \{/gm) || []).length, 1);
  assert.match(module, /"test-ride": \{ "parts": \["out","back"\], "transit": \["approach","back","out","leave"\] \}/);
  await f.run();
  for (const [name, edit, expected] of [
    ['a skipped part', plans => { plans.itineraries['test-ride'].transit.parts = ['approach', 'out', 'leave']; }, /must ride every part of the ride itself; missing back/],
    ['an unknown start', plans => { plans.itineraries['test-ride'].transit.startId = 'elsewhere'; }, /test-ride transit: missing start elsewhere/],
    ['references of its own', plans => { plans.itineraries['test-ride'].transit.references = []; }, /a transit itinerary has only startId and parts/],
    ['a plan without it', plans => { delete plans.itineraries['test-ride'].transit; }, /transit itinerary differs from the plan/],
  ]) {
    await t.test(name, async () => {
      const plans = structuredClone(f.plans);
      edit(plans);
      await fs.writeFile(new URL('scripts/route-plans.json', f.root), JSON.stringify(plans));
      await assert.rejects(f.run(), expected);
    });
  }
});
