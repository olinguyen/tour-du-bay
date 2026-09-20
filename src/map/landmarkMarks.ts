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
  /** a drawing that has no 3D model to hand over to: it shows in 2D only */
  only2d?: boolean;
  svg: string;
}

const INK = 'fill="var(--ink-2)"';
const LINE = 'fill="none" stroke="var(--ink)" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"';
const GREY = 'fill="none" stroke="var(--ink-2)" stroke-linecap="round" stroke-linejoin="round"';
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
  // ---- 2D only: places with no model
  {
    name: 'Sutro Baths and the Cliff House',
    at: [-122.51385, 37.7794],
    w: 30,
    h: 18,
    from: 11,
    only2d: true,
    svg: `<path ${INK} d="M0 18 V9 H12 L18 14 H30 V18 Z M2 4.5 H10 V9 H2 Z M1.2 3.4 H10.8 V4.8 H1.2 Z"/><path ${GREY} stroke-width="0.9" d="M19.5 14 V11.6 H23.5 V14 M25 14 V11.6 H29 V14"/>`,
  },
  {
    name: 'Coit Tower',
    at: [-122.405834, 37.802379],
    w: 8,
    h: 26,
    from: 12,
    only2d: true,
    svg: `<path ${INK} d="M2.2 26 L2.6 6 H5.4 L5.8 26 Z M1.6 2.2 H6.4 V6 H1.6 Z M2.6 0.6 H5.4 V2.2 H2.6 Z"/><path fill="var(--page)" d="M2.5 3 H3.3 V5 H2.5 Z M3.7 3 H4.4 V5 H3.7 Z M4.8 3 H5.5 V5 H4.8 Z"/>`,
  },
  {
    name: 'Ferry Building',
    at: [-122.393474, 37.795548],
    w: 34,
    h: 22,
    from: 12,
    only2d: true,
    svg: `<path ${INK} d="M0 16 H34 V22 H0 Z M14.5 6 H19.5 V16 H14.5 Z M15.4 3 H18.6 V6 H15.4 Z M17 0 L18.4 3 H15.6 Z"/><circle cx="17" cy="9" r="1.5" fill="var(--page)"/><path fill="var(--page)" d="M2 18 H4 V22 H2 Z M6 18 H8 V22 H6 Z M10 18 H12 V22 H10 Z M22 18 H24 V22 H22 Z M26 18 H28 V22 H26 Z M30 18 H32 V22 H30 Z"/>`,
  },
  {
    name: 'Bay Bridge',
    at: [-122.3778, 37.7972],
    w: 44,
    h: 18,
    from: 10.4,
    only2d: true,
    svg: `<path ${GREY} stroke-width="1.1" d="M0 12 L7 3 Q11.5 11 16 3 L22 9.5 L28 3 Q32.5 11 37 3 L44 12"/><path ${GREY} stroke-width="1.9" d="M7 2 V17 M16 2 V17 M28 2 V17 M37 2 V17"/><path ${GREY} stroke-width="1.5" d="M0 13 H44"/><path ${INK} d="M20.5 9 H23.5 V17 H20.5 Z"/>`,
  },
  {
    name: 'The Campanile',
    at: [-122.257831, 37.87206],
    w: 8,
    h: 30,
    from: 10.2,
    only2d: true,
    svg: `<path ${INK} d="M2 30 V9 H6 V30 Z M1.4 4.6 H6.6 V9 H1.4 Z M4 0 L6.6 4.6 H1.4 Z"/><path fill="var(--page)" d="M2.3 5.6 H3.1 V8 H2.3 Z M3.6 5.6 H4.4 V8 H3.6 Z M4.9 5.6 H5.7 V8 H4.9 Z"/>`,
  },
  {
    name: 'Mt Diablo summit',
    at: [-121.914267, 37.88183],
    w: 22,
    h: 16,
    from: 0,
    lift: true,
    only2d: true,
    svg: `<path ${INK} d="M0 10 H22 V16 H0 Z M7 5 H15 V10 H7 Z M10 2 H12 V5 H10 Z"/><circle cx="11" cy="1.4" r="1.4" fill="#c4432b"/>`,
  },
  {
    name: 'The Stanford Dish',
    at: [-122.1794, 37.4083],
    w: 24,
    h: 22,
    from: 10.2,
    only2d: true,
    svg: `<path ${INK} d="M2 9 Q13 19 22 3 Q11 9 2 9 Z"/><path ${GREY} stroke-width="1.1" d="M12 8 L9 1 M13 13 L10 21.5 M13 13 L17 21.5 M8 21.5 H19"/>`,
  },
  {
    name: 'Alpine Dam',
    at: [-122.638701, 37.940135],
    w: 28,
    h: 14,
    from: 10.6,
    only2d: true,
    svg: `<path ${INK} d="M2 3.5 H26 L22 14 H6 Z"/><path fill="none" stroke="#7fa0a3" stroke-width="1.4" stroke-linecap="round" d="M0 2 H28"/><path fill="var(--page)" d="M12.5 3.5 H15.5 V7 H12.5 Z"/>`,
  },
  {
    name: 'Point Bonita Lighthouse',
    at: [-122.529548, 37.81559],
    w: 22,
    h: 20,
    from: 11,
    only2d: true,
    svg: `<path ${INK} d="M6 20 Q9 12 13 12 H17 Q20 14 22 20 Z M13.5 5.5 H16.5 V12 H13.5 Z M13.9 3 H16.1 V5.5 H13.9 Z M15 1.2 L16.6 3 H13.4 Z"/><path ${GREY} stroke-width="0.8" d="M0 12.5 Q5 15 10 12.8 M0 12.5 V14 M3.3 13.6 V15 M6.6 13.6 V15"/>`,
  },
];

/** in 3D the grown models already read at zoom 10.5, so the drawings are for the home view only; 2D has no models, so there they stay */
const MODELS_FROM = 9.9;

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
    for (const { m, el } of made) el.classList.toggle('off', z < m.from || (models && (m.only2d === true || z >= MODELS_FROM)));
  };
  map.on('zoom', paint);
  map.on('terrain', paint);
  paint();
  return made.map((x) => x.marker);
}
