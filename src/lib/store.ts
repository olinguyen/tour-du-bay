import { useSyncExternalStore } from 'react';

/** A minimal external store, for values that change every frame and should only re-render their subscribers. */
export interface Store<T> {
  get(): T;
  set(next: T): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) return;
      value = next;
      listeners.forEach(l => l());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get);
}

/** Where the rider is along the route: a fraction of total distance. `soft` positions (hovering a photo) don't highlight nearby photos. */
export type Scrub = { f: number; soft: boolean } | null;
