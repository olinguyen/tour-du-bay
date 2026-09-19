import { describe, expect, it, vi } from 'vitest';
import { createStore } from './store';

describe('createStore', () => {
  it('notifies subscribers of a new value', () => {
    const s = createStore(1), l = vi.fn();
    s.subscribe(l);
    s.set(2);
    expect(s.get()).toBe(2);
    expect(l).toHaveBeenCalledTimes(1);
  });
  it('skips notifying when the value is Object.is-equal', () => {
    const o = { f: 0.5 }, s = createStore<{ f: number } | null>(o), l = vi.fn();
    s.subscribe(l);
    s.set(o);
    expect(l).not.toHaveBeenCalled();
    s.set({ f: 0.5 }); // a fresh object is a change
    expect(l).toHaveBeenCalledTimes(1);
  });
  it('stops notifying after unsubscribe', () => {
    const s = createStore('a'), l = vi.fn(), off = s.subscribe(l);
    s.set('b');
    off();
    s.set('c');
    expect(l).toHaveBeenCalledTimes(1);
    expect(s.get()).toBe('c');
  });
});
