import type { CatchmentStats, SimulationAssumptions, SimulationZone, Station, TransitLine } from '../types';
import { distanceMiles } from './geo';

export function calculateStationCatchment(
  station: Station,
  zones: SimulationZone[],
  assumptions: SimulationAssumptions
): CatchmentStats {
  const stats: CatchmentStats = {
    populationHalfMile: 0,
    jobsHalfMile: 0,
    populationOneMile: 0,
    jobsOneMile: 0,
    zoneIdsHalfMile: [],
    zoneIdsOneMile: []
  };

  for (const zone of zones) {
    const miles = distanceMiles(station.coordinate, zone.centroid);
    if (miles <= assumptions.extendedCatchmentMiles) {
      stats.populationOneMile += zone.population;
      stats.jobsOneMile += zone.jobs;
      stats.zoneIdsOneMile.push(zone.id);
    }
    if (miles <= assumptions.walkCatchmentMiles) {
      stats.populationHalfMile += zone.population;
      stats.jobsHalfMile += zone.jobs;
      stats.zoneIdsHalfMile.push(zone.id);
    }
  }

  return stats;
}

export function calculateSystemCatchment(
  lines: TransitLine[],
  zones: SimulationZone[],
  assumptions: SimulationAssumptions
): { population: number; jobs: number; zoneIds: string[] } {
  const stationCoordinates = lines.flatMap((line) => line.stations.map((station) => station.coordinate));
  const zoneIds: string[] = [];
  let population = 0;
  let jobs = 0;

  for (const zone of zones) {
    const isInCatchment = stationCoordinates.some(
      (coordinate) => distanceMiles(coordinate, zone.centroid) <= assumptions.walkCatchmentMiles
    );
    if (isInCatchment) {
      zoneIds.push(zone.id);
      population += zone.population;
      jobs += zone.jobs;
    }
  }

  return { population, jobs, zoneIds };
}

export function stationDevelopmentPotential(
  station: Station,
  zones: SimulationZone[],
  assumptions: SimulationAssumptions
): number {
  const nearbyZones = zones.filter(
    (zone) => distanceMiles(station.coordinate, zone.centroid) <= assumptions.extendedCatchmentMiles
  );
  if (nearbyZones.length === 0) {
    return 0;
  }

  const weightedCapacity = nearbyZones.reduce((sum, zone) => {
    const activity = zone.population + zone.jobs;
    return sum + zone.developmentCapacity * Math.log1p(activity);
  }, 0);

  return weightedCapacity / nearbyZones.length;
}
