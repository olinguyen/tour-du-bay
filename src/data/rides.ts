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
//   hours                  stated riding time; leg times are calibrated to it. Distance and climbing are measured.
import type { RideInput, MapLabel } from './types';

export const AREAS = ["Marin","East Bay","Peninsula"] as const;

export const RIDE_INPUTS: RideInput[] = [
  { slug: "paradise-loop", name: "Paradise Loop", area: "Marin", start: "Mill Valley, Depot Plaza",
    from: { start: "Panhandle, Stanyan entrance" }, hours: "1½–2 h",
    tagline: "The one I ride when I don’t want to think.",
    notes: [
      "Ride it clockwise so the bay is on your right the whole way round Tiburon.",
      "Camino Alto is the only real climb; it’s over in ten minutes.",
      "Paradise Drive is shaded and narrow — ride single file, cars are patient.",
      "Coffee in Tiburon at the halfway point. Sit outside.",
      "Tiburon Blvd back to Strawberry is the least pleasant mile. Use the path.",
    ],
    story: [
      "This is the loop I ride when I don’t want to think. There is exactly one hill, and it comes early, so by the time you crest Camino Alto with Corte Madera below you the rest of the morning is decided. From there it is bay water and eucalyptus and the smell of low tide.",
      "Paradise Drive earns its name on the east side of the peninsula. The road drops right to the water, the shoulder disappears, and nobody minds. You pass the little cove at Paradise Beach, then a stretch where the road is lined with houses that have clearly been there longer than the money.",
      "Tiburon is the turnaround in spirit if not geometry. Coffee, a bench, Angel Island filling the view. The way home along Richardson Bay is flat and a little dull, which is fine — it’s the cooldown.",
    ],
    photos: [
      { f: 0.13, cap: "Camino Alto, morning fog just lifting" },
      { f: 0.51, cap: "Paradise Beach cove, low tide" },
      { f: 0.68, cap: "Tiburon bench, Angel Island" },
      { f: 0.87, cap: "Richardson Bay path, egret" },
    ],
  },

  { slug: "tam-alpine-dam", name: "Mt Tam via Alpine Dam", area: "Marin", start: "Fairfax, the Parkade",
    from: { start: "Panhandle, Stanyan entrance" }, hours: "4–5 h",
    tagline: "The big Marin day. Lake, ridge, summit, ocean air.",
    notes: [
      "Bolinas–Fairfax Road has rough pavement after the lake. Wider tires help.",
      "The Seven Sisters on Ridgecrest are exposed; check the wind before committing.",
      "Water at Pantoll ranger station and nowhere else until Mill Valley.",
      "East Peak is a 1.5-mile spur. Do it. The view is the point.",
      "Panoramic Highway descent is fast and popular with cars on weekends; leave early.",
    ],
    story: [
      "Fairfax at eight in the morning is bikes and coffee, and then the road goes up. Bolinas–Fairfax climbs through redwoods to a ridge, drops to Alpine Lake, and for a while you’re riding along still water with nobody around. The dam itself is a strange concrete arc with a road on top. Stop here; it’s the last flat thing for an hour.",
      "Above the dam the climb kicks into switchbacks and then Ridgecrest Boulevard, the Seven Sisters: seven rollers along the spine of Tamalpais with the Pacific on your right and the whole of Marin on your left. On a clear day you can see the Farallones. On a foggy day you can see your front wheel.",
      "East Peak is the reward. Then Pantoll, Panoramic, and a long descent into Mill Valley through the shade, before the flat spin back up the valley to Fairfax with tired legs and a very good mood.",
    ],
    photos: [
      { f: 0.21, cap: "Alpine Lake, glass flat" },
      { f: 0.24, cap: "The dam road, looking back" },
      { f: 0.37, cap: "Seven Sisters, fog below" },
      { f: 0.45, cap: "East Peak fire lookout" },
      { f: 0.58, cap: "Panoramic Highway shade" },
    ],
  },

  { slug: "hawk-hill", name: "Hawk Hill", area: "Marin", start: "Crissy Field, East Beach lot",
    from: { start: "Panhandle, Stanyan entrance" }, hours: "1½ h",
    tagline: "Short, steep, and the best view of the city there is.",
    notes: [
      "The bridge’s west sidewalk is bikes-only on weekends; the east side otherwise, shared with walkers.",
      "Conzelman is one-way past the summit and hits 18% on the drop to Rodeo Beach. Check your brakes.",
      "Fog can sit on the Headlands while the city is sunny. Bring a layer.",
      "Bunker Road tunnel is one lane with a signal — press the bike button.",
    ],
    story: [
      "Everyone rides Hawk Hill, and it still doesn’t get old. You cross the bridge in the wind, turn left under it, and climb Conzelman with the towers dropping away behind you. Every pullout is a better photo than the last, which is a good excuse to stop.",
      "The summit is a concrete battery and a lot of people with cameras. Past it, the road goes one-way and falls off the hill. I always feel like I’m riding off the edge of a table. Rodeo Beach at the bottom is dark sand and cold water and a good place to eat whatever’s in your pocket.",
      "Bunker Road takes you back through the valley, the tunnel, and out to Alexander Avenue, then the bridge again with the city in front of you this time.",
    ],
    photos: [
      { f: 0.18, cap: "Bridge deck, west sidewalk" },
      { f: 0.25, cap: "Conzelman pullout, city behind" },
      { f: 0.55, cap: "Rodeo Beach, cold" },
    ],
  },

  { slug: "three-bears", name: "Three Bears", area: "East Bay", start: "Orinda BART", transit: "BART",
    hours: "2–2½ h",
    tagline: "Rolling ranch roads, cows, and three honest climbs.",
    notes: [
      "Counter-clockwise: Pig Farm Hill first, then Mama, Papa and Baby Bear on the way home.",
      "Alhambra Valley Road has a fast, straight descent; it’s the only place I’ve ever seen a cyclist get a speeding ticket.",
      "No water on the loop. Fill up at Orinda.",
      "Cattle cross Bear Creek Road. They win.",
    ],
    story: [
      "This is the ride that made me like the East Bay. Camino Pablo north from Orinda is a wide shoulder and reservoir views, then Castro Ranch and Alhambra Valley turn it into farm country — fences, oaks, cows watching you climb.",
      "Bear Creek Road is the return, and the three bears are three rises in a row. Papa is the long one. Everyone pretends they aren’t racing to the top of it, and everyone is.",
      "From the last summit it’s a green valley run back to Camino Pablo, and Orinda’s coffee is closer than you expect.",
    ],
    photos: [
      { f: 0.41, cap: "Castro Ranch Road, oaks" },
      { f: 0.67, cap: "Cows, Bear Creek Road" },
      { f: 0.76, cap: "Top of Papa Bear" },
    ],
  },

  { slug: "diablo-south-gate", name: "Mt Diablo, South Gate", area: "East Bay", start: "Danville, Railroad Ave",
    from: { start: "Walnut Creek BART", transit: "BART" }, hours: "3½–4 h",
    tagline: "Eleven miles up, then a wall, then everything.",
    notes: [
      "The grade is steady at 5–6% until the last 150 metres, which are 17%. Save one gear.",
      "Water and toilets at the Junction ranger station and the summit.",
      "Spring brings wildflowers and rattlesnakes on the warm tarmac. Both are worth watching for.",
      "The descent is long and the pavement is good; watch for cars pulling out of overlooks.",
    ],
    story: [
      "Diablo is the mountain you see from everywhere in the East Bay, so eventually you have to go up it. South Gate Road climbs through oak and grassland at a grade you can talk on, which is the trick: it’s not hard, it’s just long.",
      "The Junction is the halfway point in spirit. Above it the trees fall away and the road rings the summit cone with the Central Valley on one side and the whole Bay on the other. On a clear winter day you can see the Sierra.",
      "The wall at the top is a joke the road plays on you. Then the summit building, a snack, and forty minutes of descending.",
    ],
    photos: [
      { f: 0.26, cap: "South Gate, oaks and grass" },
      { f: 0.34, cap: "The Junction, looking up" },
      { f: 0.49, cap: "Summit, Central Valley haze" },
    ],
  },

  { slug: "grizzly-peak", name: "Grizzly Peak & Skyline", area: "East Bay", start: "Downtown Berkeley BART", transit: "BART", labelSide: "l",
    hours: "2 h",
    tagline: "The after-work ride. Bay lights on the way down.",
    notes: [
      "Spruce Street is the gentlest way up; Marin Avenue is the hardest and I don’t recommend it.",
      "Grizzly Peak Blvd is the view road. Pull over at the Lawrence Hall lots.",
      "Tunnel Road descent is smooth and quick; watch the intersection at Claremont.",
      "Fog line: if the hills are in cloud, the top will be cold and wet even when Berkeley is warm.",
    ],
    story: [
      "This is the ride I do most, because it starts from my door. Spruce climbs steadily out of the flats, past houses and then eucalyptus, until the road tips onto Grizzly Peak Boulevard and the whole Bay opens up: the bridges, the city, the Golden Gate with the sun behind it.",
      "Skyline rolls along the ridge with Tilden on one side. Then Tunnel Road drops you back into Berkeley fast, and if you timed it right the lights are just coming on below you.",
    ],
    photos: [
      { f: 0.3, cap: "Grizzly Peak Blvd, bridges" },
      { f: 0.58, cap: "Skyline, Tilden fog" },
    ],
  },

  { slug: "tunitas-creek", name: "Tunitas Creek Loop", area: "Peninsula", start: "Woodside, Roberts Market",
    from: { start: "Menlo Park Caltrain", transit: "Caltrain" }, hours: "4–5 h",
    tagline: "Redwoods, coast, and the best climb on the Peninsula.",
    notes: [
      "Kings Mountain Road is the way over the ridge; shaded, steady, quiet.",
      "Highway 1 north has a shoulder and a headwind. Both are reliable.",
      "Tunitas Creek Road is cold in the bottom of the canyon even in August.",
      "The Bike Hut on Tunitas runs on an honor box. Leave cash, take a Coke.",
    ],
    story: [
      "You climb Kings Mountain in the shade, cross Skyline, and drop to the ocean on Highway 84 through La Honda — or, if you want the whole thing, ride Tunitas down and come back up Kings. I do it the other way: down to the coast, north on 1 with the wind in my face, and then back up Tunitas Creek because it’s the best climb around here.",
      "Tunitas starts flat along a creek under redwoods, then pitches up for three miles of switchbacks with no cars and no sound. The Bike Hut is at the bottom. Skyline at the top, Kings Mountain down to Woodside, done.",
    ],
    photos: [
      { f: 0.09, cap: "Kings Mountain Road, redwood shade" },
      { f: 0.62, cap: "Highway 1, headwind" },
      { f: 0.66, cap: "The Bike Hut" },
      { f: 0.75, cap: "Upper Tunitas switchbacks" },
    ],
  },

  { slug: "old-la-honda", name: "Old La Honda & Page Mill", area: "Peninsula", start: "Portola Valley Town Center",
    from: { start: "Palo Alto Caltrain", transit: "Caltrain" }, hours: "3 h",
    tagline: "The climb everyone times. I don’t any more.",
    notes: [
      "Old La Honda is 3.3 miles, about 1,300 feet, and nearly car-free. Ride it at your own pace.",
      "Skyline has traffic on weekends; ride the shoulder and enjoy the view slots.",
      "Page Mill descends steep and technical for the first two miles. Look through the corners.",
      "Alice’s Restaurant at Skyline & 84 for a sandwich if you go the long way.",
    ],
    story: [
      "Old La Honda is a narrow lane under oaks and redwoods that has been the Peninsula’s test climb for fifty years. People post times. I used to. Now I ride it because it’s quiet, it smells like bay laurel, and there’s a stone bridge at the bottom that feels like the start of something.",
      "Skyline south to Page Mill is the ridge, with the ocean showing in the gaps. Page Mill down is the fast part, and Portola Valley at the bottom is flat and warm.",
    ],
    photos: [
      { f: 0.11, cap: "Stone bridge, bottom of OLH" },
      { f: 0.24, cap: "Redwoods, upper OLH" },
      { f: 0.56, cap: "Page Mill, Monte Bello" },
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
