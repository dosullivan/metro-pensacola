import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ASSUMPTIONS } from '../src/data/assumptions';
import { DEMO_SCENARIO } from '../src/data/pensacola/demoScenario';
import { snapCoordinateToLineGeometry } from '../src/simulation/snapping';
import { selectActiveScenario, useScenarioStore } from '../src/store/scenarioStore';
import type { Scenario } from '../src/types';

function cloneScenario(scenario: Scenario): Scenario {
  return JSON.parse(JSON.stringify(scenario)) as Scenario;
}

function resetStore(scenario: Scenario) {
  useScenarioStore.setState({
    scenarios: [scenario],
    activeScenarioId: scenario.id,
    selectedLineId: scenario.lines[0]?.id,
    selectedStationId: undefined,
    selectedRoutePointIndex: undefined,
    mode: 'inspect',
    buildTool: 'draw-line',
    roadSnapEnabled: false,
    selectedTechnology: 'brt',
    selectedHeadway: 10,
    overlays: {
      population: true,
      employment: false,
      density: false,
      accessibility: false,
      ridership: false,
      development: false,
      landValue: false,
      catchments: true
    },
    compareScenarioIds: [scenario.id],
    simulationNotice: undefined,
    inspectedFeature: undefined
  });
}

describe('scenario store simulation action', () => {
  beforeEach(() => {
    resetStore(cloneScenario(DEMO_SCENARIO));
  });

  it('writes simulation results for the active scenario', () => {
    useScenarioStore.getState().runActiveSimulation();

    const activeScenario = selectActiveScenario(useScenarioStore.getState());
    expect(activeScenario.results?.dailyRidership).toBeGreaterThan(0);
    expect(useScenarioStore.getState().simulationNotice).toContain('Simulation complete');
  });

  it('shows an explicit notice when there is no usable service', () => {
    const blankScenario: Scenario = {
      id: 'blank',
      name: 'Blank Scenario',
      lines: [],
      assumptions: DEFAULT_ASSUMPTIONS,
      simulationYear: 0,
      budgetLimitsEnabled: false
    };
    resetStore(blankScenario);

    useScenarioStore.getState().runActiveSimulation();

    const activeScenario = selectActiveScenario(useScenarioStore.getState());
    expect(activeScenario.results?.dailyRidership).toBe(0);
    expect(activeScenario.results?.messages[0].id).toBe('no-service');
    expect(useScenarioStore.getState().simulationNotice).toContain('no usable service');
  });

  it('undoes only the last route point without deleting the line', () => {
    const scenario = cloneScenario(DEMO_SCENARIO);
    const line = scenario.lines[0];
    const originalLineId = line.id;
    const originalPointCount = line.geometry.length;
    const originalStationCount = line.stations.length;
    resetStore(scenario);

    useScenarioStore.getState().removeLastRoutePoint(originalLineId);

    const activeScenario = selectActiveScenario(useScenarioStore.getState());
    const updatedLine = activeScenario.lines.find((candidate) => candidate.id === originalLineId);
    expect(updatedLine).toBeDefined();
    expect(updatedLine?.geometry).toHaveLength(originalPointCount - 1);
    expect(updatedLine?.stations).toHaveLength(originalStationCount - 1);
    expect(activeScenario.lines).toHaveLength(1);
  });

  it('restores the bundled demo scenario after its route is deleted', () => {
    const scenario = cloneScenario(DEMO_SCENARIO);
    scenario.lines = [];
    resetStore(scenario);

    useScenarioStore.getState().restoreDemoScenario();

    const activeScenario = selectActiveScenario(useScenarioStore.getState());
    expect(activeScenario.id).toBe(DEMO_SCENARIO.id);
    expect(activeScenario.lines).toHaveLength(1);
    expect(activeScenario.lines[0].stations.length).toBeGreaterThan(1);
    expect(useScenarioStore.getState().selectedLineId).toBe(activeScenario.lines[0].id);
  });

  it('treats zone overlays as exclusive while keeping catchments independent', () => {
    resetStore(cloneScenario(DEMO_SCENARIO));

    useScenarioStore.getState().toggleOverlay('employment');

    expect(useScenarioStore.getState().overlays.population).toBe(false);
    expect(useScenarioStore.getState().overlays.employment).toBe(true);
    expect(useScenarioStore.getState().overlays.catchments).toBe(true);

    useScenarioStore.getState().toggleOverlay('density');

    expect(useScenarioStore.getState().overlays.employment).toBe(false);
    expect(useScenarioStore.getState().overlays.density).toBe(true);
    expect(useScenarioStore.getState().overlays.catchments).toBe(true);

    useScenarioStore.getState().toggleOverlay('catchments');

    expect(useScenarioStore.getState().overlays.density).toBe(true);
    expect(useScenarioStore.getState().overlays.catchments).toBe(false);
  });

  it('updates, inserts, and removes route vertices without deleting the line', () => {
    const scenario = cloneScenario(DEMO_SCENARIO);
    const lineId = scenario.lines[0].id;
    resetStore(scenario);

    useScenarioStore.getState().updateRoutePointCoordinate(lineId, 1, [-87.2, 30.45]);
    useScenarioStore.getState().insertRoutePointAfter(lineId, 1);
    useScenarioStore.getState().selectRoutePoint(lineId, 2);
    useScenarioStore.getState().removeSelected();

    const activeScenario = selectActiveScenario(useScenarioStore.getState());
    const line = activeScenario.lines.find((candidate) => candidate.id === lineId);
    expect(line).toBeDefined();
    expect(line?.geometry[1]).toEqual([-87.2, 30.45]);
    expect(activeScenario.lines).toHaveLength(1);
    expect(useScenarioStore.getState().selectedLineId).toBe(lineId);
  });

  it('keeps stations snapped to the line when route vertices move', () => {
    const scenario = cloneScenario(DEMO_SCENARIO);
    const line = scenario.lines[0];
    line.geometry = [
      [-87.22, 30.42],
      [-87.18, 30.42]
    ];
    line.stations = [
      {
        id: 'midpoint-station',
        lineId: line.id,
        name: 'Midpoint',
        coordinate: [-87.2, 30.42],
        order: 0
      }
    ];
    resetStore(scenario);

    const movedGeometry: [number, number][] = [
      [-87.22, 30.42],
      [-87.18, 30.46]
    ];
    useScenarioStore.getState().updateRoutePointCoordinate(line.id, 1, movedGeometry[1]);

    const updatedLine = selectActiveScenario(useScenarioStore.getState()).lines[0];
    const expected = snapCoordinateToLineGeometry([-87.2, 30.42], movedGeometry).coordinate;
    expect(updatedLine.stations[0].coordinate[0]).toBeCloseTo(expected[0], 6);
    expect(updatedLine.stations[0].coordinate[1]).toBeCloseTo(expected[1], 6);
    expect(updatedLine.stations[0].coordinate).not.toEqual([-87.2, 30.42]);
  });

  it('moves the matching route vertex when a station on that vertex is dragged', () => {
    const scenario = cloneScenario(DEMO_SCENARIO);
    const line = scenario.lines[0];
    line.geometry = [
      [-87.22, 30.42],
      [-87.2, 30.42],
      [-87.18, 30.42]
    ];
    line.stations = [
      {
        id: 'vertex-station',
        lineId: line.id,
        name: 'Vertex Station',
        coordinate: [-87.2, 30.42],
        order: 0
      }
    ];
    resetStore(scenario);

    useScenarioStore.getState().updateStationCoordinate(line.id, 'vertex-station', [-87.2, 30.44]);

    const updatedLine = selectActiveScenario(useScenarioStore.getState()).lines[0];
    expect(updatedLine.geometry).toHaveLength(3);
    expect(updatedLine.geometry[1]).toEqual([-87.2, 30.44]);
    expect(updatedLine.stations[0].coordinate).toEqual([-87.2, 30.44]);
  });

  it('inserts a route vertex when dragging a station that sits between route points', () => {
    const scenario = cloneScenario(DEMO_SCENARIO);
    const line = scenario.lines[0];
    line.geometry = [
      [-87.22, 30.42],
      [-87.18, 30.42]
    ];
    line.stations = [
      {
        id: 'segment-station',
        lineId: line.id,
        name: 'Segment Station',
        coordinate: [-87.2, 30.42],
        order: 0
      }
    ];
    resetStore(scenario);

    useScenarioStore.getState().updateStationCoordinate(line.id, 'segment-station', [-87.2, 30.44]);

    const updatedLine = selectActiveScenario(useScenarioStore.getState()).lines[0];
    expect(updatedLine.geometry).toHaveLength(3);
    expect(updatedLine.geometry[1]).toEqual([-87.2, 30.44]);
    expect(updatedLine.stations[0].coordinate).toEqual([-87.2, 30.44]);
  });

  it('selects a newly placed station so the delete button removes that station', () => {
    const scenario = cloneScenario(DEMO_SCENARIO);
    const lineId = scenario.lines[0].id;
    const originalStationCount = scenario.lines[0].stations.length;
    resetStore(scenario);

    useScenarioStore.getState().addStation([-87.21, 30.5]);
    const selectedStationId = useScenarioStore.getState().selectedStationId;
    expect(selectedStationId).toBeDefined();

    useScenarioStore.getState().removeSelected();

    const line = selectActiveScenario(useScenarioStore.getState()).lines.find((candidate) => candidate.id === lineId);
    expect(line?.stations).toHaveLength(originalStationCount);
    expect(line?.stations.some((station) => station.id === selectedStationId)).toBe(false);
    expect(useScenarioStore.getState().selectedLineId).toBe(lineId);
  });

  it('creates route geometry from the first two stations on a new station-first line', () => {
    const scenario = cloneScenario(DEMO_SCENARIO);
    scenario.lines = [];
    resetStore(scenario);

    useScenarioStore.getState().createLine();
    const lineId = useScenarioStore.getState().selectedLineId as string;
    useScenarioStore.getState().addStation([-87.22, 30.42]);
    useScenarioStore.getState().addStation([-87.18, 30.46]);

    const line = selectActiveScenario(useScenarioStore.getState()).lines.find((candidate) => candidate.id === lineId);
    expect(line?.stations).toHaveLength(2);
    expect(line?.geometry).toEqual([
      [-87.22, 30.42],
      [-87.18, 30.46]
    ]);
  });

  it('creates stations when drawing a route in the default route build mode', () => {
    const scenario = cloneScenario(DEMO_SCENARIO);
    scenario.lines = [];
    resetStore(scenario);

    useScenarioStore.getState().addRouteStop([-87.22, 30.42]);
    useScenarioStore.getState().addRouteStop([-87.2, 30.44]);
    useScenarioStore.getState().addRouteStop([-87.18, 30.46]);

    const line = selectActiveScenario(useScenarioStore.getState()).lines[0];
    expect(line.geometry).toHaveLength(3);
    expect(line.stations).toHaveLength(3);
    expect(line.stations.map((station) => station.coordinate)).toEqual(line.geometry);
  });

  it('keeps road-following geometry when a route stop is added with an OSM path segment', () => {
    const scenario = cloneScenario(DEMO_SCENARIO);
    scenario.lines = [];
    resetStore(scenario);

    useScenarioStore.getState().addRouteStop([-87.22, 30.42]);
    useScenarioStore.getState().addRouteStop([-87.18, 30.46], [
      [-87.22, 30.42],
      [-87.2, 30.42],
      [-87.2, 30.46],
      [-87.18, 30.46]
    ]);

    const line = selectActiveScenario(useScenarioStore.getState()).lines[0];
    expect(line.geometry).toEqual([
      [-87.22, 30.42],
      [-87.2, 30.42],
      [-87.2, 30.46],
      [-87.18, 30.46]
    ]);
    expect(line.stations).toHaveLength(2);
    expect(line.stations[1].coordinate).toEqual([-87.18, 30.46]);
  });

  it('bends an existing route through a newly added transfer stop', () => {
    const scenario = cloneScenario(DEMO_SCENARIO);
    scenario.lines = [];
    resetStore(scenario);

    useScenarioStore.getState().addRouteStop([-87.22, 30.42]);
    useScenarioStore.getState().addRouteStop([-87.18, 30.42]);
    const lineId = selectActiveScenario(useScenarioStore.getState()).lines[0].id;

    useScenarioStore.getState().addStation([-87.2, 30.44]);

    const line = selectActiveScenario(useScenarioStore.getState()).lines.find((candidate) => candidate.id === lineId);
    expect(line?.geometry).toEqual([
      [-87.22, 30.42],
      [-87.2, 30.44],
      [-87.18, 30.42]
    ]);
    expect(line?.stations[(line?.stations.length ?? 1) - 1]?.coordinate).toEqual([-87.2, 30.44]);
  });

  it('undoes the station created by the last route-mode click', () => {
    const scenario = cloneScenario(DEMO_SCENARIO);
    scenario.lines = [];
    resetStore(scenario);

    useScenarioStore.getState().addRouteStop([-87.22, 30.42]);
    useScenarioStore.getState().addRouteStop([-87.2, 30.44]);
    const lineId = selectActiveScenario(useScenarioStore.getState()).lines[0].id;

    useScenarioStore.getState().removeLastRoutePoint(lineId);

    const line = selectActiveScenario(useScenarioStore.getState()).lines[0];
    expect(line.geometry).toEqual([[-87.22, 30.42]]);
    expect(line.stations).toHaveLength(1);
    expect(line.stations[0].coordinate).toEqual([-87.22, 30.42]);
  });

  it('repairs saved geometry-only lines by creating stops from shape points', () => {
    const scenario = cloneScenario(DEMO_SCENARIO);
    scenario.lines[0].stations = [];
    resetStore(scenario);

    useScenarioStore.getState().repairGeometryOnlyLines();

    const line = selectActiveScenario(useScenarioStore.getState()).lines[0];
    expect(line.stations).toHaveLength(line.geometry.length);
    expect(line.stations.map((station) => station.coordinate)).toEqual(line.geometry);
  });

  it('repairs geometry-only lines before running simulation', () => {
    const scenario = cloneScenario(DEMO_SCENARIO);
    scenario.lines[0].stations = [];
    resetStore(scenario);

    useScenarioStore.getState().runActiveSimulation();

    const line = selectActiveScenario(useScenarioStore.getState()).lines[0];
    expect(line.stations).toHaveLength(line.geometry.length);
    expect(selectActiveScenario(useScenarioStore.getState()).results?.dailyRidership).toBeGreaterThan(0);
  });

  it('deletes a selected station from its own line even if another line was selected first', () => {
    const scenario = cloneScenario(DEMO_SCENARIO);
    const firstLine = scenario.lines[0];
    const secondLine = {
      ...cloneScenario(DEMO_SCENARIO).lines[0],
      id: 'second-line',
      name: 'Second Line',
      stations: cloneScenario(DEMO_SCENARIO).lines[0].stations.map((station) => ({
        ...station,
        id: `second-${station.id}`,
        lineId: 'second-line'
      }))
    };
    scenario.lines = [firstLine, secondLine];
    resetStore(scenario);
    useScenarioStore.getState().selectLine(firstLine.id);

    const stationId = secondLine.stations[0].id;
    useScenarioStore.getState().setInspectedFeature({ type: 'station', lineId: secondLine.id, stationId });
    useScenarioStore.getState().removeSelected();

    const activeScenario = selectActiveScenario(useScenarioStore.getState());
    const updatedFirstLine = activeScenario.lines.find((line) => line.id === firstLine.id);
    const updatedSecondLine = activeScenario.lines.find((line) => line.id === secondLine.id);
    expect(updatedFirstLine?.stations).toHaveLength(firstLine.stations.length);
    expect(updatedSecondLine?.stations.some((station) => station.id === stationId)).toBe(false);
    expect(updatedSecondLine?.stations).toHaveLength(secondLine.stations.length - 1);
  });

  it('reorders stations on a line', () => {
    const scenario = cloneScenario(DEMO_SCENARIO);
    const lineId = scenario.lines[0].id;
    const stationId = scenario.lines[0].stations[1].id;
    resetStore(scenario);

    useScenarioStore.getState().moveStation(lineId, stationId, -1);

    const line = selectActiveScenario(useScenarioStore.getState()).lines[0];
    expect(line.stations.find((station) => station.id === stationId)?.order).toBe(0);
  });
});
