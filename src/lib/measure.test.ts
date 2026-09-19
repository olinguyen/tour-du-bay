// The guide measures every route in miles and feet; these are the conversions a reader actually sees.
import { describe, expect, it } from 'vitest';
import { dist, distUnit, distWord, elev, elevCoarse, elevUnit, elevWord } from './measure';

describe('distance', () => {
  it('shows the measured figure to a tenth, in either unit', () => {
    expect(dist(19.848, 'imperial')).toBe('19.8');
    expect(dist(17, 'imperial')).toBe('17.0');
    expect(dist(10, 'metric')).toBe('16.1');
  });
});

describe('elevation', () => {
  it('converts feet to whole metres, grouped', () => {
    expect(elev(4900, 'imperial')).toBe('4,900');
    expect(elev(4900, 'metric')).toBe('1,494');
  });

  it('rounds the headline figures off by a comparable step in each unit', () => {
    expect(elevCoarse(4904, 'imperial')).toBe('4,900');
    // ~1493.5 m, to the nearest 5
    expect(elevCoarse(4900, 'metric')).toBe('1,495');
  });
});

describe('labels', () => {
  it('names both units, short and spelled out', () => {
    expect([distUnit('imperial'), elevUnit('imperial')]).toEqual(['mi', 'ft']);
    expect([distUnit('metric'), elevUnit('metric')]).toEqual(['km', 'm']);
    expect([distWord('metric'), elevWord('metric')]).toEqual(['kilometres', 'metres']);
  });
});
