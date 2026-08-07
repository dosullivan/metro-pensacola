import type { SimulationAssumptions, SimulationZone, ZoneResults } from '../types';
import { clamp, distanceMiles } from './geo';

export function projectDevelopment(
  zones: SimulationZone[],
  accessibilityScores: Map<string, number>,
  zoneTransitTrips: Map<string, number>,
  assumptions: SimulationAssumptions,
  years: number
): ZoneResults[] {
  const maxTransitTrips = Math.max(...Array.from(zoneTransitTrips.values()), 1);
  const periods = years / 5;

  return zones.map((zone) => {
    const accessibility = accessibilityScores.get(zone.id) ?? 0;
    const transitSuccess = (zoneTransitTrips.get(zone.id) ?? 0) / maxTransitTrips;
    const downtownMiles = Math.max(distanceMiles(zone.centroid, assumptions.downtownCoordinate), 0.25);
    const downtownPull = clamp(1 / (downtownMiles / 5), 0, 1);
    const developmentPressure = clamp(
      accessibility * 0.55 + transitSuccess * 0.25 + downtownPull * 0.2,
      0,
      1
    );
    const growth = assumptions.developmentGrowthRatePerFiveYears * periods * zone.developmentCapacity * developmentPressure;

    return {
      zoneId: zone.id,
      accessibilityScore: accessibility,
      transitTrips: zoneTransitTrips.get(zone.id) ?? 0,
      developmentPressure,
      populationGrowth: Math.round(zone.population * growth),
      jobsGrowth: Math.round(zone.jobs * growth * 0.85),
      housingGrowth: Math.round((zone.housingUnits ?? zone.households) * growth),
      landValueGrowth: zone.landValueIndex * developmentPressure * 0.065 * periods
    };
  });
}

export function applyDevelopmentGrowth(zones: SimulationZone[], zoneResults: ZoneResults[]): SimulationZone[] {
  const resultByZone = new Map(zoneResults.map((result) => [result.zoneId, result]));

  return zones.map((zone) => {
    const result = resultByZone.get(zone.id);
    if (!result) {
      return zone;
    }

    const population = zone.population + result.populationGrowth;
    const jobs = zone.jobs + result.jobsGrowth;
    const housingUnits = (zone.housingUnits ?? zone.households) + result.housingGrowth;
    return {
      ...zone,
      population,
      jobs,
      households: Math.round(population / 2.28),
      housingUnits,
      commercialSqFt: (zone.commercialSqFt ?? zone.jobs * 340) + result.jobsGrowth * 340,
      landValueIndex: zone.landValueIndex + result.landValueGrowth
    };
  });
}
