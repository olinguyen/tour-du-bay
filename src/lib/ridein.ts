// Whether the reader rides in from a ride's alternative start (the nearest station, or the Panhandle for the Marin
// rides) or starts where the ride itself does. One choice for the whole guide, kept across visits like the units:
// a reader who comes by train comes by train to every ride.
import { storage } from './html';
import { createStore, useStore } from './store';

const KEY = 'tdb.ridein';

export const rideIn = createStore<boolean>(storage.get(KEY) === '1');

export function setRideIn(on: boolean) {
  rideIn.set(on);
  storage.set(KEY, on ? '1' : '0');
}

export const useRideIn = () => useStore(rideIn);
