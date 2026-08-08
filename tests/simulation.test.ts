import { describe, expect, it } from 'vitest';
import { DEFAULT_ASSUMPTIONS } from '../src/data/assumptions';
import { DEMO_SCENARIO } from '../src/data/pensacola/demoScenario';
import { PENSACOLA_ZONES } from '../src/data/pensacola/zones';
import { accessibilityWeight, calculateAccessibilityScores } from '../src/simulation/accessibility';
import { calculateStationCatchment } from '../src/simulation/catchment';
import {
  averageWaitTime,
  calculateAnnualizedCapitalCost,
  calculateConstructionCost,
  calculateLineMileage,
  capitalRecoveryFactor
} from '../src/simulation/costs';
import { calculateDailyRegionalTrips, createDemandMatrix } from '../src/simulation/demand';
import { applyDevelopmentGrowth, projectDevelopment } from '../src/simulation/development';
import { distanceMiles, lineMileage } from '../src/simulation/geo';
import {
  directedSegmentKey,
  estimateCarGeneralizedTime,
  estimateNetworkRidership,
  estimateTransitGeneralizedTime,
  maximumTransitShareForOrigin,
  spreadTransitPaths,
  transitModeShare
} from '../src/simulation/ridership';
import { buildTransitGraph, fastestTransitPath, transitTimesFromOrigin } from '../src/simulation/routing';
import { nearestStationIdWithinRadius, runSimulation } from '../src/simulation/runSimulation';
import {
  buildRoadNetwork,
  roadPathBetweenCoordinates,
  snapCoordinateToLineGeometry,
  snapCoordinateToRoadCorridors,
  type CorridorCollection
} from '../src/simulation/snapping';
import { nearestTransferStation, transferPartnersForStation } from '../src/simulation/transfers';
import type { Scenario, SimulationAssumptions, SimulationZone, TransitLine } from '../src/types';

function cloneAssumptions(): SimulationAssumptions {
  return JSON.parse(JSON.stringify(DEFAULT_ASSUMPTIONS)) as SimulationAssumptions;
}

function cloneScenario(scenario: Scenario): Scenario {
  return JSON.parse(JSON.stringify(scenario)) as Scenario;
}

const testZones: SimulationZone[] = [
  {
    id: 'origin',
    name: 'Origin',
    centroid: [-87.2155, 30.4122],
    polygon: [],
    population: 12_000,
    households: 5_200,
    jobs: 1_200,
    density: 4_000,
    carOwnership: 0.9,
    medianIncome: 50_000,
    housingUnits: 5_600,
    commercialSqFt: 400_000,
    landValueIndex: 1,
    developmentCapacity: 0.8
  },
  {
    id: 'jobs',
    name: 'Jobs',
    centroid: [-87.1866, 30.4734],
    polygon: [],
    population: 2_000,
    households: 900,
    jobs: 18_000,
    density: 3_000,
    carOwnership: 0.95,
    medianIncome: 56_000,
    housingUnits: 1_000,
    commercialSqFt: 6_000_000,
    landValueIndex: 1.1,
    developmentCapacity: 0.7
  },
  {
    id: 'outer',
    name: 'Outer',
    centroid: [-87.31, 30.5],
    polygon: [],
    population: 8_000,
    households: 3_500,
    jobs: 2_000,
    density: 2_400,
    carOwnership: 0.98,
    medianIncome: 48_000,
    housingUnits: 3_800,
    commercialSqFt: 700_000,
    landValueIndex: 0.8,
    developmentCapacity: 0.6
  }
];

function testLine(overrides: Partial<TransitLine> = {}): TransitLine {
  const lineId = overrides.id ?? 'test-line';
  return {
    id: lineId,
    name: 'Test Line',
    technology: 'brt',
    color: DEFAULT_ASSUMPTIONS.technologies.brt.color,
    headwayMinutes: 10,
    geometry: [
      [-87.2155, 30.4122],
      [-87.1866, 30.4734]
    ],
    stations: [
      {
        id: `${lineId}-origin`,
        lineId,
        name: 'Origin Station',
        coordinate: [-87.2155, 30.4122],
        order: 0
      },
      {
        id: `${lineId}-jobs`,
        lineId,
        name: 'Jobs Station',
        coordinate: [-87.1866, 30.4734],
        order: 1
      }
    ],
    ...overrides
  };
}

function lineWithStationCount(stationCount: number, lineId = `line-${stationCount}`): TransitLine {
  const coordinates = Array.from(
    { length: stationCount },
    (_, index) => [-87.24 + index * 0.03, 30.42] as [number, number]
  );
  return testLine({
    id: lineId,
    geometry: coordinates,
    stations: coordinates.map((coordinate, order) => ({
      id: `${lineId}-station-${order}`,
      lineId,
      name: `Station ${order + 1}`,
      coordinate,
      order
    }))
  });
}

describe('simulation primitives', () => {
  it('calculates line mileage from geographic coordinates', () => {
    expect(lineMileage([[0, 0], [0, 1]])).toBeCloseTo(69.1, 0);
  });

  it('calculates construction cost from mileage and stations', () => {
    const assumptions = cloneAssumptions();
    const line = testLine();
    const expected =
      calculateLineMileage(line) * assumptions.technologies.brt.capitalCostPerMile +
      line.stations.length * assumptions.technologies.brt.stationCost;
    expect(calculateConstructionCost(line, assumptions)).toBeCloseTo(expected, 2);
  });

  it('annualizes capital cost with the configured asset life and discount rate', () => {
    const assumptions = cloneAssumptions();
    const constructionCost = 1_000_000_000;
    const expectedFactor =
      assumptions.capitalDiscountRate *
      (1 + assumptions.capitalDiscountRate) ** assumptions.capitalAssetLifeYears /
      ((1 + assumptions.capitalDiscountRate) ** assumptions.capitalAssetLifeYears - 1);

    expect(capitalRecoveryFactor(30, 0)).toBeCloseTo(1 / 30, 10);
    expect(calculateAnnualizedCapitalCost(constructionCost, assumptions)).toBeCloseTo(
      constructionCost * expectedFactor,
      6
    );
  });

  it('calculates station catchments for half-mile and one-mile bands', () => {
    const assumptions = cloneAssumptions();
    const station = {
      id: 'station',
      lineId: 'line',
      name: 'Station',
      coordinate: [-87.2155, 30.4122] as [number, number],
      order: 0
    };
    const zones = [
      { ...testZones[0], centroid: [-87.2155, 30.4122] as [number, number] },
      { ...testZones[1], centroid: [-87.207, 30.418] as [number, number] }
    ];
    const catchment = calculateStationCatchment(station, zones, assumptions);
    expect(catchment.populationHalfMile).toBe(testZones[0].population);
    expect(catchment.populationOneMile).toBe(testZones[0].population + testZones[1].population);
    expect(catchment.jobsOneMile).toBe(testZones[0].jobs + testZones[1].jobs);
  });

  it('uses half the headway as average wait time', () => {
    expect(averageWaitTime(10)).toBe(5);
    expect(averageWaitTime(30)).toBe(15);
  });

  it('scales regional trip demand with population and job growth', () => {
    const assumptions = cloneAssumptions();
    const grownZones = testZones.map((zone) => ({
      ...zone,
      population: zone.population * 1.1,
      jobs: zone.jobs * 1.1
    }));
    const baseDemand = createDemandMatrix(testZones, assumptions);
    const futureDemand = createDemandMatrix(grownZones, assumptions, testZones);

    expect(baseDemand.reduce((sum, pair) => sum + pair.dailyTrips, 0)).toBeCloseTo(
      assumptions.totalDailyRegionalTrips,
      8
    );
    expect(calculateDailyRegionalTrips(testZones, grownZones, assumptions)).toBeCloseTo(
      assumptions.totalDailyRegionalTrips * 1.1,
      8
    );
    expect(futureDemand.reduce((sum, pair) => sum + pair.dailyTrips, 0)).toBeCloseTo(
      assumptions.totalDailyRegionalTrips * 1.1,
      8
    );
  });

  it('redistributes demand toward airport and university generators without changing trip totals', () => {
    const baselineAssumptions = cloneAssumptions();
    baselineAssumptions.specialGeneratorDemandBonus = 0;
    const bonusAssumptions = cloneAssumptions();
    bonusAssumptions.specialGeneratorDemandBonus = 0.5;
    const baseline = createDemandMatrix(testZones, baselineAssumptions);
    const withBonus = createDemandMatrix(testZones, bonusAssumptions);
    const tripsToAirport = (pairs: typeof baseline) => pairs
      .filter((pair) => pair.destinationZoneId === 'jobs')
      .reduce((sum, pair) => sum + pair.dailyTrips, 0);

    expect(tripsToAirport(withBonus)).toBeGreaterThan(tripsToAirport(baseline));
    expect(withBonus.reduce((sum, pair) => sum + pair.dailyTrips, 0)).toBeCloseTo(
      bonusAssumptions.totalDailyRegionalTrips,
      8
    );
  });

  it('snaps route clicks to nearby OSM road corridors', () => {
    const corridors: CorridorCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { highway: 'primary', name: 'Test Road' },
          geometry: {
            type: 'LineString',
            coordinates: [
              [-87.2, 30.4],
              [-87.2, 30.5]
            ]
          }
        }
      ]
    };

    const snapped = snapCoordinateToRoadCorridors([-87.201, 30.45], corridors, 600);
    expect(snapped.snapped).toBe(true);
    expect(snapped.coordinate[0]).toBeCloseTo(-87.2, 4);
    expect(snapped.corridorName).toBe('Test Road');

    const unsnapped = snapCoordinateToRoadCorridors([-87.22, 30.45], corridors, 100);
    expect(unsnapped.snapped).toBe(false);
    expect(unsnapped.coordinate).toEqual([-87.22, 30.45]);
  });

  it('builds a road-following path between snapped route stops', () => {
    const corridors: CorridorCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { highway: 'primary', name: 'North South Road' },
          geometry: {
            type: 'LineString',
            coordinates: [
              [-87.2, 30.4],
              [-87.2, 30.45]
            ]
          }
        },
        {
          type: 'Feature',
          properties: { highway: 'primary', name: 'East West Road' },
          geometry: {
            type: 'LineString',
            coordinates: [
              [-87.2, 30.45],
              [-87.15, 30.45]
            ]
          }
        }
      ]
    };
    const network = buildRoadNetwork(corridors);
    const path = roadPathBetweenCoordinates([-87.201, 30.401], [-87.151, 30.449], network, 800);

    expect(path).toBeDefined();
    expect(path?.[0][0]).toBeCloseTo(-87.2, 4);
    expect(path).toContainEqual([-87.2, 30.45]);
    expect(path?.[path.length - 1]?.[1]).toBeCloseTo(30.45, 4);
  });

  it('snaps station coordinates onto the selected transit line geometry', () => {
    const snapped = snapCoordinateToLineGeometry(
      [-87.201, 30.45],
      [
        [-87.2, 30.4],
        [-87.2, 30.5]
      ]
    );

    expect(snapped.snapped).toBe(true);
    expect(snapped.coordinate[0]).toBeCloseTo(-87.2, 4);
    expect(snapped.coordinate[1]).toBeCloseTo(30.45, 4);
  });

  it('finds nearby transfer stations across lines', () => {
    const lineA = testLine({ id: 'line-a' });
    const lineB = testLine({
      id: 'line-b',
      stations: [
        {
          id: 'line-b-transfer',
          lineId: 'line-b',
          name: 'Transfer Stop',
          coordinate: [-87.1866, 30.4734],
          order: 0
        }
      ]
    });

    const candidate = nearestTransferStation(
      [-87.1868, 30.4735],
      [lineA, lineB],
      lineA.id,
      DEFAULT_ASSUMPTIONS.transferDistanceFeet
    );
    const partners = transferPartnersForStation(lineA.stations[1], [lineA, lineB], DEFAULT_ASSUMPTIONS.transferDistanceFeet);

    expect(candidate?.stationId).toBe('line-b-transfer');
    expect(partners.map((partner) => partner.stationId)).toContain('line-b-transfer');
  });
});

describe('routing and ridership', () => {
  it('uses a smooth accessibility decay around the target travel time', () => {
    const assumptions = cloneAssumptions();

    expect(accessibilityWeight(20, assumptions)).toBeGreaterThan(
      accessibilityWeight(30, assumptions)
    );
    expect(accessibilityWeight(30, assumptions)).toBeCloseTo(0.5, 8);
    expect(accessibilityWeight(40, assumptions)).toBeLessThan(
      accessibilityWeight(30, assumptions)
    );
    expect(accessibilityWeight(30.01, assumptions)).toBeGreaterThan(0);
  });

  it('converts fares and car operating costs into generalized minutes', () => {
    const assumptions = cloneAssumptions();
    const transitMinutes = estimateTransitGeneralizedTime(20, assumptions);
    const carMinutes = estimateCarGeneralizedTime(testZones[0], testZones[1], assumptions);

    expect(transitMinutes).toBe(27.5);
    expect(carMinutes).toBeGreaterThan(0);
  });

  it('keeps equal-generalized-cost transit share in the calibration band', () => {
    const assumptions = cloneAssumptions();
    const share = transitModeShare(30, 30, assumptions);

    expect(share).toBeGreaterThan(0.1);
    expect(share).toBeLessThan(0.15);
  });

  it('raises the transit ceiling for origins with fewer vehicle-owning households', () => {
    const assumptions = cloneAssumptions();
    const vehicleRichOrigin = { ...testZones[0], carOwnership: 0.98 };
    const lowVehicleOrigin = { ...testZones[0], carOwnership: 0.5 };
    const vehicleRichMaximum = maximumTransitShareForOrigin(vehicleRichOrigin, assumptions);
    const lowVehicleMaximum = maximumTransitShareForOrigin(lowVehicleOrigin, assumptions);

    expect(lowVehicleMaximum).toBeGreaterThan(vehicleRichMaximum);
    expect(transitModeShare(30, 30, assumptions, lowVehicleMaximum)).toBeGreaterThan(
      transitModeShare(30, 30, assumptions, vehicleRichMaximum)
    );
  });

  it('finds a transit path between connected stations', () => {
    const assumptions = cloneAssumptions();
    const line = testLine();
    const path = fastestTransitPath(testZones[0].centroid, testZones[1].centroid, [line], assumptions);
    expect(path).toBeDefined();
    expect(path?.lineIds).toContain(line.id);
    expect(path?.totalMinutes).toBeGreaterThan(0);
    expect(path?.segments).toEqual([
      {
        lineId: line.id,
        fromStationId: line.stations[0].id,
        toStationId: line.stations[1].id
      }
    ]);
  });

  it('adds dwell time when a through trip gains an intermediate station', () => {
    const assumptions = cloneAssumptions();
    const lineWithStop = lineWithStationCount(3, 'with-stop');
    const origin = lineWithStop.stations[0].coordinate;
    const destination = lineWithStop.stations[2].coordinate;
    const directLine = testLine({
      id: 'direct',
      geometry: [origin, destination],
      stations: [
        { id: 'direct-origin', lineId: 'direct', name: 'Origin', coordinate: origin, order: 0 },
        { id: 'direct-destination', lineId: 'direct', name: 'Destination', coordinate: destination, order: 1 }
      ]
    });
    const directPath = fastestTransitPath(origin, destination, [directLine], assumptions);
    const stoppingPath = fastestTransitPath(origin, destination, [lineWithStop], assumptions);

    expect(stoppingPath?.totalMinutes).toBeCloseTo(
      (directPath?.totalMinutes ?? 0) + assumptions.technologies.brt.dwellMinutesPerStop,
      6
    );
  });

  it('charges dwell at every non-terminal stop on an end-to-end trip', () => {
    const assumptions = cloneAssumptions();
    const noDwellAssumptions = cloneAssumptions();
    noDwellAssumptions.technologies.brt.dwellMinutesPerStop = 0;
    const line = lineWithStationCount(4);
    const origin = line.stations[0].coordinate;
    const destination = line.stations[3].coordinate;
    const path = fastestTransitPath(origin, destination, [line], assumptions);
    const noDwellPath = fastestTransitPath(origin, destination, [line], noDwellAssumptions);

    expect(path?.totalMinutes).toBeCloseTo(
      (noDwellPath?.totalMinutes ?? 0) + assumptions.technologies.brt.dwellMinutesPerStop * 2,
      8
    );
  });

  it('reproduces distance-speed routing when dwell time is zero', () => {
    const assumptions = cloneAssumptions();
    assumptions.technologies.brt.dwellMinutesPerStop = 0;
    const line = lineWithStationCount(3);
    const path = fastestTransitPath(
      line.stations[0].coordinate,
      line.stations[2].coordinate,
      [line],
      assumptions
    );
    const expectedInVehicleMinutes =
      line.stations.slice(0, -1).reduce((sum, station, index) => (
        sum +
        distanceMiles(station.coordinate, line.stations[index + 1].coordinate) *
          assumptions.roadCircuityFactor /
          assumptions.technologies.brt.averageSpeedMph *
          60
      ), 0);

    expect(path?.totalMinutes).toBeCloseTo(
      expectedInVehicleMinutes + line.headwayMinutes / 2,
      8
    );
  });

  it('matches the per-pair routing oracle when paths are cached by origin', () => {
    const scenario = cloneScenario(DEMO_SCENARIO);
    const lines = scenario.lines;
    const origin = lines[0].stations[0].coordinate;
    const graph = buildTransitGraph(lines, scenario.assumptions);
    const cachedPaths = transitTimesFromOrigin(origin, lines, scenario.assumptions, graph);

    for (const station of lines[0].stations.slice(1)) {
      const oracle = fastestTransitPath(origin, station.coordinate, lines, scenario.assumptions, graph);
      expect(cachedPaths.pathTo(station.coordinate)).toEqual(oracle);
    }
  });

  it('routes through transfer stations between connected lines', () => {
    const assumptions = cloneAssumptions();
    const lineA = testLine({
      id: 'line-a',
      geometry: [
        [-87.2155, 30.4122],
        [-87.1866, 30.4734]
      ],
      stations: [
        {
          id: 'line-a-origin',
          lineId: 'line-a',
          name: 'Origin Station',
          coordinate: [-87.2155, 30.4122],
          order: 0
        },
        {
          id: 'line-a-transfer',
          lineId: 'line-a',
          name: 'Transfer Station',
          coordinate: [-87.1866, 30.4734],
          order: 1
        }
      ]
    });
    const lineB = testLine({
      id: 'line-b',
      geometry: [
        [-87.1866, 30.4734],
        [-87.31, 30.5]
      ],
      stations: [
        {
          id: 'line-b-transfer',
          lineId: 'line-b',
          name: 'Transfer Station',
          coordinate: [-87.1866, 30.4734],
          order: 0
        },
        {
          id: 'line-b-outer',
          lineId: 'line-b',
          name: 'Outer Station',
          coordinate: [-87.31, 30.5],
          order: 1
        }
      ]
    });

    const path = fastestTransitPath(testZones[0].centroid, testZones[2].centroid, [lineA, lineB], assumptions);

    expect(path?.lineIds).toContain(lineA.id);
    expect(path?.lineIds).toContain(lineB.id);
    expect(path?.transferStationIds.length).toBeGreaterThan(0);
  });

  it('charges more transfer time when connecting stations are farther apart', () => {
    const assumptions = cloneAssumptions();
    const lineA = testLine({ id: 'transfer-a' });
    const lineB = testLine({
      id: 'transfer-b',
      stations: [
        {
          id: 'transfer-b-near',
          lineId: 'transfer-b',
          name: 'Near transfer',
          coordinate: lineA.stations[1].coordinate,
          order: 0
        }
      ]
    });
    const spacedLineB = {
      ...lineB,
      stations: [{ ...lineB.stations[0], coordinate: [-87.1859, 30.4734] as [number, number] }]
    };
    const nearGraph = buildTransitGraph([lineA, lineB], assumptions);
    const spacedGraph = buildTransitGraph([lineA, spacedLineB], assumptions);
    const transferMinutes = (graph: ReturnType<typeof buildTransitGraph>) =>
      graph.get(`station:${lineA.stations[1].id}`)?.find(
        (edge) => edge.to === `station:${lineB.stations[0].id}`
      )?.minutes ?? Number.POSITIVE_INFINITY;

    expect(transferMinutes(spacedGraph)).toBeGreaterThan(transferMinutes(nearGraph));
    expect(transferMinutes(nearGraph)).toBe(assumptions.transferPenaltyMinutes);
  });

  it('increases ridership when transit is faster', () => {
    const slowAssumptions = cloneAssumptions();
    const fastAssumptions = cloneAssumptions();
    slowAssumptions.technologies.brt.averageSpeedMph = 12;
    fastAssumptions.technologies.brt.averageSpeedMph = 55;

    const line = testLine();
    const slow = estimateNetworkRidership([line], testZones, slowAssumptions).dailyRidership;
    const fast = estimateNetworkRidership([line], testZones, fastAssumptions).dailyRidership;
    expect(fast).toBeGreaterThan(slow);
  });

  it('increases ridership when frequency improves', () => {
    const assumptions = cloneAssumptions();
    const slowLine = testLine({ id: 'slow', headwayMinutes: 30 });
    const frequentLine = testLine({ id: 'fast', headwayMinutes: 5 });

    const slow = estimateNetworkRidership([slowLine], testZones, assumptions).dailyRidership;
    const frequent = estimateNetworkRidership([frequentLine], testZones, assumptions).dailyRidership;
    expect(frequent).toBeGreaterThan(slow);
  });

  it('records riders on directed station-to-station segments', () => {
    const assumptions = cloneAssumptions();
    const line = testLine();
    const result = estimateNetworkRidership([line], testZones, assumptions, { applyCrowding: false });
    const outboundKey = directedSegmentKey(line.id, line.stations[0].id, line.stations[1].id);
    const inboundKey = directedSegmentKey(line.id, line.stations[1].id, line.stations[0].id);

    expect(result.segmentRidership.get(outboundKey)).toBeGreaterThan(0);
    expect(result.segmentRidership.get(inboundKey)).toBeGreaterThan(0);
  });

  it('credits transit activity to both origin and destination zones', () => {
    const assumptions = cloneAssumptions();
    const activityZones: SimulationZone[] = [
      { ...testZones[0], jobs: 0 },
      { ...testZones[1], population: 0, households: 0 }
    ];
    const line = testLine();
    const result = estimateNetworkRidership([line], activityZones, assumptions, {
      applyCrowding: false
    });
    const destinationTrips = result.zoneTransitTrips.get(activityZones[1].id) ?? 0;
    const originOnlyTrips = new Map(activityZones.map((zone) => [zone.id, 0]));
    originOnlyTrips.set(activityZones[0].id, result.zoneTransitTrips.get(activityZones[0].id) ?? 0);
    const creditedDevelopment = projectDevelopment(
      activityZones,
      new Map(activityZones.map((zone) => [zone.id, 0])),
      result.zoneTransitTrips,
      assumptions,
      5
    );
    const originOnlyDevelopment = projectDevelopment(
      activityZones,
      new Map(activityZones.map((zone) => [zone.id, 0])),
      originOnlyTrips,
      assumptions,
      5
    );

    expect(destinationTrips).toBeGreaterThan(0);
    expect(creditedDevelopment[1].developmentPressure).toBeGreaterThan(
      originOnlyDevelopment[1].developmentPressure
    );
  });

  it('reduces ridership when a low-capacity line is overcrowded', () => {
    const assumptions = cloneAssumptions();
    assumptions.technologies.brt.averageSpeedMph = 28;
    assumptions.technologies.brt.dwellMinutesPerStop = 0;
    assumptions.technologies.brt.vehicleCapacity = 5;
    assumptions.technologies['light-rail'].averageSpeedMph = 28;
    assumptions.technologies['light-rail'].dwellMinutesPerStop = 0;
    assumptions.technologies['light-rail'].vehicleCapacity = 5_000;
    const lowCapacityLine = testLine({ id: 'low-capacity', technology: 'brt' });
    const highCapacityLine = testLine({ id: 'high-capacity', technology: 'light-rail' });
    const lowCapacity = estimateNetworkRidership([lowCapacityLine], testZones, assumptions);
    const highCapacity = estimateNetworkRidership([highCapacityLine], testZones, assumptions);

    expect(lowCapacity.lineCrowdingMultipliers.get(lowCapacityLine.id)).toBeGreaterThan(1);
    expect(highCapacity.lineCrowdingMultipliers.get(highCapacityLine.id)).toBe(1);
    expect(highCapacity.dailyRidership).toBeGreaterThan(lowCapacity.dailyRidership);
  });

  it('relieves crowding when frequency doubles', () => {
    const assumptions = cloneAssumptions();
    assumptions.technologies.brt.vehicleCapacity = 10;
    const halfHourlyLine = testLine({ id: 'half-hourly', headwayMinutes: 30 });
    const quarterHourlyLine = testLine({ id: 'quarter-hourly', headwayMinutes: 15 });
    const halfHourly = estimateNetworkRidership([halfHourlyLine], testZones, assumptions);
    const quarterHourly = estimateNetworkRidership([quarterHourlyLine], testZones, assumptions);

    expect(halfHourly.lineCrowdingMultipliers.get(halfHourlyLine.id)).toBeGreaterThan(
      quarterHourly.lineCrowdingMultipliers.get(quarterHourlyLine.id) ?? 1
    );
    expect(quarterHourly.dailyRidership).toBeGreaterThan(halfHourly.dailyRidership);
  });

  it('leaves uncrowded assignment byte-identical to capacity-disabled assignment', () => {
    const assumptions = cloneAssumptions();
    assumptions.technologies.brt.vehicleCapacity = 100_000;
    const line = testLine();
    const withoutCapacity = estimateNetworkRidership([line], testZones, assumptions, {
      applyCrowding: false
    });
    const uncrowded = estimateNetworkRidership([line], testZones, assumptions);

    expect(uncrowded).toEqual(withoutCapacity);
  });

  it('increases ridership when stations are near population and jobs', () => {
    const assumptions = cloneAssumptions();
    const nearLine = testLine({ id: 'near' });
    const farLine = testLine({
      id: 'far',
      stations: [
        {
          id: 'far-a',
          lineId: 'far',
          name: 'Far A',
          coordinate: [-87.33, 30.35],
          order: 0
        },
        {
          id: 'far-b',
          lineId: 'far',
          name: 'Far B',
          coordinate: [-87.34, 30.36],
          order: 1
        }
      ]
    });

    const near = estimateNetworkRidership([nearLine], testZones, assumptions).dailyRidership;
    const far = estimateNetworkRidership([farLine], testZones, assumptions).dailyRidership;
    expect(near).toBeGreaterThan(far);
  });

  it('assigns ridership to a second line that serves a useful station pair', () => {
    const assumptions = cloneAssumptions();
    const firstLine = testLine({ id: 'airport-line' });
    const secondLine = testLine({
      id: 'outer-feeder',
      name: 'Outer Feeder',
      geometry: [
        [-87.31, 30.5],
        [-87.1866, 30.4734]
      ],
      stations: [
        {
          id: 'outer-feeder-origin',
          lineId: 'outer-feeder',
          name: 'Outer Station',
          coordinate: [-87.31, 30.5],
          order: 0
        },
        {
          id: 'outer-feeder-jobs',
          lineId: 'outer-feeder',
          name: 'Jobs Transfer',
          coordinate: [-87.1866, 30.4734],
          order: 1
        }
      ]
    });
    const scenario: Scenario = {
      id: 'two-lines',
      name: 'Two Lines',
      lines: [firstLine, secondLine],
      assumptions,
      simulationYear: 0,
      budgetLimitsEnabled: false
    };

    const result = runSimulation(scenario, testZones);
    const firstLineResult = result.lineResults.find((line) => line.lineId === firstLine.id);
    const secondLineResult = result.lineResults.find((line) => line.lineId === secondLine.id);

    expect(firstLineResult?.weekdayRidership).toBeGreaterThan(0);
    expect(secondLineResult?.weekdayRidership).toBeGreaterThan(0);
  });

  it('spreads riders across near-equal parallel paths', () => {
    const assumptions = cloneAssumptions();
    assumptions.technologies.brt.vehicleCapacity = 100_000;
    const firstLine = testLine({ id: 'parallel-a' });
    const secondLine = testLine({ id: 'parallel-b' });
    const result = estimateNetworkRidership([firstLine, secondLine], testZones, assumptions, {
      applyCrowding: false
    });
    const firstRidership = result.lineRidership.get(firstLine.id) ?? 0;
    const secondRidership = result.lineRidership.get(secondLine.id) ?? 0;

    expect(firstRidership).toBeGreaterThan(0);
    expect(secondRidership).toBeGreaterThan(0);
    expect(firstRidership).toBeCloseTo(secondRidership, 8);
  });

  it('weights a slightly slower path lower and excludes a poor alternative', () => {
    const assumptions = cloneAssumptions();
    const line = testLine();
    const basePath = fastestTransitPath(
      testZones[0].centroid,
      testZones[1].centroid,
      [line],
      assumptions
    );
    if (!basePath) {
      throw new Error('Path fixture is missing');
    }
    const choices = spreadTransitPaths(
      [
        basePath,
        { ...basePath, destinationStationId: 'slower', totalMinutes: basePath.totalMinutes + 2 },
        { ...basePath, destinationStationId: 'poor', totalMinutes: basePath.totalMinutes + 20 }
      ],
      assumptions
    );

    expect(choices).toHaveLength(2);
    expect(choices[0].share).toBeGreaterThan(choices[1].share);
    expect(choices.reduce((sum, choice) => sum + choice.share, 0)).toBeCloseTo(1, 10);
  });

  it('decreases ridership when transit travel time is dramatically worse', () => {
    const assumptions = cloneAssumptions();
    const normalLine = testLine({ id: 'normal' });
    const slowLine = testLine({ id: 'crawl' });
    const slowAssumptions = cloneAssumptions();
    slowAssumptions.technologies.brt.averageSpeedMph = 4;

    const normal = estimateNetworkRidership([normalLine], testZones, assumptions).dailyRidership;
    const slow = estimateNetworkRidership([slowLine], testZones, slowAssumptions).dailyRidership;
    expect(slow).toBeLessThan(normal);
  });

  it('does not change ridership when only capital cost changes', () => {
    const baseAssumptions = cloneAssumptions();
    const expensiveAssumptions = cloneAssumptions();
    expensiveAssumptions.technologies.brt.capitalCostPerMile *= 20;

    const line = testLine();
    const base = estimateNetworkRidership([line], testZones, baseAssumptions).dailyRidership;
    const expensive = estimateNetworkRidership([line], testZones, expensiveAssumptions).dailyRidership;
    expect(expensive).toBeCloseTo(base, 8);
  });

  it('matches the pre-generalized-cost demo when both monetary costs are zero', () => {
    const scenario = cloneScenario(DEMO_SCENARIO);
    scenario.assumptions.defaultFare = 0;
    scenario.assumptions.carCostPerMile = 0;
    scenario.assumptions.transitSpecificConstantMinutes = 0;
    scenario.assumptions.specialGeneratorDemandBonus = 0;
    Object.values(scenario.assumptions.technologies).forEach((technology) => {
      technology.dwellMinutesPerStop = 0;
    });

    const result = runSimulation(scenario, PENSACOLA_ZONES);
    expect(result.dailyRidership).toBeCloseTo(541.7260800613443, 8);
  });

  it('keeps default demo ridership within the calibration band', () => {
    const scenario = cloneScenario(DEMO_SCENARIO);
    scenario.assumptions.transitSpecificConstantMinutes = 0;
    Object.values(scenario.assumptions.technologies).forEach((technology) => {
      technology.dwellMinutesPerStop = 0;
    });
    const result = runSimulation(scenario, PENSACOLA_ZONES);
    const previousRidership = 541.7260800613443;

    expect(result.dailyRidership).toBeGreaterThan(previousRidership * 0.75);
    expect(result.dailyRidership).toBeLessThan(previousRidership * 1.25);
  });

  it('keeps the mode-choice-calibrated demo within its gameplay target band', () => {
    const result = runSimulation(cloneScenario(DEMO_SCENARIO), PENSACOLA_ZONES);

    expect(result.dailyRidership).toBeGreaterThan(75);
    expect(result.dailyRidership).toBeLessThan(250);
  });

  it('decreases ridership monotonically as fares increase', () => {
    const fares = [0, 2, 4, 6, 8, 10];
    const riders = fares.map((fare) => {
      const assumptions = cloneAssumptions();
      assumptions.defaultFare = fare;
      return estimateNetworkRidership([testLine()], testZones, assumptions).dailyRidership;
    });

    for (let index = 1; index < riders.length; index += 1) {
      expect(riders[index]).toBeLessThan(riders[index - 1]);
    }
  });

  it('produces an interior fare-revenue maximum on a zero-to-ten-dollar sweep', () => {
    const fares = Array.from({ length: 11 }, (_, fare) => fare);
    const revenues = fares.map((fare) => {
      const assumptions = cloneAssumptions();
      assumptions.defaultFare = fare;
      const riders = estimateNetworkRidership([testLine()], testZones, assumptions).dailyRidership;
      return riders * fare * assumptions.annualizationFactor;
    });
    const maximumIndex = revenues.indexOf(Math.max(...revenues));

    expect(maximumIndex).toBeGreaterThan(0);
    expect(maximumIndex).toBeLessThan(fares.length - 1);
  });
});

describe('development and deterministic runs', () => {
  it('increases development response when accessibility is higher', () => {
    const assumptions = cloneAssumptions();
    const low = projectDevelopment(
      testZones,
      new Map(testZones.map((zone) => [zone.id, 0.05])),
      new Map(testZones.map((zone) => [zone.id, 100])),
      assumptions,
      20
    );
    const high = projectDevelopment(
      testZones,
      new Map(testZones.map((zone) => [zone.id, 0.75])),
      new Map(testZones.map((zone) => [zone.id, 1000])),
      assumptions,
      20
    );

    expect(high.reduce((sum, zone) => sum + zone.populationGrowth, 0)).toBeGreaterThan(
      low.reduce((sum, zone) => sum + zone.populationGrowth, 0)
    );
  });

  it('compounds five-year growth and consumes development capacity', () => {
    const assumptions = cloneAssumptions();
    assumptions.developmentGrowthRatePerFiveYears = 0.1;
    assumptions.developmentAccessibilityWeight = 1;
    assumptions.developmentTransitSuccessWeight = 0;
    assumptions.developmentDowntownWeight = 0;
    const zone = { ...testZones[0], developmentCapacity: 0.8 };
    const projected = projectDevelopment(
      [zone],
      new Map([[zone.id, 1]]),
      new Map([[zone.id, 0]]),
      assumptions,
      10
    );
    const grown = applyDevelopmentGrowth([zone], projected, assumptions)[0];
    const expectedGrowth = (1 + 0.08) * (1 + 0.072) - 1;

    expect(projected[0].populationGrowth).toBe(Math.round(zone.population * expectedGrowth));
    expect(projected[0].developmentCapacityUsed).toBeCloseTo(0.152, 8);
    expect(grown.developmentCapacity).toBeCloseTo(0.648, 8);
    expect(grown.households).toBe(Math.round(grown.population / assumptions.averageHouseholdSize));
  });

  it('identifies an airport station by coordinates rather than its name', () => {
    const scenario = cloneScenario(DEMO_SCENARIO);
    const airportStation = scenario.lines[0].stations.find(
      (station) => station.coordinate[0] === scenario.assumptions.airportCoordinate[0] &&
        station.coordinate[1] === scenario.assumptions.airportCoordinate[1]
    );
    if (!airportStation) {
      throw new Error('Demo airport station fixture is missing');
    }
    airportStation.name = 'Terminal Connector';

    expect(nearestStationIdWithinRadius(
      scenario,
      scenario.assumptions.airportCoordinate,
      scenario.assumptions.specialGeneratorRadiusMiles
    )).toBe(airportStation.id);
  });

  it('grows future regional demand with and without transit', () => {
    const noTransitScenario = cloneScenario(DEMO_SCENARIO);
    noTransitScenario.lines = [];
    noTransitScenario.simulationYear = 20;
    const transitScenario = cloneScenario(noTransitScenario);
    transitScenario.lines = [testLine()];
    const noTransit = runSimulation(noTransitScenario, testZones);
    const withTransit = runSimulation(transitScenario, testZones);

    expect(noTransit.baseDailyRegionalTrips).toBe(DEFAULT_ASSUMPTIONS.totalDailyRegionalTrips);
    expect(noTransit.modeledDailyRegionalTrips).toBeGreaterThan(noTransit.baseDailyRegionalTrips);
    expect(withTransit.modeledDailyRegionalTrips).toBeGreaterThan(noTransit.modeledDailyRegionalTrips);
  });

  it('produces identical model results for identical scenarios', () => {
    const scenarioA = cloneScenario(DEMO_SCENARIO);
    const scenarioB = cloneScenario(DEMO_SCENARIO);
    const resultA = runSimulation(scenarioA, PENSACOLA_ZONES);
    const resultB = runSimulation(scenarioB, PENSACOLA_ZONES);
    expect(resultA).toEqual(resultB);
  });

  it('reports capital plus operating cost per annual rider', () => {
    const result = runSimulation(cloneScenario(DEMO_SCENARIO), PENSACOLA_ZONES);

    expect(result.annualizedCapitalCost).toBeGreaterThan(0);
    expect(result.annualizedCostPerRider).toBeCloseTo(
      (result.annualizedCapitalCost + result.annualOperatingCost) / result.annualRidership,
      8
    );
  });

  it('reports zero annualized cost per rider when no riders are served', () => {
    const scenario = cloneScenario(DEMO_SCENARIO);
    scenario.lines = [];

    expect(runSimulation(scenario, testZones).annualizedCostPerRider).toBe(0);
  });

  it('reuses the first model pass for present-day results', () => {
    const scenario = cloneScenario(DEMO_SCENARIO);
    scenario.simulationYear = 0;
    const ridership = estimateNetworkRidership(scenario.lines, testZones, scenario.assumptions);
    const accessibility = calculateAccessibilityScores(scenario.lines, testZones, scenario.assumptions);
    const expectedDevelopment = projectDevelopment(
      testZones,
      accessibility,
      ridership.zoneTransitTrips,
      scenario.assumptions,
      0
    );
    const result = runSimulation(scenario, testZones);

    expect(result.dailyRidership).toBe(ridership.dailyRidership);
    expect(result.zoneResults).toEqual(expectedDevelopment);
  });
});
