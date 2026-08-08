import type {
  LineResults,
  Scenario,
  SimulationMessage,
  SimulationResults,
  SimulationZone,
  StationResults,
  ZoneResults
} from '../types';
import {
  calculateAnnualizedCapitalCost,
  calculateAnnualOperatingCost,
  calculateConstructionCost,
  calculateLineMileage,
  calculateScenarioCapitalCost,
  calculateScenarioOperatingCost
} from './costs';
import { calculateStationCatchment, calculateSystemCatchment, stationDevelopmentPotential } from './catchment';
import { estimateNetworkRidership } from './ridership';
import { calculateAccessibilityScores } from './accessibility';
import { applyDevelopmentGrowth, projectDevelopment } from './development';
import { calculateDailyRegionalTrips } from './demand';
import { distanceMiles } from './geo';

function lineResults(
  scenario: Scenario,
  ridershipByLine: Map<string, number>
): LineResults[] {
  return scenario.lines.map((line) => {
    const mileage = calculateLineMileage(line);
    const weekdayRidership = ridershipByLine.get(line.id) ?? 0;
    return {
      lineId: line.id,
      lineName: line.name,
      technology: line.technology,
      mileage,
      stationCount: line.stations.length,
      constructionCost: calculateConstructionCost(line, scenario.assumptions),
      operatingCost: calculateAnnualOperatingCost(line, scenario.assumptions),
      weekdayRidership,
      ridersPerMile: mileage > 0 ? weekdayRidership / mileage : 0
    };
  });
}

function stationResults(
  scenario: Scenario,
  zones: SimulationZone[],
  zoneResults: ZoneResults[],
  entries: Map<string, number>,
  exits: Map<string, number>,
  transfers: Map<string, number>
): StationResults[] {
  const developmentByZone = new Map(zoneResults.map((result) => [result.zoneId, result]));

  return scenario.lines.flatMap((line) =>
    line.stations.map((station) => {
      const catchment = calculateStationCatchment(station, zones, scenario.assumptions);
      const catchmentDevelopment = catchment.zoneIdsOneMile.reduce((sum, zoneId) => {
        const zoneResult = developmentByZone.get(zoneId);
        return sum + (zoneResult?.developmentPressure ?? 0);
      }, 0);

      return {
        stationId: station.id,
        lineId: line.id,
        stationName: station.name,
        entries: entries.get(station.id) ?? 0,
        exits: exits.get(station.id) ?? 0,
        transfers: transfers.get(station.id) ?? 0,
        nearbyPopulation: catchment.populationHalfMile,
        nearbyJobs: catchment.jobsHalfMile,
        catchment,
        developmentPotential:
          stationDevelopmentPotential(station, zones, scenario.assumptions) + catchmentDevelopment / 10
      };
    })
  );
}

export function nearestStationIdWithinRadius(
  scenario: Scenario,
  coordinate: [number, number],
  radiusMiles: number
): string | undefined {
  return scenario.lines
    .flatMap((line) => line.stations)
    .map((station) => ({
      stationId: station.id,
      distance: distanceMiles(station.coordinate, coordinate)
    }))
    .filter(({ distance }) => distance <= radiusMiles)
    .sort((a, b) => a.distance - b.distance)[0]?.stationId;
}

function buildMessages(results: {
  lineResults: LineResults[];
  stationResults: StationResults[];
  zoneResults: ZoneResults[];
  constructionCost: number;
  dailyRidership: number;
  airportStationId?: string;
}): SimulationMessage[] {
  if (!results.lineResults.some((line) => line.stationCount >= 2)) {
    return [
      {
        id: 'no-service',
        title: 'NO SERVICE TO SIMULATE',
        body: 'Place at least two stations on one line, then run the simulation again.'
      }
    ];
  }

  const messages: SimulationMessage[] = [];
  const topStation = [...results.stationResults].sort(
    (a, b) => b.entries + b.exits + b.transfers - (a.entries + a.exits + a.transfers)
  )[0];
  const topLine = [...results.lineResults].sort((a, b) => b.weekdayRidership - a.weekdayRidership)[0];
  const airportStation = results.stationResults.find(
    (station) => station.stationId === results.airportStationId
  );

  if (topStation && topStation.entries + topStation.exits > 2200) {
    const nearbyGrowth = results.zoneResults
      .filter((zone) => topStation.catchment.zoneIdsOneMile.includes(zone.zoneId))
      .reduce((sum, zone) => sum + zone.housingGrowth, 0);
    messages.push({
      id: 'station-booming',
      title: `${topStation.stationName.toUpperCase()} IS BOOMING`,
      body: `Strong ridership is supporting roughly ${Math.round(nearbyGrowth).toLocaleString()} new housing units within one mile in the long-range run.`
    });
  }

  if (topLine && topLine.weekdayRidership > 0 && topLine.constructionCost / topLine.weekdayRidership > 450_000) {
    messages.push({
      id: 'council-questions',
      title: `CITY COUNCIL QUESTIONS ${topLine.lineName.toUpperCase()}`,
      body: `Construction cost is high relative to demand: ${Math.round(topLine.weekdayRidership).toLocaleString()} daily riders for this line.`
    });
  }

  if (airportStation && airportStation.entries + airportStation.exits > 900) {
    messages.push({
      id: 'airport-success',
      title: 'AIRPORT CONNECTION SUCCESSFUL',
      body: `${Math.round(airportStation.entries + airportStation.exits).toLocaleString()} daily station movements are linked to the airport area.`
    });
  }

  if (messages.length === 0) {
    messages.push({
      id: 'baseline-message',
      title: 'PLANNERS REQUEST MORE DETAIL',
      body: 'The network is functional, but stronger station-area demand or faster service would make the benefits clearer.'
    });
  }

  return messages.slice(0, 3);
}

export function runSimulation(scenario: Scenario, baseZones: SimulationZone[]): SimulationResults {
  const firstPassRidership = estimateNetworkRidership(scenario.lines, baseZones, scenario.assumptions);
  const firstPassAccessibility = calculateAccessibilityScores(scenario.lines, baseZones, scenario.assumptions);
  const firstPassDevelopment = projectDevelopment(
    baseZones,
    firstPassAccessibility,
    firstPassRidership.zoneTransitTrips,
    scenario.assumptions,
    scenario.simulationYear
  );
  let zones = baseZones;
  let ridership = firstPassRidership;
  let accessibility = firstPassAccessibility;
  let zoneResults = firstPassDevelopment;

  if (scenario.simulationYear > 0) {
    zones = applyDevelopmentGrowth(baseZones, firstPassDevelopment, scenario.assumptions);
    ridership = estimateNetworkRidership(scenario.lines, zones, scenario.assumptions, { baseZones });
    accessibility = calculateAccessibilityScores(scenario.lines, zones, scenario.assumptions);
    zoneResults = projectDevelopment(
      baseZones,
      accessibility,
      ridership.zoneTransitTrips,
      scenario.assumptions,
      scenario.simulationYear
    );
  }
  const constructionCost = calculateScenarioCapitalCost(scenario.lines, scenario.assumptions);
  const annualizedCapitalCost = calculateAnnualizedCapitalCost(
    constructionCost,
    scenario.assumptions
  );
  const annualOperatingCost = calculateScenarioOperatingCost(scenario.lines, scenario.assumptions);
  const modeledDailyRegionalTrips = calculateDailyRegionalTrips(baseZones, zones, scenario.assumptions);
  const dailyRidership = ridership.dailyRidership;
  const annualRidership = dailyRidership * scenario.assumptions.annualizationFactor;
  const fareRevenue = annualRidership * scenario.assumptions.defaultFare;
  const systemCatchment = calculateSystemCatchment(scenario.lines, zones, scenario.assumptions);
  const averageRiderTravelTimeSavings =
    dailyRidership > 0 ? ridership.weightedTimeSavings / dailyRidership : 0;
  const lines = lineResults(scenario, ridership.lineRidership);
  const stations = stationResults(
    scenario,
    zones,
    zoneResults,
    ridership.stationEntries,
    ridership.stationExits,
    ridership.stationTransfers
  );
  const airportStationId = nearestStationIdWithinRadius(
    scenario,
    scenario.assumptions.airportCoordinate,
    scenario.assumptions.specialGeneratorRadiusMiles
  );

  return {
    baseDailyRegionalTrips: scenario.assumptions.totalDailyRegionalTrips,
    modeledDailyRegionalTrips,
    constructionCost,
    annualizedCapitalCost,
    annualOperatingCost,
    dailyRidership,
    annualRidership,
    costPerDailyRider: dailyRidership > 0 ? constructionCost / dailyRidership : 0,
    annualizedCostPerRider:
      annualRidership > 0 ? (annualizedCapitalCost + annualOperatingCost) / annualRidership : 0,
    fareRevenue,
    operatingSubsidy: Math.max(0, annualOperatingCost - fareRevenue),
    averageRiderTravelTimeSavings,
    vehicleTripsRemoved: dailyRidership * scenario.assumptions.vehicleTripsRemovedPerTransitTrip,
    co2ReductionKg:
      dailyRidership *
      scenario.assumptions.vehicleTripsRemovedPerTransitTrip *
      scenario.assumptions.co2KgPerVehicleTrip,
    populationWithinWalkingDistance: systemCatchment.population,
    jobsWithinWalkingDistance: systemCatchment.jobs,
    lineResults: lines,
    stationResults: stations,
    zoneResults,
    messages: buildMessages({
      lineResults: lines,
      stationResults: stations,
      zoneResults,
      constructionCost,
      dailyRidership,
      airportStationId
    }),
    generatedAt: 'deterministic-simulation'
  };
}
