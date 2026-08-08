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
      accessibility * assumptions.developmentAccessibilityWeight +
        transitSuccess * assumptions.developmentTransitSuccessWeight +
        downtownPull * assumptions.developmentDowntownWeight,
      0,
      1
    );
    let remainingPeriods = periods;
    let remainingCapacity = zone.developmentCapacity;
    let growthFactor = 1;
    while (remainingPeriods > 0 && remainingCapacity > 0) {
      const periodFraction = Math.min(1, remainingPeriods);
      const periodGrowth =
        assumptions.developmentGrowthRatePerFiveYears *
        periodFraction *
        remainingCapacity *
        developmentPressure;
      growthFactor *= 1 + periodGrowth;
      remainingCapacity = Math.max(0, remainingCapacity - periodGrowth);
      remainingPeriods -= periodFraction;
    }
    const growth = growthFactor - 1;
    const landValueGrowthFactor =
      (1 + developmentPressure * 0.065) ** periods - 1;

    return {
      zoneId: zone.id,
      accessibilityScore: accessibility,
      transitTrips: zoneTransitTrips.get(zone.id) ?? 0,
      developmentPressure,
      populationGrowth: Math.round(zone.population * growth),
      jobsGrowth: Math.round(zone.jobs * growth * assumptions.developmentJobsGrowthFactor),
      housingGrowth: Math.round((zone.housingUnits ?? zone.households) * growth),
      landValueGrowth: zone.landValueIndex * landValueGrowthFactor,
      developmentCapacityUsed: zone.developmentCapacity - remainingCapacity
    };
  });
}

export function applyDevelopmentGrowth(
  zones: SimulationZone[],
  zoneResults: ZoneResults[],
  assumptions: SimulationAssumptions
): SimulationZone[] {
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
      households: Math.round(population / assumptions.averageHouseholdSize),
      housingUnits,
      commercialSqFt:
        (zone.commercialSqFt ?? zone.jobs * assumptions.commercialSqFtPerJob) +
        result.jobsGrowth * assumptions.commercialSqFtPerJob,
      landValueIndex: zone.landValueIndex + result.landValueGrowth,
      developmentCapacity: Math.max(0, zone.developmentCapacity - result.developmentCapacityUsed)
    };
  });
}
