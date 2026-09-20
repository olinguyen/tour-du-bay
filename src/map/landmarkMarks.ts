// PROTOTYPE (?landmark=big): a small drawn silhouette for each landmark, for when the map is too far out for the 3D
// models to read (and for 2D, which has no models at all). Inline SVG in HTML markers, like the start dots: no image
// file, nothing new for the CSP.
import maplibregl, { type Map as MlMap, type Marker } from 'maplibre-gl';
import { reducedMotion } from '../lib/html';

interface Mark {
  name: string;
  at: [number, number];
  /** drawn size in px; the foot of the drawing stands on the place */
  w: number;
  h: number;
  /** the zoom it appears at: the city's five would pile up on each other from further out */
  from: number;
  /** lift the drawing clear of a ride's start dot and name that share its place */
  lift?: boolean;
  svg: string;
}

const INK = 'fill="var(--ink-2)"';
const LINE = 'fill="none" stroke="var(--ink)" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"';
const RED = 'fill="none" stroke="#c4432b" stroke-linecap="round" stroke-linejoin="round"';

const MARKS: Mark[] = [
  {
    name: 'Golden Gate Bridge',
    at: [-122.4786, 37.81968],
    w: 44,
    h: 20,
    from: 0,
    svg: `<path ${RED} stroke-width="1.2" d="M0 13.5 L11 3 Q22 16 33 3 L44 13.5"/><path ${RED} stroke-width="2.2" d="M11 2 V19 M33 2 V19"/><path ${RED} stroke-width="1.6" d="M0 14.5 H44"/>`,
  },
  {
    name: 'Transamerica Pyramid',
    at: [-122.402785, 37.795167],
    w: 12,
    h: 28,
    from: 0,
    svg: `<path ${INK} d="M6 0 L11.5 27 H0.5 Z"/><path ${INK} d="M3.6 12 V8.5 H8.4 V12 Z"/>`,
  },
  {
    name: 'Salesforce Tower',
    at: [-122.396935, 37.789776],
    w: 9,
    h: 32,
    from: 10.6,
    svg: `<path ${INK} d="M0.5 32 V11 Q0.5 0.5 4.5 0.5 Q8.5 0.5 8.5 11 V32 Z"/>`,
  },
  {
    name: 'Sutro Tower',
    at: [-122.45286, 37.75524],
    w: 16,
    h: 30,
    from: 10.2,
    svg: `<path ${RED} stroke-width="1.3" d="M2 30 L6 13 L4 5 V0 M14 30 L10 13 L12 5 V0 M8 30 V0 M4 5 H12 M6 13 H10 M4 22 H12"/>`,
  },
  {
    name: 'Alcatraz',
    at: [-122.4228, 37.82685],
    w: 30,
    h: 15,
    from: 10.2,
    svg: `<path ${INK} d="M0 15 Q4 9 10 8 L22 7 Q27 9 30 15 Z"/><path ${INK} d="M9 4.5 H19 V8 H9 Z M21.3 0 H22.7 V7.5 H21.3 Z M4.5 3 H7 V5.5 H4.5 Z"/><path ${LINE} stroke-width="0.8" d="M5 5.5 V9 M6.5 5.5 V9"/>`,
  },
  {
    name: 'Palace of Fine Arts',
    at: [-122.44843, 37.80292],
    w: 30,
    h: 18,
    from: 11,
    lift: true,
    svg: `<path fill="#b5674b" d="M9 7.5 A6 6 0 0 1 21 7.5 Z"/><path ${INK} d="M8 7.5 H22 V9.5 H8 Z M0 17 H30 V18 H0 Z M0 11.5 H6 V12.6 H0 Z M24 11.5 H30 V12.6 H24 Z"/><path ${LINE} stroke-width="1.4" d="M9.5 9.5 V17 M13 9.5 V17 M17 9.5 V17 M20.5 9.5 V17"/><path ${LINE} stroke-width="0.9" d="M1 12.6 V17 M3 12.6 V17 M5 12.6 V17 M25 12.6 V17 M27 12.6 V17 M29 12.6 V17"/>`,
  },
];

/** in 3D the grown models read from here in, and take over; 2D has none, so there the drawings stay */
const MODELS_FROM = 10.8;

export function addLandmarkMarks(map: MlMap): Marker[] {
  const made = MARKS.map((m) => {
    const el = document.createElement('div');
    el.className = 'mk lm';
    el.title = m.name;
    el.innerHTML = `<svg class="${m.lift ? 'lifted' : ''}" width="${m.w}" height="${m.h}" viewBox="0 0 ${m.w} ${m.h}" aria-hidden="true">${m.svg}</svg>`;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      map.flyTo({ center: m.at, zoom: 14.5, duration: reducedMotion() ? 0 : 2200 });
    });
    return { m, el, marker: new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(m.at).addTo(map) };
  });
  const paint = () => {
    const z = map.getZoom(), models = map.getTerrain() != null;
    for (const { m, el } of made) el.classList.toggle('off', z < m.from || (models && z >= MODELS_FROM));
  };
  map.on('zoom', paint);
  map.on('terrain', paint);
  paint();
  return made.map((x) => x.marker);
}
