# Route preparation

The guide's route lines, distances, climbing figures and elevation profiles all come from
`src/data/routes.generated.ts`, which `prepare-routes.mjs` builds from the plan in `route-plans.json`.
It is a content-editing tool, not a build step: the generated file is committed, and the site never calls a
routing service.

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
     drawn from: park pages, club route sheets, bridge access rules).
3. Generate, with an internet connection:

   ```sh
   npm run routes                                  # request missing or changed segments, reuse the rest, publish
   node scripts/prepare-routes.mjs tam-climb       # re-request just these segments even if unchanged
   node scripts/prepare-routes.mjs --check         # validate the committed file against the plan; offline
   ```

   Requests go to the public BRouter instance, one per segment with a 1.1 s pause, using the `profile` named in
   the plan (`fastbike`: paved roads, direct). Look at the result on the map before committing: `fastbike` will
   happily pick a highway over a quiet lane, so put a via point or two on the lane you mean, and put them on the
   road itself rather than on a trail beside it (the script warns when more than 100 m of a segment runs on
   paths, footways or tracks). A shoreline point without terrain elevation takes its neighbour's.
4. Run `npm run test:routes` (offline regression checks of the script itself) and `npm run build`.

Each successful request is saved to the ignored `.route-data-checkpoint.json`, so an interrupted run resumes
where it stopped; the published file is replaced atomically only once the whole collection validates. The
checkpoint is bound to the published file's hash and ignored if that file changes; delete it to discard an
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
- **Climbing is estimated.** `guide.ts` samples the profile every ~25 m, smooths it with a short 1-2-1 window,
  and counts gain with 10 m hysteresis (a reversal smaller than 10 m is noise, not a climb). Figures will differ
  from a GPS unit or another service.
- **Distance is measured** from the route geometry and shown in whole miles.

The generated file records, per ride, the service, profile, preparation date and every via point, plus each
part's routing inputs so `--check` can tell when the plan has moved on.
