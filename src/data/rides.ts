// Ride collection. Routes are approximate hand-traced road lines (swap in GPX later).
// Optional per-ride fields (everything else in the panel derives from route/profile automatically):
//   waypoints:[{f, name}]  named points along the route, f = fraction of total distance. When absent, waypoints
//                          are derived from the profile (high point, foot/top of each steep climb); photos add extras.
//   finish:'Town, place'   for point-to-point rides. Omit for loops (finish = start).
//   hours / feet           stated totals; when present, leg times and gains are calibrated to them.
import type { RideInput, MapLabel } from './types';

export const AREAS = ["Marin","East Bay","Peninsula"] as const;

export const RIDE_INPUTS: RideInput[] = [
  { slug: "paradise-loop", name: "Paradise Loop", area: "Marin", start: "Mill Valley, Depot Plaza",
    miles: 22, feet: 1100, hours: "1½–2 h",
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
    profileKeys: [[0,20],[1.4,60],[2.6,320],[3.4,120],[4.5,30],[7,80],[9,140],[10.5,40],[12,120],[13.5,20],[15,30],[17,60],[19,40],[20.5,20],[22,20]],
    photos: [
      { f: 0.12, cap: "Camino Alto, morning fog just lifting" },
      { f: 0.42, cap: "Paradise Beach cove, low tide" },
      { f: 0.6, cap: "Tiburon bench, Angel Island" },
      { f: 0.86, cap: "Richardson Bay path, egret" },
    ],
    route: [[37.9062,-122.545],[37.911,-122.5405],[37.916,-122.5355],[37.921,-122.53],[37.9255,-122.526],[37.9275,-122.517],[37.9265,-122.508],[37.9215,-122.498],[37.913,-122.487],[37.904,-122.479],[37.8955,-122.468],[37.887,-122.458],[37.879,-122.451],[37.873,-122.45],[37.8735,-122.456],[37.8765,-122.468],[37.88,-122.479],[37.8845,-122.49],[37.888,-122.503],[37.889,-122.512],[37.8925,-122.525],[37.8985,-122.535],[37.9062,-122.545]],
  },

  { slug: "tam-alpine-dam", name: "Mt Tam via Alpine Dam", area: "Marin", start: "Fairfax, the Parkade",
    miles: 41, feet: 4900, hours: "4–5 h",
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
    profileKeys: [[0,120],[2,300],[4.5,1100],[6,900],[8,700],[10,650],[12.5,1450],[14,2000],[16,2100],[17.5,2300],[19,2571],[20.5,2300],[22,2000],[23.5,1500],[25,1100],[27,600],[28.5,100],[31,60],[34,80],[37,60],[41,120]],
    photos: [
      { f: 0.18, cap: "Alpine Lake, glass flat" },
      { f: 0.24, cap: "The dam road, looking back" },
      { f: 0.44, cap: "Seven Sisters, fog below" },
      { f: 0.5, cap: "East Peak fire lookout" },
      { f: 0.7, cap: "Panoramic Highway shade" },
    ],
    route: [[37.987,-122.589],[37.982,-122.596],[37.975,-122.606],[37.966,-122.615],[37.956,-122.624],[37.946,-122.632],[37.941,-122.642],[37.935,-122.643],[37.929,-122.639],[37.924,-122.633],[37.918,-122.626],[37.913,-122.619],[37.9105,-122.6125],[37.917,-122.608],[37.923,-122.602],[37.9275,-122.5965],[37.923,-122.602],[37.917,-122.608],[37.9105,-122.6125],[37.904,-122.604],[37.899,-122.59],[37.894,-122.576],[37.888,-122.564],[37.892,-122.553],[37.9062,-122.545],[37.921,-122.53],[37.931,-122.533],[37.944,-122.54],[37.955,-122.55],[37.964,-122.56],[37.975,-122.565],[37.98,-122.576],[37.987,-122.589]],
  },

  { slug: "hawk-hill", name: "Hawk Hill", area: "Marin", start: "Crissy Field, East Beach lot",
    miles: 16, feet: 1600, hours: "1½ h",
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
    profileKeys: [[0,10],[1.2,30],[2,230],[3.5,240],[4.2,400],[5.6,920],[6.5,600],[7.5,80],[8,20],[9.5,120],[10.8,60],[11.5,180],[12.5,240],[14,230],[15,60],[16,10]],
    photos: [
      { f: 0.2, cap: "Bridge deck, west sidewalk" },
      { f: 0.35, cap: "Conzelman pullout, city behind" },
      { f: 0.5, cap: "Rodeo Beach, cold" },
    ],
    route: [[37.804,-122.465],[37.8075,-122.475],[37.811,-122.4775],[37.82,-122.4785],[37.83,-122.4795],[37.832,-122.483],[37.829,-122.489],[37.827,-122.496],[37.8258,-122.4998],[37.823,-122.507],[37.8215,-122.515],[37.825,-122.523],[37.83,-122.53],[37.832,-122.536],[37.834,-122.525],[37.8345,-122.512],[37.833,-122.498],[37.834,-122.487],[37.8385,-122.4805],[37.83,-122.4795],[37.82,-122.4785],[37.811,-122.4775],[37.8075,-122.475],[37.804,-122.465]],
  },

  { slug: "three-bears", name: "Three Bears", area: "East Bay", start: "Orinda BART", transit: "BART",
    miles: 27, feet: 2300, hours: "2–2½ h",
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
    profileKeys: [[0,480],[3,520],[6,400],[8,450],[9.5,760],[11,500],[13,600],[14.5,420],[16.5,780],[18,600],[19.5,900],[21,650],[22.5,760],[24,520],[27,480]],
    photos: [
      { f: 0.3, cap: "Castro Ranch Road, oaks" },
      { f: 0.55, cap: "Cows, Bear Creek Road" },
      { f: 0.72, cap: "Top of Papa Bear" },
    ],
    route: [[37.877,-122.18],[37.886,-122.185],[37.896,-122.193],[37.906,-122.205],[37.92,-122.218],[37.933,-122.232],[37.945,-122.248],[37.956,-122.256],[37.966,-122.253],[37.974,-122.24],[37.98,-122.225],[37.986,-122.21],[37.988,-122.19],[37.984,-122.17],[37.976,-122.152],[37.965,-122.156],[37.954,-122.164],[37.943,-122.172],[37.931,-122.18],[37.919,-122.19],[37.907,-122.193],[37.896,-122.193],[37.877,-122.18]],
  },

  { slug: "diablo-south-gate", name: "Mt Diablo, South Gate", area: "East Bay", start: "Danville, Railroad Ave",
    miles: 38, feet: 3900, hours: "3½–4 h",
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
    profileKeys: [[0,360],[3,500],[5,900],[8,1500],[11,2200],[13.5,2800],[16,3300],[18,3600],[18.8,3849],[19.6,3600],[22,3300],[24.5,2800],[27,2200],[30,1500],[33,900],[35,500],[38,360]],
    photos: [
      { f: 0.15, cap: "South Gate, oaks and grass" },
      { f: 0.4, cap: "The Junction, looking up" },
      { f: 0.49, cap: "Summit, Central Valley haze" },
    ],
    route: [[37.822,-121.999],[37.828,-121.988],[37.834,-121.976],[37.842,-121.965],[37.85,-121.956],[37.858,-121.947],[37.866,-121.938],[37.872,-121.93],[37.877,-121.928],[37.88,-121.921],[37.8816,-121.9142],[37.88,-121.921],[37.877,-121.928],[37.872,-121.93],[37.866,-121.938],[37.858,-121.947],[37.85,-121.956],[37.842,-121.965],[37.834,-121.976],[37.828,-121.988],[37.822,-121.999]],
  },

  { slug: "grizzly-peak", name: "Grizzly Peak & Skyline", area: "East Bay", start: "Downtown Berkeley BART", transit: "BART", labelSide: "l",
    miles: 21, feet: 2400, hours: "2 h",
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
    profileKeys: [[0,150],[2,400],[4,900],[6,1400],[7.5,1600],[9,1500],[11,1650],[12.5,1450],[14,1200],[16,700],[18,300],[21,150]],
    photos: [
      { f: 0.3, cap: "Grizzly Peak Blvd, bridges" },
      { f: 0.5, cap: "Skyline, Tilden fog" },
    ],
    route: [[37.8735,-122.268],[37.88,-122.269],[37.89,-122.266],[37.896,-122.26],[37.901,-122.253],[37.9,-122.245],[37.894,-122.24],[37.886,-122.233],[37.878,-122.226],[37.87,-122.218],[37.862,-122.212],[37.854,-122.208],[37.848,-122.215],[37.852,-122.226],[37.856,-122.238],[37.862,-122.25],[37.868,-122.26],[37.8735,-122.268]],
  },

  { slug: "tunitas-creek", name: "Tunitas Creek Loop", area: "Peninsula", start: "Woodside, Roberts Market",
    miles: 47, feet: 4700, hours: "4–5 h",
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
    profileKeys: [[0,380],[2,500],[5.5,1600],[7,2300],[9,2100],[11,1700],[13.5,900],[16,300],[18,60],[22,80],[26,60],[29,120],[31,400],[33,1000],[35,1800],[37,2200],[40,2150],[43,1500],[45,800],[47,380]],
    photos: [
      { f: 0.12, cap: "Kings Mountain Road, redwood shade" },
      { f: 0.44, cap: "Highway 1, headwind" },
      { f: 0.62, cap: "The Bike Hut" },
      { f: 0.74, cap: "Upper Tunitas switchbacks" },
    ],
    route: [[37.43,-122.254],[37.431,-122.268],[37.429,-122.285],[37.424,-122.301],[37.416,-122.311],[37.406,-122.317],[37.396,-122.323],[37.386,-122.328],[37.378,-122.336],[37.372,-122.348],[37.366,-122.362],[37.36,-122.378],[37.357,-122.393],[37.37,-122.4],[37.385,-122.406],[37.4,-122.415],[37.42,-122.425],[37.44,-122.433],[37.46,-122.437],[37.475,-122.42],[37.478,-122.4],[37.472,-122.38],[37.468,-122.36],[37.46,-122.34],[37.45,-122.32],[37.442,-122.3],[37.438,-122.28],[37.43,-122.254]],
  },

  { slug: "old-la-honda", name: "Old La Honda & Page Mill", area: "Peninsula", start: "Portola Valley Town Center",
    miles: 34, feet: 3800, hours: "3 h",
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
    profileKeys: [[0,420],[2,500],[3,700],[6,2000],[7.5,2100],[10,2300],[13,2500],[15,2200],[16,2000],[18,1400],[20,800],[22,500],[24,400],[28,380],[34,420]],
    photos: [
      { f: 0.1, cap: "Stone bridge, bottom of OLH" },
      { f: 0.25, cap: "Redwoods, upper OLH" },
      { f: 0.55, cap: "Page Mill, Monte Bello" },
    ],
    route: [[37.374,-122.221],[37.38,-122.233],[37.384,-122.245],[37.386,-122.256],[37.385,-122.265],[37.376,-122.262],[37.366,-122.256],[37.356,-122.245],[37.345,-122.23],[37.333,-122.21],[37.322,-122.195],[37.3155,-122.1835],[37.323,-122.178],[37.333,-122.172],[37.345,-122.165],[37.356,-122.162],[37.365,-122.17],[37.37,-122.19],[37.374,-122.205],[37.374,-122.221]],
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
