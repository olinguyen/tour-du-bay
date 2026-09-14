/** Escape text for interpolation into the HTML strings Leaflet icons and tooltips take. */
export const esc = (s: string | number) =>
  String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

export const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export const scrollBehavior = (): ScrollBehavior => (reducedMotion() ? 'auto' : 'smooth');

/** localStorage that tolerates being unavailable (private modes, blocked site data). */
export const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* not persisted; fine */
    }
  },
};
