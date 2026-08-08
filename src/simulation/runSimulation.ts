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
import { GAMEPLAY_EVENTS, isLineOpen } from '../data/gameplay';

function lineResults(
  scenario: Scenario,
  ridershipByLine: Map<string, number>,
  crowdingByLine: Map<string, number>,
  openLineIds: Set<string>
): LineResults[] {
  return scenario.lines.map((line) => {
    const mileage = calculateLineMileage(line);
    const weekdayRidership = ridershipByLine.get(line.id) ?? 0;
    const isOpen = openLineIds.has(line.id);
    return {
      lineId: line.id,
      lineName: line.name,
      technology: line.technology,
      mileage,
      stationCount: line.stations.length,
      constructionCost: calculateConstructionCost(line, scenario.assumptions),
      operatingCost: isOpen ? calculateAnnualOperatingCost(line, scenario.assumptions) : 0,
      weekdayRidership,
      ridersPerMile: mileage > 0 ? weekdayRidership / mileage : 0,
      crowdingMultiplier: crowdingByLine.get(line.id) ?? 1,
      isOpen,
      openingYear: line.openingYear
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
        return sum +
          (zoneResult?.developmentPressure ?? 0) *
          (catchment.zoneWeightsOneMile[zoneId] ?? 0);
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
          stationDevelopmentPotential(station, zones, scenario.assumptions, catchment) +
          catchmentDevelopment / 10
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
  if (!results.lineResults.some((line) => line.isOpen && line.stationCount >= 2)) {
    const nextOpeningYear = results.lineResults
      .filter((line) => !line.isOpen && line.stationCount >= 2 && line.openingYear !== undefined)
      .reduce<number | undefined>(
        (earliest, line) =>
          earliest === undefined ? line.openingYear : Math.min(earliest, line.openingYear!),
        undefined
      );
    if (nextOpeningYear !== undefined) {
      return [
        {
          id: 'network-under-construction',
          title: 'NETWORK UNDER CONSTRUCTION',
          body: `No lines are open for service yet. The next scheduled line opens in Year ${nextOpeningYear}.`
        }
      ];
    }
    return [
      {
        id: 'no-service',
        title: 'NO SERVICE TO SIMULATE',
        body: 'Place at least two stations on one line, then run the simulation again.'
      }
    ];
  }

  const messages: SimulationMessage[] = [];
  const eventThreshold = (type: (typeof GAMEPLAY_EVENTS)[number]['type']) =>
    GAMEPLAY_EVENTS.find((event) => event.type === type)?.threshold ?? Number.POSITIVE_INFINITY;
  const topStation = [...results.stationResults].sort(
    (a, b) => b.entries + b.exits + b.transfers - (a.entries + a.exits + a.transfers)
  )[0];
  const questionedLine = [...results.lineResults]
    .filter((line) => line.weekdayRidership > 0)
    .sort(
      (a, b) =>
        b.constructionCost / b.weekdayRidership -
        a.constructionCost / a.weekdayRidership
    )[0];
  const airportStation = results.stationResults.find(
    (station) => station.stationId === results.airportStationId
  );

  if (topStation && topStation.entries + topStation.exits >= eventThreshold('station-capacity')) {
    const nearbyGrowth = results.zoneResults
      .filter((zone) => topStation.catchment.zoneIdsOneMile.includes(zone.zoneId))
      .reduce(
        (sum, zone) =>
          sum +
          zone.housingGrowth *
            (topStation.catchment.zoneWeightsOneMile[zone.zoneId] ?? 0),
        0
      );
    messages.push({
      id: 'station-booming',
      title: `${topStation.stationName.toUpperCase()} IS BOOMING`,
      body: `Strong ridership is supporting roughly ${Math.round(nearbyGrowth).toLocaleString()} new housing units within one mile in the long-range run.`
    });
  }

  if (
    questionedLine &&
    questionedLine.constructionCost / questionedLine.weekdayRidership >= eventThreshold('council-review')
  ) {
    messages.push({
      id: 'council-questions',
      title: `CITY COUNCIL QUESTIONS ${questionedLine.lineName.toUpperCase()}`,
      body: `Construction cost is high relative to demand: ${Math.round(questionedLine.weekdayRidership).toLocaleString()} daily riders for this line.`
    });
  }

  if (
    airportStation &&
    airportStation.entries + airportStation.exits >= eventThreshold('airport-demand')
  ) {
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
  const capacityBonuses = scenario.gameMode === 'career'
    ? scenario.career?.developmentCapacityBonuses
    : undefined;
  const simulationBaseZones = capacityBonuses && Object.keys(capacityBonuses).length > 0
    ? baseZones.map((zone) => ({
        ...zone,
        developmentCapacity: Math.min(
          1,
          zone.developmentCapacity + (capacityBonuses[zone.id] ?? 0)
        )
      }))
    : baseZones;
  const openLines =
    scenario.gameMode === 'career'
      ? scenario.lines.filter((line) => isLineOpen(line, scenario.simulationYear))
      : scenario.lines;
  const openLineIds = new Set(openLines.map((line) => line.id));
  const serviceScenario = { ...scenario, lines: openLines };
  const firstPassRidership = estimateNetworkRidership(openLines, simulationBaseZones, scenario.assumptions);
  const firstPassAccessibility = calculateAccessibilityScores(openLines, simulationBaseZones, scenario.assumptions);
  const firstPassDevelopment = projectDevelopment(
    simulationBaseZones,
    firstPassAccessibility,
    firstPassRidership.zoneTransitTrips,
    scenario.assumptions,
    scenario.simulationYear
  );
  let zones = simulationBaseZones;
  let ridership = firstPassRidership;
  let accessibility = firstPassAccessibility;
  let zoneResults = firstPassDevelopment;

  if (scenario.simulationYear > 0) {
    zones = applyDevelopmentGrowth(simulationBaseZones, firstPassDevelopment, scenario.assumptions);
    ridership = estimateNetworkRidership(openLines, zones, scenario.assumptions, { baseZones: simulationBaseZones });
    accessibility = calculateAccessibilityScores(openLines, zones, scenario.assumptions);
    zoneResults = projectDevelopment(
      simulationBaseZones,
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
  const annualOperatingCost = calculateScenarioOperatingCost(openLines, scenario.assumptions);
  const modeledDailyRegionalTrips = calculateDailyRegionalTrips(simulationBaseZones, zones, scenario.assumptions);
  const dailyRidership = ridership.dailyRidership;
  const annualRidership = dailyRidership * scenario.assumptions.annualizationFactor;
  const fareRevenue = annualRidership * scenario.assumptions.defaultFare;
  const systemCatchment = calculateSystemCatchment(openLines, zones, scenario.assumptions);
  const averageRiderTravelTimeSavings =
    dailyRidership > 0 ? ridership.weightedTimeSavings / dailyRidership : 0;
  const lines = lineResults(scenario, ridership.lineRidership, ridership.lineCrowdingMultipliers, openLineIds);
  const stations = stationResults(
    serviceScenario,
    zones,
    zoneResults,
    ridership.stationEntries,
    ridership.stationExits,
    ridership.stationTransfers
  );
  const airportStationId = nearestStationIdWithinRadius(
    serviceScenario,
    scenario.assumptions.airportCoordinate,
    scenario.assumptions.specialGeneratorRadiusMiles
  );
  const airportStation = stations.find((station) => station.stationId === airportStationId);
  const airportStationMovements = airportStation
    ? airportStation.entries + airportStation.exits
    : 0;

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
    airportConnected: airportStationId !== undefined,
    airportStationMovements,
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
