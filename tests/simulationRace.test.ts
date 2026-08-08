import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const workerControl = vi.hoisted(() => ({
  requests: [] as Array<{
    scenario: unknown;
    resolve: (results: unknown) => void;
  }>
}));

vi.mock('../src/simulation/simulationClient', () => ({
  supportsSimulationWorker: () => true,
  runSimulationAsync: (scenario: unknown) =>
    new Promise((resolve) => {
      workerControl.requests.push({ scenario, resolve });
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
  const request = workerControl.requests.shift();
  expect(request).toBeDefined();
  request!.resolve(fakeResults);
  await new Promise((r) => setTimeout(r, 0));
}

async function resolveRequestWithFakeTimers(index = 0) {
  const request = workerControl.requests[index];
  expect(request).toBeDefined();
  request.resolve(fakeResults);
  await Promise.resolve();
  await Promise.resolve();
}

function scenarioById(id: string): Scenario | undefined {
  return useScenarioStore.getState().scenarios.find((scenario) => scenario.id === id);
}

describe('simulation worker completion races', () => {
  let demo: Scenario;
  let second: Scenario;

  beforeEach(() => {
    workerControl.requests = [];
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
    expect(workerControl.requests).toHaveLength(1);
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

describe('career live simulation scheduling', () => {
  let demo: Scenario;

  beforeEach(() => {
    vi.useFakeTimers();
    workerControl.requests = [];
    demo = cloneScenario(DEMO_SCENARIO);
    useScenarioStore.setState({
      scenarios: [demo],
      activeScenarioId: demo.id,
      isSimulating: false,
      simulationNotice: undefined
    });
  });

  afterEach(() => {
    useScenarioStore.getState().setScenarioGameMode('sandbox');
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('debounces and coalesces rapid simulation-input edits', async () => {
    useScenarioStore.getState().setScenarioGameMode('career');
    useScenarioStore.getState().setSimulationYear(5);
    useScenarioStore.getState().setSimulationYear(10);

    await vi.advanceTimersByTimeAsync(299);
    expect(workerControl.requests).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);

    expect(workerControl.requests).toHaveLength(1);
    expect((workerControl.requests[0].scenario as Scenario).simulationYear).toBe(10);
    expect(useScenarioStore.getState().isSimulating).toBe(true);
  });

  it('runs exactly one latest-input follow-up after an in-flight edit', async () => {
    useScenarioStore.getState().setScenarioGameMode('career');
    await vi.advanceTimersByTimeAsync(300);
    expect(workerControl.requests).toHaveLength(1);

    useScenarioStore.getState().setSimulationYear(5);
    useScenarioStore.getState().setSimulationYear(10);
    await vi.advanceTimersByTimeAsync(300);
    expect(workerControl.requests).toHaveLength(1);

    await resolveRequestWithFakeTimers(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(workerControl.requests).toHaveLength(2);
    expect((workerControl.requests[1].scenario as Scenario).simulationYear).toBe(10);

    await resolveRequestWithFakeTimers(1);
    expect(scenarioById(demo.id)?.results?.dailyRidership).toBe(1234);
    expect(useScenarioStore.getState().isSimulating).toBe(false);
  });

  it('does not rerun for an unchanged fingerprint or when live results are off', async () => {
    useScenarioStore.getState().setScenarioGameMode('career');
    await vi.advanceTimersByTimeAsync(300);
    expect(workerControl.requests).toHaveLength(1);
    await resolveRequestWithFakeTimers(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(workerControl.requests).toHaveLength(1);

    useScenarioStore.getState().toggleAutoSimulation();
    useScenarioStore.getState().setSimulationYear(20);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(workerControl.requests).toHaveLength(1);
  });
});
