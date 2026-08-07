import { describe, expect, it } from 'vitest';
import { DEFAULT_ASSUMPTIONS } from '../src/data/assumptions';
import { DEMO_SCENARIO } from '../src/data/pensacola/demoScenario';
import { PENSACOLA_ZONES } from '../src/data/pensacola/zones';
import { calculateStationCatchment } from '../src/simulation/catchment';
import { averageWaitTime, calculateConstructionCost, calculateLineMileage } from '../src/simulation/costs';
import { projectDevelopment } from '../src/simulation/development';
import { lineMileage } from '../src/simulation/geo';
import { estimateNetworkRidership } from '../src/simulation/ridership';
import { fastestTransitPath } from '../src/simulation/routing';
import { runSimulation } from '../src/simulation/runSimulation';
import {
  buildRoadNetwork,
  roadPathBetweenCoordinates,
  snapCoordinateToLineGeometry,
  snapCoordinateToRoadCorridors,
  type CorridorCollection
} from '../src/simulation/snapping';
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
});

describe('routing and ridership', () => {
  it('finds a transit path between connected stations', () => {
    const assumptions = cloneAssumptions();
    const line = testLine();
    const path = fastestTransitPath(testZones[0].centroid, testZones[1].centroid, [line], assumptions);
    expect(path).toBeDefined();
    expect(path?.lineIds).toContain(line.id);
    expect(path?.totalMinutes).toBeGreaterThan(0);
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

  it('produces identical model results for identical scenarios', () => {
    const scenarioA = cloneScenario(DEMO_SCENARIO);
    const scenarioB = cloneScenario(DEMO_SCENARIO);
    const resultA = runSimulation(scenarioA, PENSACOLA_ZONES);
    const resultB = runSimulation(scenarioB, PENSACOLA_ZONES);
    expect(resultA).toEqual(resultB);
  });
});
