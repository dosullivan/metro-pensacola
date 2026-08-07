import type { SimulationAssumptions, SimulationZone } from '../types';
import { distanceMiles } from './geo';

export interface OdDemand {
  originZoneId: string;
  destinationZoneId: string;
  originIndex: number;
  destinationIndex: number;
  distanceMiles: number;
  dailyTrips: number;
}

export function createDemandMatrix(zones: SimulationZone[], assumptions: SimulationAssumptions): OdDemand[] {
  const rawPairs: Array<Omit<OdDemand, 'dailyTrips'> & { weight: number }> = [];
  let totalWeight = 0;

  zones.forEach((origin, originIndex) => {
    zones.forEach((destination, destinationIndex) => {
      if (origin.id === destination.id || origin.population <= 0 || destination.jobs <= 0) {
        return;
      }

      const crowDistance = distanceMiles(origin.centroid, destination.centroid);
      const effectiveDistance = Math.max(crowDistance, assumptions.minimumGravityDistanceMiles);
      const weight =
        (origin.population * destination.jobs) / effectiveDistance ** assumptions.gravityDistanceExponent;

      rawPairs.push({
        originZoneId: origin.id,
        destinationZoneId: destination.id,
        originIndex,
        destinationIndex,
        distanceMiles: crowDistance,
        weight
      });
      totalWeight += weight;
    });
  });

  if (totalWeight === 0) {
    return [];
  }

  return rawPairs.map(({ weight, ...pair }) => ({
    ...pair,
    dailyTrips: (weight / totalWeight) * assumptions.totalDailyRegionalTrips
  }));
}
