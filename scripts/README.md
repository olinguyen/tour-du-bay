# Route preparation

The guide's route lines, distances, climbing figures and elevation profiles all come from
`src/data/routes.generated.ts`, which `prepare-routes.mjs` builds from the plan in `route-plans.json`.
It is a content-editing tool, not a build step: the generated file is committed, and the site never calls a
routing service.

It writes two committed files:

- **`route-data.json`** — the planned geometry as BRouter returned it, with its provenance. This is the tool's
  own record: it is read back on the next run so an unchanged segment is never requested again. Nothing in
  `src/` imports it.
- **`src/data/routes.generated.ts`** — what the page downloads. Every part prepared for drawing
  (`src/lib/prepare.ts`: simplified to 3 m, resampled every 25 m, smoothed) and written as differences between
  scaled integers, which `src/data/routeCodec.ts` decodes, plus each ride's itineraries as lists of part ids. The
  page joins the parts into trips (`composeRoute`), so a part two rides share, such as the way from the Panhandle
  to Mill Valley, is downloaded once. Preparing offline rather than in the browser is what keeps the download near
  50 KB instead of 127 KB, and takes ~45 ms of work off every page load.

The second file is derived from the first, so it is never edited by hand; `--check` re-derives it and fails if
the two were not committed together. Because the script imports `src/lib/prepare.ts` directly, it needs Node
22.18 or newer (for TypeScript stripping).

## Adding or changing a ride

1. Add the ride's words to `src/data/rides.ts`. Its `{ slug:` must begin a line — the script reads slugs from
   there to make sure every itinerary has a ride.
2. Describe the route in `route-plans.json`:
   - `starts` — a named start with its `[lon, lat]` coordinate (OpenStreetMap order). The route must begin within
     150 m of it.
   - `segments` — each has a `role` (`core` for the ride itself, `connector` for an access leg) and either a list
     of `via` points, `[lon, lat]` on the roads to follow, or `reverseVia: "<id>"` to ride another segment backwards.
     A handful of junctions is enough; BRouter fills in the road between them. Return legs are routed on their
     own so one-way streets are respected. Consecutive parts must meet within 30 m.
   - `itineraries` — keyed by ride slug: the `startId`, the ordered `parts`, and `references` (URLs the plan was
     drawn from: park pages, club route sheets, bridge access rules). An optional `transit` is a second itinerary
     for the same ride, ridden in from another start and back — the nearest station, or the Panhandle for the
     Marin rides — as its own `startId` and `parts`. It must ride every part of the ride itself, since the page
     moves photos and waypoints onto it by the part they sit on; the legs around the ride are what it adds. The
     ride's entry in `src/data/rides.ts` then names that start in `from` (with `transit: 'BART'` or `'Caltrain'`
     for a station, and `via: 'Mill Valley'` when the way in meets the ride somewhere other than the ride's own
     start, so the route card can name the place), and the page offers the two starts as a switch.
3. Generate, with an internet connection:

   ```sh
   npm run routes                                  # request missing or changed segments, reuse the rest, publish
   node scripts/prepare-routes.mjs tam-climb       # re-request just these segments even if unchanged
   node scripts/prepare-routes.mjs --check         # validate both committed files against the plan; offline
   ```

   Requests go to the public BRouter instance, one per segment with a 1.1 s pause, using the `profile` named in
   the plan (`fastbike`: paved roads, direct). Look at the result on the map before committing: `fastbike` will
   happily pick a highway over a quiet lane, so put a via point or two on the lane you mean, and put them on the
   road itself rather than on a trail beside it (the script warns when more than 100 m of a segment runs on
   paths, footways or tracks, and when a segment rides out to a via point and back the same way, which is what a
   point placed a block off the route produces). A shoreline point without terrain elevation takes its neighbour's.
4. Run `npm test`, `npm run test:routes` (offline regression checks of the script itself) and `npm run build`.
   `src/data/routes.test.ts` re-prepares `route-data.json` from scratch, part by part, and checks that what the
   guide draws — both SVG paths, the figures, the climbs, waypoints and legs — is unchanged by the encoding, for
   every ride and every ride in from its other start.

Each successful request is saved to the ignored `.route-data-checkpoint.json`, so an interrupted run resumes
where it stopped; the published file is replaced atomically only once the whole collection validates. The
checkpoint is bound to `route-data.json`'s hash and ignored if that file changes; delete it to discard an
unfinished run. Changing `profile` makes every segment stale, and a segment whose `via` list changed must be
regenerated along with any `reverseVia` twin.

Validation, in both modes: coordinate shape and bounds, finite elevation, at least two points with nonzero
length, finite nonnegative distance and ascent, joins between parts, start proximity, saved routing inputs
(endpoint, profile, alternative) against today's plan, roles, references, and catalog membership. Generation
additionally rejects responses with extra or multipart geometry and any way tagged motorway, steps, ferry,
`bicycle=no` or private without bicycle access — inspect the plan if it does.

## What the numbers mean

- **Routes are plans, not recordings.** Geometry follows OpenStreetMap ways as BRouter chooses them between the
  via points; check current access and conditions before riding.
- **Elevation is a terrain model.** Each point carries BRouter's ground elevation, converted to feet. Bridges,
  tunnels and road cuts follow the ground rather than the road surface, so the Golden Gate Bridge dips to the
  water and a tunnel climbs over its hill.
- **Climbing is estimated.** `prepare.ts` samples the profile every ~25 m, smooths it with a short 1-2-1 window,
  and counts gain with 10 m hysteresis (a reversal smaller than 10 m is noise, not a climb). Figures will differ
  from a GPS unit or another service. Parts are prepared one at a time and joined on the page, where a trip
  returning to its start is given one height there, so a loop's legs descend exactly what its headline figure
  climbs.
- **Distance is measured** from the route geometry and shown to a tenth of a mile.

`route-data.json` records, per ride and per transit itinerary, the service, profile, preparation date and every
via point, plus each part's routing inputs so `--check` can tell when the plan has moved on. None of that
provenance is downloaded by the page.
