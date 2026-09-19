// The numbers a reader can add up: whatever the route card lists has to come to what the headline says.
import { describe, expect, it } from 'vitest';
import { legs } from '../lib/route';
import { RIDES } from './guide';

describe('every ride in the guide', () => {
  for (const r of RIDES) {
    describe(r.slug, () => {
      const card = legs(r);
      const total = (of: (l: (typeof card.legs)[number]) => number) => card.legs.reduce((s, l) => s + of(l), 0);

      it('has legs covering the whole distance and the whole climb', () => {
        expect(total(l => l.mi)).toBeCloseTo(r.lengthMi, 9);
        expect(total(l => l.gain)).toBeCloseTo(r.feet, 0);
      });

      it('starts and ends at the same height, and descends what it climbs', () => {
        // every ride here is a loop; a point-to-point one would end lower or higher than it began
        expect(card.loop).toBe(true);
        expect(r.profile[r.profile.length - 1][1]).toBe(r.profile[0][1]);
        expect(total(l => l.loss)).toBeCloseTo(r.feet, 0);
      });
    });
  }
});
