import { DEFAULT_ASSUMPTIONS } from '../assumptions';
import type { Scenario, Station, TransitLine } from '../../types';

const demoStations: Omit<Station, 'lineId'>[] = [
  { id: 'demo-downtown', name: 'Downtown Pensacola', coordinate: [-87.2155, 30.4122], order: 0 },
  { id: 'demo-baptist', name: 'Baptist Health Campus', coordinate: [-87.2254, 30.4778], order: 1 },
  { id: 'demo-cordova', name: 'Cordova Mall', coordinate: [-87.2076, 30.4756], order: 2 },
  { id: 'demo-airport', name: 'Pensacola International Airport', coordinate: [-87.1866, 30.4734], order: 3 },
  { id: 'demo-ferry-pass', name: 'Ferry Pass', coordinate: [-87.2122, 30.5144], order: 4 },
  { id: 'demo-uwf', name: 'University of West Florida', coordinate: [-87.2181, 30.5495], order: 5 }
];

const demoLineId = 'demo-airport-uwf';

const demoLine: TransitLine = {
  id: demoLineId,
  name: 'Conceptual Airport-UWF Corridor',
  technology: 'light-rail',
  color: DEFAULT_ASSUMPTIONS.technologies['light-rail'].color,
  headwayMinutes: 10,
  geometry: demoStations.map((station) => station.coordinate),
  stations: demoStations.map((station) => ({ ...station, lineId: demoLineId }))
};

export const DEMO_SCENARIO: Scenario = {
  id: 'demo-conceptual-corridor',
  name: 'Demo: Conceptual Airport-UWF Corridor',
  lines: [demoLine],
  assumptions: DEFAULT_ASSUMPTIONS,
  simulationYear: 0,
  budgetLimitsEnabled: false
};
