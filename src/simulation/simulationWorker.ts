import type { Scenario, SimulationZone } from '../types';
import { runSimulation } from './runSimulation';

interface SimulationRequest {
  requestId: number;
  scenario: Scenario;
  zones: SimulationZone[];
}

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<SimulationRequest>) => void) | null;
  postMessage: (message: unknown) => void;
};

scope.onmessage = (event) => {
  const { requestId, scenario, zones } = event.data;
  try {
    scope.postMessage({ requestId, results: runSimulation(scenario, zones) });
  } catch (error) {
    scope.postMessage({
      requestId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
};
