// Ride collection: the words. Geometry comes from src/data/routes.generated.ts (planned with scripts/prepare-routes.mjs
// from scripts/route-plans.json, keyed by slug); distance, climbing and the profile are measured from it in guide.ts.
// Keep each ride's `{ slug:` at the start of its line — the route script reads slugs from here to check the plan.
// Optional per-ride fields (everything else in the panel derives from route/profile automatically):
//   waypoints:[{f, name}]  named points along the route, f = fraction of total distance. When absent, waypoints
//                          are derived from the profile (high point, foot/top of each steep climb); photos add extras.
//   finish:'Town, place'   for point-to-point rides. Omit for loops (finish = start).
//   from:{start, transit}  a second way to start: ride in from here and back, on legs the plan lists under the
//                          itinerary's `transit`. The nearest station (transit: 'BART' or 'Caltrain'), or the
//                          Panhandle for the Marin rides, which are reached through the city.
//                          `via` names where the way in meets the ride when that is not the ride's own start
//                          (Mt Tam is joined at Mill Valley, not Fairfax), so the route card can say so.
//   hours                  stated riding time; leg times are calibrated to it. Distance and climbing are measured.
import type { RideInput, MapLabel } from './types';

export const AREAS = ["Marin","East Bay","Peninsula"] as const;

export const RIDE_INPUTS: RideInput[] = [
  { slug: "paradise-loop", name: "Paradise Loop", area: "Marin", start: "Mill Valley, Depot Plaza",
    from: { start: "Panhandle, Stanyan entrance" }, hours: "1½–2 h",
    tagline: "One early climb, then flat bayside roads around the Tiburon Peninsula.",
    notes: [
      "Ride it clockwise so the bay is on your right the whole way round Tiburon.",
      "Camino Alto is the only real climb, about ten minutes.",
      "Paradise Drive is shaded and narrow, with no shoulder. Ride single file.",
      "Coffee stops in Tiburon at the halfway point.",
      "Tiburon Blvd back to Strawberry carries the most traffic. Use the path.",
    ],
    story: [
      "The only climb, Camino Alto, comes early and crests above Corte Madera. After that the route follows the bay shore.",
      "Paradise Drive runs along the east side of the Tiburon Peninsula. The road drops to the water and the shoulder disappears. It passes the cove at Paradise Beach, then a residential stretch.",
      "Tiburon is roughly the halfway point, with coffee, benches and a view of Angel Island. The return along Richardson Bay is flat.",
    ],
    photos: [
      { f: 0.13, cap: "Camino Alto, morning fog just lifting" },
      { f: 0.51, cap: "Paradise Beach cove, low tide" },
      { f: 0.68, cap: "Tiburon, view of Angel Island" },
      { f: 0.87, cap: "Richardson Bay path, egret" },
    ],
  },

  { slug: "tam-alpine-dam", name: "Mt Tam via Alpine Dam", area: "Marin", start: "Fairfax, the Parkade",
    from: { start: "Panhandle, Stanyan entrance", via: "Mill Valley" }, hours: "4–5 h",
    tagline: "Alpine Lake, Ridgecrest, East Peak, and the Panoramic descent.",
    notes: [
      "Bolinas–Fairfax Road has rough pavement after the lake. Wider tires help.",
      "The Seven Sisters on Ridgecrest are exposed; check the wind before committing.",
      "Water at Pantoll ranger station and nowhere else until Mill Valley.",
      "East Peak is a 1.5-mile spur to the summit viewpoint.",
      "Panoramic Highway descent is fast and popular with cars on weekends; leave early.",
    ],
    story: [
      "From Fairfax, Bolinas–Fairfax Road climbs through redwoods to a ridge, then drops to Alpine Lake and follows the shore. The road crosses the top of Alpine Dam, a concrete arch. It is the last flat stretch for about an hour.",
      "Above the dam the climb turns to switchbacks, then joins Ridgecrest Boulevard. The Seven Sisters are seven rollers along the spine of Tamalpais, with the Pacific to the right and Marin to the left. On a clear day the Farallones are visible; in fog, visibility can drop to a few metres.",
      "After the East Peak spur the route passes Pantoll and takes Panoramic Highway on a long, shaded descent into Mill Valley, then a flat run back up the valley to Fairfax.",
    ],
    photos: [
      { f: 0.21, cap: "Alpine Lake" },
      { f: 0.24, cap: "The dam road, looking back" },
      { f: 0.37, cap: "Seven Sisters, fog below" },
      { f: 0.45, cap: "East Peak fire lookout" },
      { f: 0.58, cap: "Panoramic Highway shade" },
    ],
  },

  { slug: "hawk-hill", name: "Hawk Hill", area: "Marin", start: "Crissy Field, East Beach lot",
    from: { start: "Panhandle, Stanyan entrance" }, hours: "1½ h",
    tagline: "Short and steep, with views of the Golden Gate Bridge and the city.",
    notes: [
      "The bridge’s west sidewalk is bikes-only on weekends; the east side otherwise, shared with walkers.",
      "Conzelman is one-way past the summit and hits 18% on the drop to Rodeo Beach. Check your brakes.",
      "Fog can sit on the Headlands while the city is sunny. Bring a layer.",
      "Bunker Road tunnel is one lane with a signal — press the bike button.",
    ],
    story: [
      "The route crosses the Golden Gate Bridge, which is often windy, turns left under it, and climbs Conzelman Road with the bridge towers behind. There are pullouts with views all the way up.",
      "The summit is a concrete battery and a popular viewpoint. Past it Conzelman becomes one-way and descends steeply to Rodeo Beach, a dark-sand beach and a good place to stop and eat.",
      "Bunker Road returns through the valley and the tunnel to Alexander Avenue, then back over the bridge facing the city.",
    ],
    photos: [
      { f: 0.18, cap: "Bridge deck, west sidewalk" },
      { f: 0.25, cap: "Conzelman pullout, city behind" },
      { f: 0.55, cap: "Rodeo Beach" },
    ],
  },

  { slug: "three-bears", name: "Three Bears", area: "East Bay", start: "Orinda BART", transit: "BART",
    hours: "2–2½ h",
    tagline: "Rolling ranch roads and three climbs on Bear Creek Road.",
    notes: [
      "Counter-clockwise: Pig Farm Hill first, then Mama, Papa and Baby Bear on the way home.",
      "Alhambra Valley Road has a fast, straight descent. Watch your speed.",
      "No water on the loop. Fill up at Orinda.",
      "Cattle cross Bear Creek Road. Give way.",
    ],
    story: [
      "Camino Pablo north from Orinda has a wide shoulder and reservoir views. Castro Ranch Road and Alhambra Valley Road then run through farm country: fences, oaks and cattle.",
      "Bear Creek Road is the return leg, and the three bears are three rises in a row. Papa Bear is the longest.",
      "From the last summit the road runs down a valley to Camino Pablo and back into Orinda.",
    ],
    photos: [
      { f: 0.41, cap: "Castro Ranch Road, oaks" },
      { f: 0.67, cap: "Cows, Bear Creek Road" },
      { f: 0.76, cap: "Top of Papa Bear" },
    ],
  },

  { slug: "diablo-south-gate", name: "Mt Diablo, South Gate", area: "East Bay", start: "Danville, Railroad Ave",
    from: { start: "Walnut Creek BART", transit: "BART" }, hours: "3½–4 h",
    tagline: "Eleven miles of steady climbing to a 17% finish at the summit.",
    notes: [
      "The grade is steady at 5–6% until the last 150 metres, which are 17%. Save one gear.",
      "Water and toilets at the Junction ranger station and the summit.",
      "In spring there are wildflowers, and rattlesnakes on the warm tarmac.",
      "The descent is long and the pavement is good; watch for cars pulling out of overlooks.",
    ],
    story: [
      "Mt Diablo is visible from most of the East Bay. South Gate Road climbs through oak and grassland at a steady, conversational grade. The climb is long rather than steep.",
      "The Junction ranger station is about halfway. Above it the trees thin out and the road circles the summit cone, with the Central Valley on one side and the Bay on the other. On a clear winter day the Sierra is visible.",
      "The last 150 metres to the summit are the steepest part of the climb. The summit building is at the top, and the descent takes about forty minutes.",
    ],
    photos: [
      { f: 0.26, cap: "South Gate, oaks and grass" },
      { f: 0.34, cap: "The Junction, looking up" },
      { f: 0.49, cap: "Summit, Central Valley haze" },
    ],
  },

  { slug: "grizzly-peak", name: "Grizzly Peak & Skyline", area: "East Bay", start: "Downtown Berkeley BART", startLabel: "Berkeley BART", transit: "BART", labelSide: "l",
    hours: "2 h",
    tagline: "A two-hour loop over the Berkeley Hills with bay views from the ridge.",
    notes: [
      "Spruce Street is the gentlest way up; Marin Avenue is the steepest.",
      "Grizzly Peak Blvd is the view road. Pull over at the Lawrence Hall lots.",
      "Tunnel Road descent is smooth and quick; watch the intersection at Claremont.",
      "Fog line: if the hills are in cloud, the top will be cold and wet even when Berkeley is warm.",
    ],
    story: [
      "Spruce Street climbs steadily out of the Berkeley flats, past houses and then eucalyptus, to Grizzly Peak Boulevard. From there the view takes in the bridges, San Francisco and the Golden Gate.",
      "Skyline rolls along the ridge beside Tilden Park. Tunnel Road is a fast descent back into Berkeley. On an evening ride the city lights are visible below.",
    ],
    photos: [
      { f: 0.3, cap: "Grizzly Peak Blvd, bridges" },
      { f: 0.58, cap: "Skyline, Tilden fog" },
    ],
  },

  { slug: "tunitas-creek", name: "Tunitas Creek Loop", area: "Peninsula", start: "Woodside, Roberts Market",
    from: { start: "Menlo Park Caltrain", transit: "Caltrain" }, hours: "4–5 h",
    tagline: "Over the ridge through redwoods, north along the coast, and back up Tunitas Creek.",
    notes: [
      "Kings Mountain Road is the way over the ridge; shaded, steady, quiet.",
      "Highway 1 north has a shoulder and usually a headwind.",
      "Tunitas Creek Road is cold in the bottom of the canyon even in August.",
      "The Bike Hut on Tunitas sells drinks from an honor box. Bring cash.",
    ],
    story: [
      "The route climbs Kings Mountain Road in the shade, follows Skyline south, and descends to the coast on Highway 84 through La Honda. It then heads north on Highway 1, usually into the wind, and returns up Tunitas Creek Road.",
      "Tunitas Creek Road starts flat along a creek under redwoods, passing the Bike Hut near the bottom, then climbs for three miles of switchbacks with almost no traffic. From Skyline at the top, Kings Mountain Road descends to Woodside.",
    ],
    photos: [
      { f: 0.09, cap: "Kings Mountain Road, redwood shade" },
      { f: 0.62, cap: "Highway 1, northbound" },
      { f: 0.66, cap: "The Bike Hut" },
      { f: 0.75, cap: "Upper Tunitas switchbacks" },
    ],
  },

  { slug: "old-la-honda", name: "Old La Honda & Page Mill", area: "Peninsula", start: "Portola Valley Town Center",
    from: { start: "Palo Alto Caltrain", transit: "Caltrain" }, hours: "3 h",
    tagline: "The Peninsula’s benchmark climb, then Skyline and the Page Mill descent.",
    notes: [
      "Old La Honda is 3.3 miles, about 1,300 feet, and nearly car-free.",
      "Skyline has traffic on weekends; ride the shoulder.",
      "Page Mill descends steep and technical for the first two miles. Look through the corners.",
      "Alice’s Restaurant at Skyline & 84 is a food stop if you take the long way.",
    ],
    story: [
      "Old La Honda Road is a narrow lane under oaks, redwoods and bay laurel, with a stone bridge at the bottom. It has been the Peninsula’s test climb for about fifty years, and many riders time it.",
      "Skyline south to Page Mill follows the ridge, with the ocean visible through gaps. Page Mill Road is a fast descent, and Portola Valley at the bottom is flat and warm.",
    ],
    photos: [
      { f: 0.11, cap: "Stone bridge, bottom of OLH" },
      { f: 0.24, cap: "Redwoods, upper OLH" },
      { f: 0.57, cap: "Page Mill, Monte Bello" },
    ],
  },
];

// Sparse hand-placed map labels
export const LABELS: MapLabel[] = [
  { t: "San Francisco", k: "town", major: true, ll: [37.762,-122.435] },
  { t: "Berkeley", k: "town", ll: [37.862,-122.305] },
  { t: "Oakland", k: "town", ll: [37.79,-122.25] },
  { t: "Fairfax", k: "town", ll: [38.005,-122.625] },
  { t: "Sausalito", k: "town", ll: [37.856,-122.5] },
  { t: "Half Moon Bay", k: "town", ll: [37.463,-122.44] },
  { t: "Palo Alto", k: "town", ll: [37.44,-122.15] },
  { t: "San José", k: "town", major: true, ll: [37.33,-121.9] },
  { t: "Danville", k: "town", ll: [37.8,-122.01] },
  { t: "Orinda", k: "town", ll: [37.868,-122.135] },
  { t: "Mt Tamalpais", k: "peak", ll: [37.9235,-122.5965] },
  { t: "Mt Diablo", k: "peak", ll: [37.8816,-121.9142] },
  { t: "Pacific Ocean", k: "water", ll: [37.62,-122.78] },
  { t: "San Francisco Bay", k: "water", ll: [37.62,-122.25] },
  { t: "San Pablo Bay", k: "water", ll: [38.06,-122.38] },
];
