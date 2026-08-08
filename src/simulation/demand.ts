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

function regionalTotals(zones: SimulationZone[]): { population: number; jobs: number } {
  return zones.reduce(
    (totals, zone) => ({
      population: totals.population + zone.population,
      jobs: totals.jobs + zone.jobs
    }),
    { population: 0, jobs: 0 }
  );
}

export function calculateDailyRegionalTrips(
  baseZones: SimulationZone[],
  zones: SimulationZone[],
  assumptions: SimulationAssumptions
): number {
  const base = regionalTotals(baseZones);
  const current = regionalTotals(zones);
  const populationFactor = base.population > 0 ? current.population / base.population : 1;
  const jobsFactor = base.jobs > 0 ? current.jobs / base.jobs : 1;
  return assumptions.totalDailyRegionalTrips * (populationFactor + jobsFactor) / 2;
}

export function createDemandMatrix(
  zones: SimulationZone[],
  assumptions: SimulationAssumptions,
  baseZones: SimulationZone[] = zones
): OdDemand[] {
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

  const dailyRegionalTrips = calculateDailyRegionalTrips(baseZones, zones, assumptions);
  return rawPairs.map(({ weight, ...pair }) => ({
    ...pair,
    dailyTrips: (weight / totalWeight) * dailyRegionalTrips
  }));
}
