import type { Crop, CropPointSuitability } from '@/core/models';
import { statusCode } from '@/core/services/crop-data.service';
import { cycleMonths, cyclesOverlap } from '@/core/services/plan.service';

import { considerations, endOf, windowsFor } from './planning';

const crop: Crop = {
  id: 1971,
  name: 'Papa',
  shortName: 'PA',
  scientificName: 'Solanum tuberosum',
  temp: { optMin: 15, optMax: 25, tolMin: 7, tolMax: 30 },
  rain: { optMin: 500, optMax: 800, tolMin: 250, tolMax: 2000 },
  growingDays: [90, 160],
  cycleMonths: 3,
  rainDurationMonths: 5,
  drainage: null,
};

// Thermal: Jan–Jun favorable, Jul caution, rest favorable; rain: favorable starts in Nov and Dec.
const s: CropPointSuitability = {
  t: Array.from({ length: 12 }, (_, i) => [20, i === 6 ? 1 : 2] as [number, 2 | 1]),
  tw: [[1, 6, 3, [[1, 3], [4, 6]]]],
  r: Array.from({ length: 12 }, (_, i) => [i >= 10 ? 700 : 1500, i >= 10 ? 2 : 1] as [number, 2 | 1]),
  rw: [[11, 12]],
  a: [3000, 0],
};

describe('plan cycle months', () => {
  it('wraps past December', () => {
    expect(cycleMonths({ startMonth: 11, durationMonths: 4 })).toEqual([11, 12, 1, 2]);
    expect(endOf(11, 4)).toBe(2);
  });

  it('detects overlaps across the year boundary', () => {
    expect(cyclesOverlap({ startMonth: 11, durationMonths: 4 }, { startMonth: 2, durationMonths: 2 })).toBe(true);
    expect(cyclesOverlap({ startMonth: 11, durationMonths: 3 }, { startMonth: 2, durationMonths: 2 })).toBe(false);
  });
});

describe('ECOCROP windows', () => {
  it('builds thermal cycles and rainfall planting starts', () => {
    const [thermal, rain] = windowsFor(crop, s);
    expect(thermal.cycles.map(c => [c.startMonth, c.endMonth])).toEqual([
      [1, 3],
      [4, 6],
    ]);
    expect(rain.source).toBe('rainfall');
    expect(rain.cycles.map(c => [c.startMonth, c.endMonth])).toEqual([
      [11, 3],
      [12, 4],
    ]);
  });

  it('adds notes from the other assessment only', () => {
    // Thermal cycle starting in January: rain for a January start is caution, annual rain unfavorable.
    expect(considerations(crop, s, 'thermal', 1, 3)).toHaveLength(2);
    // A rainfall start in March covers Mar–Jul, which includes the caution month (July).
    expect(considerations(crop, s, 'rainfall', 3, 5)[0]).toContain('Jul');
    expect(considerations(crop, s, 'rainfall', 11, 5)).toEqual([]);
  });

  it('maps statuses to map codes', () => {
    expect(statusCode(s, 'thermal', 'month', 7)).toBe(1);
    expect(statusCode(s, 'thermal', 'normal', 1)).toBe(11);
    expect(statusCode(s, 'rain', 'month', 12)).toBe(2);
    expect(statusCode(s, 'rain', 'normal', 1)).toBe(0);
  });
});
