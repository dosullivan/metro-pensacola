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
    resetStore(scenario);

    useScenarioStore.getState().removeLastRoutePoint(originalLineId);

    const activeScenario = selectActiveScenario(useScenarioStore.getState());
    const updatedLine = activeScenario.lines.find((candidate) => candidate.id === originalLineId);
    expect(updatedLine).toBeDefined();
    expect(updatedLine?.geometry).toHaveLength(originalPointCount - 1);
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
