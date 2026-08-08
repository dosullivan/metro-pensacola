import { describe, expect, it } from 'vitest';
import { DEFAULT_ASSUMPTIONS } from '../src/data/assumptions';
import {
  coordinateAtDistance,
  vehiclePositionsForLine
} from '../src/simulation/animation';
import { distanceMiles, lineMileage } from '../src/simulation/geo';
import type { TransitLine } from '../src/types';

const line: TransitLine = {
  id: 'animation-line',
  name: 'Animation Line',
  technology: 'brt',
  color: DEFAULT_ASSUMPTIONS.technologies.brt.color,
  headwayMinutes: 10,
  geometry: [[-87.3, 30.4], [-87.2, 30.4], [-87.2, 30.45]],
  stations: []
};

describe('vehicle animation geometry', () => {
  it('interpolates by geographic distance rather than vertex index', () => {
    const firstSegmentMiles = distanceMiles(line.geometry[0], line.geometry[1]);
    const coordinate = coordinateAtDistance(line.geometry, firstSegmentMiles / 2);

    expect(coordinate?.[0]).toBeCloseTo(-87.25, 5);
    expect(coordinate?.[1]).toBeCloseTo(30.4, 5);
  });

  it('clamps before the start and after the end of the route', () => {
    expect(coordinateAtDistance(line.geometry, -10)).toEqual(line.geometry[0]);
    expect(coordinateAtDistance(line.geometry, lineMileage(line.geometry) + 10)).toEqual(
      line.geometry[line.geometry.length - 1]
    );
  });

  it('moves deterministically out and back with fleet size derived from headway', () => {
    const speed = DEFAULT_ASSUMPTIONS.technologies.brt.averageSpeedMph;
    const initial = vehiclePositionsForLine(line, speed, 0);
    const later = vehiclePositionsForLine(line, speed, 30);
    const repeated = vehiclePositionsForLine(line, speed, 30);

    expect(initial.length).toBeGreaterThan(1);
    expect(later).toEqual(repeated);
    expect(later[0].coordinate).not.toEqual(initial[0].coordinate);
    expect(new Set(initial.map((vehicle) => vehicle.direction))).toEqual(
      new Set(['outbound', 'inbound'])
    );
  });

  it('moves each vehicle at the supplied technology speed', () => {
    const slow = vehiclePositionsForLine(line, 20, 60)[0];
    const fast = vehiclePositionsForLine(line, 40, 60)[0];
    const slowMiles = distanceMiles(line.geometry[0], slow.coordinate);
    const fastMiles = distanceMiles(line.geometry[0], fast.coordinate);

    expect(slowMiles).toBeCloseTo(20 / 60, 4);
    expect(fastMiles).toBeCloseTo(40 / 60, 4);
  });

  it('returns no vehicles for an empty or zero-length route', () => {
    expect(vehiclePositionsForLine({ ...line, geometry: [] }, 20, 0)).toEqual([]);
    expect(vehiclePositionsForLine({ ...line, geometry: [[-87.2, 30.4]] }, 20, 0)).toEqual([]);
  });
});
