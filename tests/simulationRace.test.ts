import { beforeEach, describe, expect, it, vi } from 'vitest';

const workerControl = vi.hoisted(() => ({
  resolvers: [] as Array<(results: unknown) => void>
}));

vi.mock('../src/simulation/simulationClient', () => ({
  supportsSimulationWorker: () => true,
  runSimulationAsync: () =>
    new Promise((resolve) => {
      workerControl.resolvers.push(resolve);
    })
}));

import { DEMO_SCENARIO } from '../src/data/pensacola/demoScenario';
import { useScenarioStore } from '../src/store/scenarioStore';
import type { Scenario, SimulationResults } from '../src/types';

function cloneScenario(scenario: Scenario): Scenario {
  return JSON.parse(JSON.stringify(scenario)) as Scenario;
}

const fakeResults = { dailyRidership: 1234 } as unknown as SimulationResults;

async function completePendingRun() {
  const resolve = workerControl.resolvers.shift();
  expect(resolve).toBeDefined();
  resolve!(fakeResults);
  await new Promise((r) => setTimeout(r, 0));
}

function scenarioById(id: string): Scenario | undefined {
  return useScenarioStore.getState().scenarios.find((scenario) => scenario.id === id);
}

describe('simulation worker completion races', () => {
  let demo: Scenario;
  let second: Scenario;

  beforeEach(() => {
    workerControl.resolvers = [];
    demo = cloneScenario(DEMO_SCENARIO);
    second = { ...cloneScenario(DEMO_SCENARIO), id: 'second-scenario', name: 'Second' };
    useScenarioStore.setState({
      scenarios: [demo, second],
      activeScenarioId: demo.id,
      isSimulating: false,
      simulationNotice: undefined
    });
  });

  it('sets isSimulating while the worker runs and ignores duplicate requests', () => {
    useScenarioStore.getState().runActiveSimulation();
    expect(useScenarioStore.getState().isSimulating).toBe(true);
    useScenarioStore.getState().runActiveSimulation();
    expect(workerControl.resolvers).toHaveLength(1);
  });

  it('keeps a mid-run rename and still attaches results', async () => {
    useScenarioStore.getState().runActiveSimulation();
    useScenarioStore.getState().renameScenario(demo.id, 'Renamed Mid-Run');
    await completePendingRun();

    const scenario = scenarioById(demo.id);
    expect(scenario?.name).toBe('Renamed Mid-Run');
    expect(scenario?.results?.dailyRidership).toBe(1234);
    expect(useScenarioStore.getState().isSimulating).toBe(false);
  });

  it('discards results when the simulation year changes mid-run', async () => {
    useScenarioStore.getState().runActiveSimulation();
    useScenarioStore.getState().setSimulationYear(10);
    await completePendingRun();

    const scenario = scenarioById(demo.id);
    expect(scenario?.simulationYear).toBe(10);
    expect(scenario?.results).toBeUndefined();
    expect(useScenarioStore.getState().simulationNotice).toContain('changed during the run');
    expect(useScenarioStore.getState().isSimulating).toBe(false);
  });

  it('does not restore the simulated scenario as active after a mid-run switch', async () => {
    useScenarioStore.getState().runActiveSimulation();
    useScenarioStore.getState().setActiveScenario(second.id);
    await completePendingRun();

    expect(useScenarioStore.getState().activeScenarioId).toBe(second.id);
    expect(scenarioById(demo.id)?.results?.dailyRidership).toBe(1234);
  });

  it('only clears isSimulating when the simulated scenario was deleted mid-run', async () => {
    useScenarioStore.getState().runActiveSimulation();
    useScenarioStore.getState().deleteScenario(demo.id);
    await completePendingRun();

    expect(scenarioById(demo.id)).toBeUndefined();
    expect(useScenarioStore.getState().activeScenarioId).toBe(second.id);
    expect(useScenarioStore.getState().isSimulating).toBe(false);
  });
});
