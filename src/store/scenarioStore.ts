import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { DEFAULT_ASSUMPTIONS } from '../data/assumptions';
import { DEMO_SCENARIO } from '../data/pensacola/demoScenario';
import { PENSACOLA_ZONES } from '../data/pensacola/zones';
import { runSimulation } from '../simulation/runSimulation';
import { makeId } from '../simulation/geo';
import type {
  AppMode,
  BuildTool,
  Coordinate,
  OverlayKey,
  Scenario,
  Station,
  TransitLine,
  TransitTechnologyId,
  FrequencyMinutes,
  SimulationZone
} from '../types';

export type InspectedFeature =
  | { type: 'zone'; id: string }
  | { type: 'line'; id: string }
  | { type: 'station'; lineId: string; stationId: string }
  | undefined;

interface ScenarioState {
  scenarios: Scenario[];
  activeScenarioId: string;
  selectedLineId?: string;
  selectedStationId?: string;
  mode: AppMode;
  buildTool: BuildTool;
  selectedTechnology: TransitTechnologyId;
  selectedHeadway: FrequencyMinutes;
  overlays: Record<OverlayKey, boolean>;
  inspectedFeature?: InspectedFeature;
  compareScenarioIds: string[];
  lastSavedAt?: string;
  simulationNotice?: string;
  setMode: (mode: AppMode) => void;
  setBuildTool: (buildTool: BuildTool) => void;
  setSelectedTechnology: (technology: TransitTechnologyId) => void;
  setSelectedHeadway: (headway: FrequencyMinutes) => void;
  setActiveScenario: (scenarioId: string) => void;
  newScenario: () => void;
  duplicateScenario: (scenarioId: string) => void;
  deleteScenario: (scenarioId: string) => void;
  restoreDemoScenario: () => void;
  renameScenario: (scenarioId: string, name: string) => void;
  saveScenario: () => void;
  setSimulationYear: (year: number) => void;
  toggleBudgetLimits: () => void;
  toggleOverlay: (overlay: OverlayKey) => void;
  setInspectedFeature: (feature: InspectedFeature) => void;
  createLine: () => string;
  selectLine: (lineId: string) => void;
  addRoutePoint: (coordinate: Coordinate) => void;
  addStation: (coordinate: Coordinate) => void;
  updateStationCoordinate: (lineId: string, stationId: string, coordinate: Coordinate) => void;
  updateLineHeadway: (lineId: string, headway: FrequencyMinutes) => void;
  updateLineTechnology: (lineId: string, technology: TransitTechnologyId) => void;
  renameLine: (lineId: string, name: string) => void;
  renameStation: (lineId: string, stationId: string, name: string) => void;
  removeLastRoutePoint: (lineId: string) => void;
  removeSelected: () => void;
  runActiveSimulation: () => void;
  toggleScenarioComparison: (scenarioId: string) => void;
}

const defaultOverlays: Record<OverlayKey, boolean> = {
  population: true,
  employment: false,
  density: false,
  accessibility: false,
  ridership: false,
  development: false,
  landValue: false,
  catchments: true
};

const memoryValues = new Map<string, string>();
const memoryStorage: StateStorage = {
  getItem: (name) => memoryValues.get(name) ?? null,
  setItem: (name, value) => {
    memoryValues.set(name, value);
  },
  removeItem: (name) => {
    memoryValues.delete(name);
  }
};

function getScenarioStorage(): StateStorage {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage;
    }
  } catch {
    return memoryStorage;
  }
  return memoryStorage;
}

function cloneScenario(scenario: Scenario): Scenario {
  return JSON.parse(JSON.stringify(scenario)) as Scenario;
}

function blankScenario(index: number): Scenario {
  return {
    id: makeId('scenario'),
    name: `New Scenario ${index}`,
    lines: [],
    assumptions: cloneScenario({ ...DEMO_SCENARIO, assumptions: DEFAULT_ASSUMPTIONS }).assumptions,
    simulationYear: 0,
    budgetLimitsEnabled: false
  };
}

function getActiveScenario(state: ScenarioState): Scenario {
  return state.scenarios.find((scenario) => scenario.id === state.activeScenarioId) ?? state.scenarios[0];
}

function updateActiveScenario(
  state: ScenarioState,
  updater: (scenario: Scenario) => Scenario
): Partial<ScenarioState> {
  const activeScenario = getActiveScenario(state);
  return {
    scenarios: state.scenarios.map((scenario) =>
      scenario.id === activeScenario.id ? updater(scenario) : scenario
    ),
    activeScenarioId: activeScenario.id
  };
}

function createTransitLine(state: ScenarioState, scenario: Scenario): TransitLine {
  const technology = scenario.assumptions.technologies[state.selectedTechnology];
  const lineNumber = scenario.lines.length + 1;
  const id = makeId('line');
  return {
    id,
    name: `${technology.name} Line ${lineNumber}`,
    technology: technology.id,
    color: technology.color,
    headwayMinutes: state.selectedHeadway,
    geometry: [],
    stations: []
  };
}

export const useScenarioStore = create<ScenarioState>()(
  persist(
    (set, get) => ({
      scenarios: [cloneScenario(DEMO_SCENARIO)],
      activeScenarioId: DEMO_SCENARIO.id,
      selectedLineId: DEMO_SCENARIO.lines[0]?.id,
      selectedStationId: undefined,
      mode: 'inspect',
      buildTool: 'draw-line',
      selectedTechnology: 'brt',
      selectedHeadway: 10,
      overlays: defaultOverlays,
      inspectedFeature: undefined,
      compareScenarioIds: [DEMO_SCENARIO.id],
      simulationNotice: undefined,
      setMode: (mode) => set({ mode, inspectedFeature: undefined }),
      setBuildTool: (buildTool) => set({ buildTool }),
      setSelectedTechnology: (technology) => set({ selectedTechnology: technology }),
      setSelectedHeadway: (headway) => set({ selectedHeadway: headway }),
      setActiveScenario: (scenarioId) =>
        set((state) => {
          const scenario = state.scenarios.find((candidate) => candidate.id === scenarioId);
          return scenario
            ? {
                activeScenarioId: scenario.id,
                selectedLineId: scenario.lines[0]?.id,
                selectedStationId: undefined,
                inspectedFeature: undefined
              }
            : {};
        }),
      newScenario: () =>
        set((state) => {
          const scenario = blankScenario(state.scenarios.length + 1);
          return {
            scenarios: [...state.scenarios, scenario],
            activeScenarioId: scenario.id,
            selectedLineId: undefined,
            selectedStationId: undefined,
            mode: 'build'
          };
        }),
      duplicateScenario: (scenarioId) =>
        set((state) => {
          const source = state.scenarios.find((scenario) => scenario.id === scenarioId);
          if (!source) {
            return {};
          }
          const copy = cloneScenario(source);
          copy.id = makeId('scenario');
          copy.name = `${source.name} Copy`;
          copy.lines = copy.lines.map((line) => {
            const newLineId = makeId('line');
            return {
              ...line,
              id: newLineId,
              name: line.name,
              stations: line.stations.map((station) => ({
                ...station,
                id: makeId('station'),
                lineId: newLineId
              }))
            };
          });
          return {
            scenarios: [...state.scenarios, copy],
            activeScenarioId: copy.id,
            selectedLineId: copy.lines[0]?.id,
            selectedStationId: undefined
          };
        }),
      deleteScenario: (scenarioId) =>
        set((state) => {
          if (state.scenarios.length <= 1) {
            return {};
          }
          const scenarios = state.scenarios.filter((scenario) => scenario.id !== scenarioId);
          const activeScenarioId =
            state.activeScenarioId === scenarioId ? scenarios[0].id : state.activeScenarioId;
          return {
            scenarios,
            activeScenarioId,
            compareScenarioIds: state.compareScenarioIds.filter((id) => id !== scenarioId)
          };
        }),
      restoreDemoScenario: () =>
        set((state) => {
          const demo = cloneScenario(DEMO_SCENARIO);
          const hasDemoScenario = state.scenarios.some((scenario) => scenario.id === demo.id);
          return {
            scenarios: hasDemoScenario
              ? state.scenarios.map((scenario) => (scenario.id === demo.id ? demo : scenario))
              : [...state.scenarios, demo],
            activeScenarioId: demo.id,
            selectedLineId: demo.lines[0]?.id,
            selectedStationId: undefined,
            inspectedFeature: undefined,
            compareScenarioIds: state.compareScenarioIds.includes(demo.id)
              ? state.compareScenarioIds
              : [...state.compareScenarioIds, demo.id],
            simulationNotice: 'Demo corridor restored.'
          };
        }),
      renameScenario: (scenarioId, name) =>
        set((state) => ({
          scenarios: state.scenarios.map((scenario) =>
            scenario.id === scenarioId ? { ...scenario, name } : scenario
          )
        })),
      saveScenario: () => set({ lastSavedAt: new Date().toISOString() }),
      setSimulationYear: (year) =>
        set((state) =>
          updateActiveScenario(state, (scenario) => ({
            ...scenario,
            simulationYear: year,
            results: undefined
          }))
        ),
      toggleBudgetLimits: () =>
        set((state) =>
          updateActiveScenario(state, (scenario) => ({
            ...scenario,
            budgetLimitsEnabled: !scenario.budgetLimitsEnabled
          }))
        ),
      toggleOverlay: (overlay) =>
        set((state) => ({
          overlays: {
            ...state.overlays,
            [overlay]: !state.overlays[overlay]
          }
        })),
      setInspectedFeature: (feature) =>
        set({
          inspectedFeature: feature,
          selectedLineId: feature?.type === 'line' ? feature.id : get().selectedLineId,
          selectedStationId: feature?.type === 'station' ? feature.stationId : get().selectedStationId
        }),
      createLine: () => {
        let createdLineId = '';
        set((state) =>
          updateActiveScenario(state, (scenario) => {
            const line = createTransitLine(state, scenario);
            createdLineId = line.id;
            return {
              ...scenario,
              lines: [...scenario.lines, line],
              results: undefined
            };
          })
        );
        set({ selectedLineId: createdLineId, selectedStationId: undefined, mode: 'build' });
        return createdLineId;
      },
      selectLine: (lineId) => set({ selectedLineId: lineId, selectedStationId: undefined }),
      addRoutePoint: (coordinate) =>
        set((state) =>
          updateActiveScenario(state, (scenario) => {
            let selectedLineId = state.selectedLineId;
            let lines = scenario.lines;
            if (!selectedLineId || !scenario.lines.some((line) => line.id === selectedLineId)) {
              const line = createTransitLine(state, scenario);
              selectedLineId = line.id;
              lines = [...scenario.lines, line];
              set({ selectedLineId });
            }
            return {
              ...scenario,
              lines: lines.map((line) =>
                line.id === selectedLineId ? { ...line, geometry: [...line.geometry, coordinate] } : line
              ),
              results: undefined
            };
          })
        ),
      addStation: (coordinate) =>
        set((state) =>
          updateActiveScenario(state, (scenario) => {
            let selectedLineId = state.selectedLineId;
            let lines = scenario.lines;
            if (!selectedLineId || !scenario.lines.some((line) => line.id === selectedLineId)) {
              const line = createTransitLine(state, scenario);
              selectedLineId = line.id;
              lines = [...scenario.lines, line];
              set({ selectedLineId });
            }

            return {
              ...scenario,
              lines: lines.map((line) => {
                if (line.id !== selectedLineId) {
                  return line;
                }
                const station: Station = {
                  id: makeId('station'),
                  lineId: line.id,
                  name: `Station ${line.stations.length + 1}`,
                  coordinate,
                  order: line.stations.length
                };
                return {
                  ...line,
                  geometry: line.geometry.length === 0 ? [coordinate] : line.geometry,
                  stations: [...line.stations, station]
                };
              }),
              results: undefined
            };
          })
        ),
      updateStationCoordinate: (lineId, stationId, coordinate) =>
        set((state) =>
          updateActiveScenario(state, (scenario) => ({
            ...scenario,
            lines: scenario.lines.map((line) =>
              line.id === lineId
                ? {
                    ...line,
                    stations: line.stations.map((station) =>
                      station.id === stationId ? { ...station, coordinate } : station
                    )
                  }
                : line
            ),
            results: undefined
          }))
        ),
      updateLineHeadway: (lineId, headway) =>
        set((state) =>
          updateActiveScenario(state, (scenario) => ({
            ...scenario,
            lines: scenario.lines.map((line) =>
              line.id === lineId ? { ...line, headwayMinutes: headway } : line
            ),
            results: undefined
          }))
        ),
      updateLineTechnology: (lineId, technology) =>
        set((state) =>
          updateActiveScenario(state, (scenario) => {
            const technologyConfig = scenario.assumptions.technologies[technology];
            return {
              ...scenario,
              lines: scenario.lines.map((line) =>
                line.id === lineId
                  ? { ...line, technology, color: technologyConfig.color }
                  : line
              ),
              results: undefined
            };
          })
        ),
      renameLine: (lineId, name) =>
        set((state) =>
          updateActiveScenario(state, (scenario) => ({
            ...scenario,
            lines: scenario.lines.map((line) => (line.id === lineId ? { ...line, name } : line))
          }))
        ),
      renameStation: (lineId, stationId, name) =>
        set((state) =>
          updateActiveScenario(state, (scenario) => ({
            ...scenario,
            lines: scenario.lines.map((line) =>
              line.id === lineId
                ? {
                    ...line,
                    stations: line.stations.map((station) =>
                      station.id === stationId ? { ...station, name } : station
                    )
                  }
                : line
            )
          }))
        ),
      removeLastRoutePoint: (lineId) =>
        set((state) =>
          updateActiveScenario(state, (scenario) => ({
            ...scenario,
            lines: scenario.lines.map((line) =>
              line.id === lineId ? { ...line, geometry: line.geometry.slice(0, -1) } : line
            ),
            results: undefined
          }))
        ),
      removeSelected: () =>
        set((state) => {
          const selectedStationId = state.selectedStationId;
          const selectedLineId = state.selectedLineId;
          const update = updateActiveScenario(state, (scenario) => {
            if (state.selectedStationId && state.selectedLineId) {
              return {
                ...scenario,
                lines: scenario.lines.map((line) =>
                  line.id === state.selectedLineId
                    ? {
                        ...line,
                        stations: line.stations
                          .filter((station) => station.id !== state.selectedStationId)
                          .map((station, order) => ({ ...station, order }))
                      }
                    : line
                ),
                results: undefined
              };
            }
            if (state.selectedLineId) {
              return {
                ...scenario,
                lines: scenario.lines.filter((line) => line.id !== state.selectedLineId),
                results: undefined
              };
            }
            return scenario;
          });
          return {
            ...update,
            selectedStationId: selectedStationId ? undefined : state.selectedStationId,
            selectedLineId: selectedLineId && !selectedStationId ? undefined : state.selectedLineId,
            inspectedFeature: undefined
          };
        }),
      runActiveSimulation: () =>
        set((state) => {
          const activeScenario = getActiveScenario(state);
          const now = new Date().toISOString();
          const results = {
            ...runSimulation(activeScenario, PENSACOLA_ZONES),
            generatedAt: now
          };
          const hasUsableService = activeScenario.lines.some((line) => line.stations.length >= 2);
          const simulationNotice = hasUsableService
            ? `Simulation complete: ${Math.round(results.dailyRidership).toLocaleString()} weekday riders.`
            : 'Simulation complete, but no usable service exists yet. Place at least two stations on one line.';

          return {
            scenarios: state.scenarios.map((scenario) =>
              scenario.id === activeScenario.id ? { ...scenario, results } : scenario
            ),
            activeScenarioId: activeScenario.id,
            simulationNotice
          };
        }),
      toggleScenarioComparison: (scenarioId) =>
        set((state) => ({
          compareScenarioIds: state.compareScenarioIds.includes(scenarioId)
            ? state.compareScenarioIds.filter((id) => id !== scenarioId)
            : [...state.compareScenarioIds, scenarioId]
        }))
    }),
    {
      name: 'metro-pensacola-scenarios',
      version: 1,
      storage: createJSONStorage(getScenarioStorage)
    }
  )
);

export function selectActiveScenario(state: ScenarioState): Scenario {
  return getActiveScenario(state);
}
