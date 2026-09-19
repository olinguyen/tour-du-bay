// Which units the guide shows. Every route is measured in miles and feet; this module is the one place that turns
// those into what a reader sees, so the toggle changes every figure on the page at once.
import { storage } from './html';
import { createStore, useStore } from './store';
import { FT_PER_M, KM_PER_MI } from './units.mjs';

export type Unit = 'imperial' | 'metric';

const KEY = 'tdb.units';

/** the reader's choice, kept across visits; anything unrecognised (or unreadable storage) falls back to miles */
export const units = createStore<Unit>(storage.get(KEY) === 'metric' ? 'metric' : 'imperial');

export function setUnits(u: Unit) {
  units.set(u);
  storage.set(KEY, u);
}

export const useUnits = () => useStore(units);

export const distUnit = (u: Unit) => (u === 'metric' ? 'km' : 'mi');
export const elevUnit = (u: Unit) => (u === 'metric' ? 'm' : 'ft');
/** spelled out, for the labels screen readers announce */
export const distWord = (u: Unit) => (u === 'metric' ? 'kilometres' : 'miles');
export const elevWord = (u: Unit) => (u === 'metric' ? 'metres' : 'feet');

const group = (n: number) => n.toLocaleString('en-US');

/** A measured distance (held in miles) to a tenth. The guide measures its routes, so it shows the measured figure. */
export const dist = (mi: number, u: Unit) => (u === 'metric' ? mi * KM_PER_MI : mi).toFixed(1);

/** A height or a climb (held in feet), to the nearest whole unit. */
export const elev = (ft: number, u: Unit) => group(Math.round(u === 'metric' ? ft / FT_PER_M : ft));

/**
 * The same, rounded off: the headline figures and the leg table round away a precision the terrain model doesn't
 * have. Ten feet and five metres are about the same step, so both read as deliberate rather than converted.
 */
export const elevCoarse = (ft: number, u: Unit) => {
  const step = u === 'metric' ? 5 : 10;
  const v = u === 'metric' ? ft / FT_PER_M : ft;
  return group(Math.round(v / step) * step);
};
