import { describe, expect, it } from 'vitest';
import { esc, reducedMotion, scrollBehavior, storage } from './html';

describe('esc', () => {
  it('encodes every HTML-significant character', () => {
    expect(esc('<a href="x">&\'')).toBe('&#60;a href=&#34;x&#34;&#62;&#38;&#39;');
    expect(esc(42)).toBe('42');
    expect(esc('plain text')).toBe('plain text');
  });
});

describe('storage', () => {
  it('reads null and writes nothing without throwing when localStorage is unavailable', () => {
    // node has no usable localStorage here (absent, or present but unbacked on newer versions)
    expect(storage.get('k')).toBeNull();
    expect(() => storage.set('k', 'v')).not.toThrow();
  });
});

describe('motion', () => {
  it('assumes full motion when matchMedia is missing', () => {
    expect(reducedMotion()).toBe(false);
    expect(scrollBehavior()).toBe('smooth');
  });
});
