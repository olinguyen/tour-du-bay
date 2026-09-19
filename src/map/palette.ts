// Route colours live in the stylesheet (--route / --ac and their hot variants). MapLibre draws the routes in WebGL,
// where CSS can't reach them, so the values are read back from the document once and handed to the paint expressions.
import { AREAS } from '../data/guide';
import type { Area } from '../data/types';
import { areaSlug } from '../lib/route';

export interface Palette {
  /** per-area line colour and its hot variant, keyed by area slug */
  area: Record<string, { base: string; hot: string }>;
  halo: string;
  /** the colour the rider dot, climbs and legs take when no area applies */
  route: string;
  routeHot: string;
}

/** read custom properties off an element that carries the same classes and data-area the map's SVG used to */
function read(el: Element, ...names: string[]): string[] {
  const cs = getComputedStyle(el);
  return names.map(n => cs.getPropertyValue(n).trim());
}

/**
 * Resolve the palette from the live stylesheet. `body.regions` colours routes by area; without it every route takes
 * the single --route pair, so each area resolves to the same colour and the expressions below need no special case.
 */
export function palette(): Palette {
  const [route, routeHot, halo] = read(document.documentElement, '--route', '--route-hot', '--halo');
  const regions = document.body.classList.contains('regions');
  const probe = document.createElement('div');
  probe.style.display = 'none';
  document.body.appendChild(probe);
  const area: Palette['area'] = {};
  for (const a of AREAS) {
    const slug = areaSlug(a as Area);
    if (!regions) {
      area[slug] = { base: route, hot: routeHot };
      continue;
    }
    probe.setAttribute('data-area', slug);
    const [base, hot] = read(probe, '--ac', '--ac-hot');
    area[slug] = { base: base || route, hot: hot || routeHot };
  }
  probe.remove();
  return { area, halo: halo || 'rgba(241,234,217,.75)', route, routeHot };
}
