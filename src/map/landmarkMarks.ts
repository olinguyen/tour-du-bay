// PROTOTYPE (?landmark=big): a small drawn silhouette for each landmark, for when the map is too far out for the 3D
// models to read (and for 2D, which has no models at all). Inline SVG in HTML markers, like the start dots: no image
// file, nothing new for the CSP.
import maplibregl, { type Map as MlMap, type Marker } from 'maplibre-gl';
import { esc, reducedMotion } from '../lib/html';
import { LYR } from './style';

interface Mark {
  name: string;
  /** the small line under the name in the tooltip */
  note: string;
  at: [number, number];
  /** drawn size in px; the foot of the drawing stands on the place */
  w: number;
  h: number;
  /** the zoom it appears at: the city's five would pile up on each other from further out */
  from: number;
  /**
   * px to move the drawing off its place, right and up: clear of a ride's start dot and name, or off a ride's line,
   * which always wins the pointer and would leave the drawing unnameable
   */
  nudge?: [number, number];
  /** line drawings have no painted area to point at, so their whole box takes the pointer */
  box?: boolean;
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
    note: 'opened 1937',
    at: [-122.4786, 37.81968],
    w: 44,
    h: 20,
    from: 0,
    svg: `<path ${RED} stroke-width="1.2" d="M0 13.5 L11 3 Q22 16 33 3 L44 13.5"/><path ${RED} stroke-width="2.2" d="M11 2 V19 M33 2 V19"/><path ${RED} stroke-width="1.6" d="M0 14.5 H44"/>`,
  },
  {
    name: 'Transamerica Pyramid',
    note: '1972',
    at: [-122.402785, 37.795167],
    w: 12,
    h: 28,
    from: 0,
    svg: `<path ${INK} d="M6 0 L11.5 27 H0.5 Z"/><path ${INK} d="M3.6 12 V8.5 H8.4 V12 Z"/>`,
  },
  {
    name: 'Salesforce Tower',
    note: '2018',
    at: [-122.396935, 37.789776],
    w: 9,
    h: 32,
    from: 10.6,
    svg: `<path ${INK} d="M0.5 32 V11 Q0.5 0.5 4.5 0.5 Q8.5 0.5 8.5 11 V32 Z"/>`,
  },
  {
    name: 'Sutro Tower',
    note: "the city's television mast, 1973",
    box: true,
    at: [-122.45286, 37.75524],
    w: 16,
    h: 30,
    from: 10.2,
    svg: `<path ${RED} stroke-width="1.3" d="M2 30 L6 13 L4 5 V0 M14 30 L10 13 L12 5 V0 M8 30 V0 M4 5 H12 M6 13 H10 M4 22 H12"/>`,
  },
  {
    name: 'Alcatraz',
    note: 'the prison island, 1934 to 1963',
    at: [-122.4228, 37.82685],
    w: 30,
    h: 15,
    from: 10.2,
    svg: `<path ${INK} d="M0 15 Q4 9 10 8 L22 7 Q27 9 30 15 Z"/><path ${INK} d="M9 4.5 H19 V8 H9 Z M21.3 0 H22.7 V7.5 H21.3 Z M4.5 3 H7 V5.5 H4.5 Z"/><path ${LINE} stroke-width="0.8" d="M5 5.5 V9 M6.5 5.5 V9"/>`,
  },
  {
    name: 'Palace of Fine Arts',
    note: '1915 exposition',
    at: [-122.44843, 37.80292],
    w: 30,
    h: 18,
    from: 11,
    // below its place: the Hawk Hill start and its name are just north of it, nearer or further with the zoom
    nudge: [0, -22],
    box: true,
    svg: `<path fill="#b5674b" d="M9 7.5 A6 6 0 0 1 21 7.5 Z"/><path ${INK} d="M8 7.5 H22 V9.5 H8 Z M0 17 H30 V18 H0 Z M0 11.5 H6 V12.6 H0 Z M24 11.5 H30 V12.6 H24 Z"/><path ${LINE} stroke-width="1.4" d="M9.5 9.5 V17 M13 9.5 V17 M17 9.5 V17 M20.5 9.5 V17"/><path ${LINE} stroke-width="0.9" d="M1 12.6 V17 M3 12.6 V17 M5 12.6 V17 M25 12.6 V17 M27 12.6 V17 M29 12.6 V17"/>`,
  },
  // ---- 2D only: places with no model
  {
    name: 'Sutro Baths and the Cliff House',
    note: 'the baths opened in 1896; ruins since 1966',
    at: [-122.51385, 37.7794],
    w: 30,
    h: 18,
    from: 11,
    only2d: true,
    svg: `<path ${INK} d="M0 18 V9 H12 L18 14 H30 V18 Z M2 4.5 H10 V9 H2 Z M1.2 3.4 H10.8 V4.8 H1.2 Z"/><path ${GREY} stroke-width="0.9" d="M19.5 14 V11.6 H23.5 V14 M25 14 V11.6 H29 V14"/>`,
  },
  {
    name: 'Coit Tower',
    note: 'Telegraph Hill, 1933',
    at: [-122.405834, 37.802379],
    w: 8,
    h: 26,
    from: 12,
    only2d: true,
    svg: `<path ${INK} d="M2.2 26 L2.6 6 H5.4 L5.8 26 Z M1.6 2.2 H6.4 V6 H1.6 Z M2.6 0.6 H5.4 V2.2 H2.6 Z"/><path fill="var(--page)" d="M2.5 3 H3.3 V5 H2.5 Z M3.7 3 H4.4 V5 H3.7 Z M4.8 3 H5.5 V5 H4.8 Z"/>`,
  },
  {
    name: 'Ferry Building',
    note: '1898',
    at: [-122.393474, 37.795548],
    w: 34,
    h: 22,
    from: 12,
    only2d: true,
    svg: `<path ${INK} d="M0 16 H34 V22 H0 Z M14.5 6 H19.5 V16 H14.5 Z M15.4 3 H18.6 V6 H15.4 Z M17 0 L18.4 3 H15.6 Z"/><circle cx="17" cy="9" r="1.5" fill="var(--page)"/><path fill="var(--page)" d="M2 18 H4 V22 H2 Z M6 18 H8 V22 H6 Z M10 18 H12 V22 H10 Z M22 18 H24 V22 H22 Z M26 18 H28 V22 H26 Z M30 18 H32 V22 H30 Z"/>`,
  },
  {
    name: 'Bay Bridge',
    note: 'opened 1936',
    at: [-122.3778, 37.7972],
    w: 44,
    h: 18,
    from: 10.4,
    only2d: true,
    svg: `<path ${GREY} stroke-width="1.1" d="M0 12 L7 3 Q11.5 11 16 3 L22 9.5 L28 3 Q32.5 11 37 3 L44 12"/><path ${GREY} stroke-width="1.9" d="M7 2 V17 M16 2 V17 M28 2 V17 M37 2 V17"/><path ${GREY} stroke-width="1.5" d="M0 13 H44"/><path ${INK} d="M20.5 9 H23.5 V17 H20.5 Z"/>`,
  },
  {
    name: 'The Campanile',
    note: 'Sather Tower, 1914',
    at: [-122.257831, 37.87206],
    w: 8,
    h: 30,
    from: 10.2,
    only2d: true,
    svg: `<path ${INK} d="M2 30 V9 H6 V30 Z M1.4 4.6 H6.6 V9 H1.4 Z M4 0 L6.6 4.6 H1.4 Z"/><path fill="var(--page)" d="M2.3 5.6 H3.1 V8 H2.3 Z M3.6 5.6 H4.4 V8 H3.6 Z M4.9 5.6 H5.7 V8 H4.9 Z"/>`,
  },
  {
    name: 'Mt Diablo summit',
    note: 'the summit building and its beacon',
    at: [-121.914267, 37.88183],
    w: 22,
    h: 16,
    from: 0,
    nudge: [0, 26],
    only2d: true,
    svg: `<path ${INK} d="M0 10 H22 V16 H0 Z M7 5 H15 V10 H7 Z M10 2 H12 V5 H10 Z"/><circle cx="11" cy="1.4" r="1.4" fill="#c4432b"/>`,
  },
  {
    name: 'The Stanford Dish',
    note: 'a radio telescope in the foothills',
    at: [-122.1794, 37.4083],
    w: 24,
    h: 22,
    from: 10.2,
    only2d: true,
    svg: `<path ${INK} d="M2 9 Q13 19 22 3 Q11 9 2 9 Z"/><path ${GREY} stroke-width="1.1" d="M12 8 L9 1 M13 13 L10 21.5 M13 13 L17 21.5 M8 21.5 H19"/>`,
  },
  {
    name: 'Alpine Dam',
    note: 'the ride crosses it',
    at: [-122.638701, 37.940135],
    w: 28,
    h: 14,
    from: 10.6,
    nudge: [0, 26],
    only2d: true,
    svg: `<path ${INK} d="M2 3.5 H26 L22 14 H6 Z"/><path fill="none" stroke="#7fa0a3" stroke-width="1.4" stroke-linecap="round" d="M0 2 H28"/><path fill="var(--page)" d="M12.5 3.5 H15.5 V7 H12.5 Z"/>`,
  },
  {
    name: 'Point Bonita Lighthouse',
    note: 'at the mouth of the Golden Gate',
    at: [-122.529548, 37.81559],
    w: 22,
    h: 20,
    from: 11,
    only2d: true,
    svg: `<path ${INK} d="M6 20 Q9 12 13 12 H17 Q20 14 22 20 Z M13.5 5.5 H16.5 V12 H13.5 Z M13.9 3 H16.1 V5.5 H13.9 Z M15 1.2 L16.6 3 H13.4 Z"/><path ${GREY} stroke-width="0.8" d="M0 12.5 Q5 15 10 12.8 M0 12.5 V14 M3.3 13.6 V15 M6.6 13.6 V15"/>`,
  },
  // ---- 2D only, the second batch
  {
    name: 'The Painted Ladies',
    note: 'Alamo Square, 1890s',
    at: [-122.432786, 37.776224],
    w: 30,
    h: 16,
    from: 12,
    only2d: true,
    svg: `<path ${INK} d="M1 16 V7 L4 2.5 L7 7 V16 Z M8 16 V7 L11 2.5 L14 7 V16 Z M15 16 V7 L18 2.5 L21 7 V16 Z M22 16 V7 L25 2.5 L28 7 V16 Z"/><path fill="var(--page)" d="M3 9 H5 V12 H3 Z M10 9 H12 V12 H10 Z M17 9 H19 V12 H17 Z M24 9 H26 V12 H24 Z"/>`,
  },
  {
    name: 'Conservatory of Flowers',
    note: 'Golden Gate Park, 1879',
    at: [-122.460227, 37.772607],
    w: 32,
    h: 16,
    from: 12,
    only2d: true,
    svg: `<path ${INK} d="M10 10.5 A6 7.5 0 0 1 22 10.5 Z M0 10.5 Q5 6.5 10 10.5 Z M22 10.5 Q27 6.5 32 10.5 Z M0 10.5 H32 V16 H0 Z M15.6 0 H16.4 V3.4 H15.6 Z"/><path fill="var(--page)" d="M2 12 H8 V13 H2 Z M12 12 H20 V13 H12 Z M24 12 H30 V13 H24 Z"/>`,
  },
  {
    name: 'The Dutch Windmill',
    note: 'Golden Gate Park, 1903',
    at: [-122.5095, 37.7705],
    w: 22,
    h: 26,
    from: 11.4,
    only2d: true,
    svg: `<path ${INK} d="M7.5 26 L9.5 10 H12.5 L14.5 26 Z M9 10 Q11 6 13 10 Z"/><path ${GREY} stroke-width="1.5" d="M2 1 L20 15 M20 1 L2 15"/>`,
  },
  {
    name: 'Fort Point',
    note: 'under the bridge, 1861',
    at: [-122.476882, 37.810486],
    w: 27,
    h: 12,
    from: 12.2,
    nudge: [-24, 0],
    only2d: true,
    svg: `<path fill="#9a5f4a" d="M0 4 H27 V12 H0 Z M0 2.5 H3 V4 H0 Z M6 2.5 H9 V4 H6 Z M12 2.5 H15 V4 H12 Z M18 2.5 H21 V4 H18 Z M24 2.5 H27 V4 H24 Z"/><path fill="var(--page)" d="M2 12 V9.5 Q3.5 7.5 5 9.5 V12 Z M7 12 V9.5 Q8.5 7.5 10 9.5 V12 Z M12 12 V9.5 Q13.5 7.5 15 9.5 V12 Z M17 12 V9.5 Q18.5 7.5 20 9.5 V12 Z M22 12 V9.5 Q23.5 7.5 25 9.5 V12 Z"/>`,
  },
  {
    name: 'Muir Woods',
    note: 'old-growth redwoods',
    at: [-122.572484, 37.892796],
    w: 18,
    h: 28,
    from: 10.6,
    only2d: true,
    svg: `<path ${INK} d="M4.2 20 H5.8 V28 H4.2 Z M12.3 22 H13.7 V28 H12.3 Z"/><path fill="#6f7d55" d="M5 0 L9 21 H1 Z M13 7 L16.5 23 H9.5 Z"/>`,
  },
  {
    name: 'Marin Civic Center',
    note: 'Frank Lloyd Wright, 1962',
    at: [-122.530657, 37.998027],
    w: 36,
    h: 16,
    from: 10.2,
    only2d: true,
    svg: `<path fill="#6f93a8" d="M0 9 Q18 3.5 36 9 V10.2 H0 Z"/><path ${INK} d="M0 10.2 H36 V16 H0 Z"/><path fill="var(--page)" d="M1.5 14 V12 Q3.0 10.4 4.5 12 V14 Z M5.8 14 V12 Q7.3 10.4 8.8 12 V14 Z M10.1 14 V12 Q11.6 10.4 13.1 12 V14 Z M14.4 14 V12 Q15.9 10.4 17.4 12 V14 Z M18.7 14 V12 Q20.2 10.4 21.7 12 V14 Z M23.0 14 V12 Q24.5 10.4 26.0 12 V14 Z M27.3 14 V12 Q28.8 10.4 30.3 12 V14 Z M31.6 14 V12 Q33.1 10.4 34.6 12 V14 Z"/><path fill="#c9a54a" d="M23.1 6.2 L24 0 L24.9 6.2 Z"/>`,
  },
  {
    name: 'The Oakland cranes',
    note: 'Port of Oakland',
    box: true,
    at: [-122.3225, 37.8005],
    w: 28,
    h: 24,
    from: 10.8,
    only2d: true,
    svg: `<path ${GREY} stroke-width="1.3" d="M2 24 V9 M8 24 V9 M0 9 H10 M2 15 H8 M8 9 L15 2 M5 9 V4 L8 9 M5 4 L15 2"/><g transform="translate(13 0)"><path ${GREY} stroke-width="1.3" d="M2 24 V9 M8 24 V9 M0 9 H10 M2 15 H8 M8 9 L15 2 M5 9 V4 L8 9 M5 4 L15 2"/></g>`,
  },
  {
    name: 'Hoover Tower',
    note: 'Stanford, 1941',
    at: [-122.166994, 37.427615],
    w: 12,
    h: 30,
    from: 11.2,
    only2d: true,
    svg: `<path ${INK} d="M3.5 30 V9 H8.5 V30 Z M2.5 6.5 H9.5 V9 H2.5 Z M3.5 4 H8.5 V6.5 H3.5 Z M5.7 0 H6.3 V1.6 H5.7 Z"/><path fill="#b5674b" d="M3.5 4 A2.5 2.8 0 0 1 8.5 4 Z"/><path fill="var(--page)" d="M4.2 4.6 H5 V6 H4.2 Z M5.6 4.6 H6.4 V6 H5.6 Z M7 4.6 H7.8 V6 H7 Z"/>`,
  },
  {
    name: "Alice's Restaurant",
    note: 'Skyline at Highway 84',
    at: [-122.265398, 37.386691],
    w: 22,
    h: 14,
    from: 10.8,
    nudge: [24, 12],
    only2d: true,
    svg: `<path ${INK} d="M0 7 L11 1 L22 7 Z M2 7 H20 V14 H2 Z M15.5 1 H17.5 V5 H15.5 Z"/><path fill="var(--page)" d="M4 9 H7 V14 H4 Z M9.5 9 H12.5 V12 H9.5 Z M15 9 H18 V12 H15 Z"/>`,
  },
];

/** in 3D the grown models already read at zoom 10.5, so the drawings are for the home view only; 2D has no models, so there they stay */
const MODELS_FROM = 9.9;

/**
 * The drawings are decoration and the rides are what the map is for, so a drawing never takes a hover or a click from
 * a ride: over a ride's line it stays silent and the click goes to the ride. Hovering one names it, in the rides' own
 * tooltip. A click moves nothing in 2D (it shows the same tooltip, which is what a tap gets); in 3D, where a drawing
 * stands in for a model at the home view, it flies to the model's postcard.
 */
export function addLandmarkMarks(map: MlMap): Marker[] {
  const tip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'ride-tip', anchor: 'bottom', maxWidth: 'none' });
  let pinned = false;
  let justPinned = false;
  let shown: Mark | null = null;
  const overRide = (e: MouseEvent) => {
    if (!map.getLayer(LYR.routeHit)) return false;
    const box = map.getContainer().getBoundingClientRect();
    return map.queryRenderedFeatures([e.clientX - box.left, e.clientY - box.top], { layers: [LYR.routeHit] }).length > 0;
  };
  const show = (m: Mark) => {
    shown = m;
    tip
      .setLngLat(m.at)
      .setOffset([m.nudge?.[0] ?? 0, -(m.h + (m.nudge?.[1] ?? 0) + 6)])
      .setHTML(`<span>${esc(m.name)}</span><small>${esc(m.note)}</small>`)
      .addTo(map);
  };
  const hide = () => {
    pinned = false;
    shown = null;
    tip.remove();
  };
  const made = MARKS.map((m) => {
    const el = document.createElement('div');
    el.className = 'mk lm';
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', m.name);
    const hitBox = m.box ? `<rect width="${m.w}" height="${m.h}" fill="none"/>` : '';
    el.innerHTML = `<svg width="${m.w}" height="${m.h}" viewBox="0 0 ${m.w} ${m.h}" aria-hidden="true">${hitBox}${m.svg}</svg>`;
    // set through the CSSOM, which the page's CSP allows where it would refuse a style attribute
    if (m.nudge) (el.firstElementChild as SVGElement).style.transform = `translate(calc(-50% + ${m.nudge[0]}px), calc(-100% - ${m.nudge[1]}px))`;
    el.addEventListener('mousemove', (e) => {
      if (overRide(e)) {
        if (!pinned) hide();
      } else if (shown !== m) {
        pinned = false;
        show(m);
      }
    });
    el.addEventListener('mouseleave', () => {
      if (!pinned) hide();
    });
    el.addEventListener('click', (e) => {
      if (overRide(e)) return;
      if (map.getTerrain() != null && !m.only2d) {
        hide();
        import('./landmarks3d').then(({ postcardOf }) => {
          const view = postcardOf(m.name);
          if (view) map.flyTo({ ...view, duration: reducedMotion() ? 0 : 2200 });
        });
        return;
      }
      show(m);
      pinned = justPinned = true;
    });
    return { m, el, marker: new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(m.at).addTo(map) };
  });
  // a click on a drawing reaches the map as well: that one keeps the tooltip it has just pinned, any other lets it go
  map.on('click', () => {
    if (!justPinned) hide();
    justPinned = false;
  });
  map.on('movestart', hide);
  const paint = () => {
    const z = map.getZoom(), models = map.getTerrain() != null;
    for (const { m, el } of made) {
      el.classList.toggle('off', z < m.from || (models && (m.only2d === true || z >= MODELS_FROM)));
      el.classList.toggle('go', models && !m.only2d);
    }
  };
  map.on('zoom', paint);
  map.on('terrain', paint);
  paint();
  return made.map((x) => x.marker);
}
