import { describe, expect, it } from 'vitest';
import { CSP, DEM_HOST } from './csp';

// These two directives are the ones that took the live map down after the MapLibre migration:
// the tiles are fetched rather than loaded as images, and the tile worker comes from a blob URL.
describe('CSP', () => {
  const directive = (name: string) =>
    CSP.split('; ').find(d => d.startsWith(`${name} `))?.slice(name.length + 1) ?? '';

  it('lets the DEM host be fetched, not just drawn', () => {
    expect(directive('connect-src')).toContain(DEM_HOST);
    expect(directive('img-src')).toContain(DEM_HOST);
  });

  it('lets MapLibre start its worker from a blob URL', () => {
    expect(directive('worker-src')).toContain('blob:');
    expect(directive('child-src')).toContain('blob:');
  });

  it('keeps blob: and the DEM host out of script-src', () => {
    expect(directive('script-src')).toBe("'self'");
  });

  it('still locks down the directives that have no reason to widen', () => {
    expect(directive('object-src')).toBe("'none'");
    expect(directive('base-uri')).toBe("'self'");
    expect(directive('form-action')).toBe("'none'");
    expect(directive('default-src')).toBe("'self'");
  });
});
