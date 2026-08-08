import type { Scenario, SimulationResults, SimulationZone } from '../types';
import { runSimulation } from './runSimulation';

interface PendingRequest {
  resolve: (results: SimulationResults) => void;
  reject: (error: Error) => void;
}

interface SimulationResponse {
  requestId: number;
  results?: SimulationResults;
  error?: string;
}

let worker: Worker | undefined;
let nextRequestId = 0;
const pendingRequests = new Map<number, PendingRequest>();

export function supportsSimulationWorker(): boolean {
  return typeof Worker !== 'undefined';
}

function failAllPending(error: Error): void {
  for (const request of pendingRequests.values()) {
    request.reject(error);
  }
  pendingRequests.clear();
}

function ensureWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./simulationWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<SimulationResponse>) => {
      const { requestId, results, error } = event.data;
      const request = pendingRequests.get(requestId);
      if (!request) {
        return;
      }
      pendingRequests.delete(requestId);
      if (results) {
        request.resolve(results);
      } else {
        request.reject(new Error(error ?? 'Simulation worker returned no results.'));
      }
    };
    worker.onerror = () => {
      failAllPending(new Error('Simulation worker failed.'));
      worker?.terminate();
      worker = undefined;
    };
  }
  return worker;
}

export function runSimulationAsync(
  scenario: Scenario,
  zones: SimulationZone[]
): Promise<SimulationResults> {
  if (!supportsSimulationWorker()) {
    return Promise.resolve(runSimulation(scenario, zones));
  }
  const requestId = nextRequestId++;
  return new Promise<SimulationResults>((resolve, reject) => {
    pendingRequests.set(requestId, { resolve, reject });
    ensureWorker().postMessage({ requestId, scenario, zones });
  });
}
