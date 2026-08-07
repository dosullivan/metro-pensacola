import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ASSUMPTIONS } from '../src/data/assumptions';
import { DEMO_SCENARIO } from '../src/data/pensacola/demoScenario';
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
    mode: 'inspect',
    buildTool: 'draw-line',
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
});
