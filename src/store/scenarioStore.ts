import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { DEFAULT_ASSUMPTIONS } from '../data/assumptions';
import { DEMO_SCENARIO } from '../data/pensacola/demoScenario';
import { PENSACOLA_ZONES } from '../data/pensacola/zones';
import { runSimulation } from '../simulation/runSimulation';
import { distanceMiles, makeId } from '../simulation/geo';
import { snapCoordinateToLineGeometry } from '../simulation/snapping';
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

const STATION_VERTEX_PULL_DISTANCE_FEET = 150;

interface ScenarioState {
  scenarios: Scenario[];
  activeScenarioId: string;
  selectedLineId?: string;
  selectedStationId?: string;
  selectedRoutePointIndex?: number;
  mode: AppMode;
  buildTool: BuildTool;
  roadSnapEnabled: boolean;
  selectedTechnology: TransitTechnologyId;
  selectedHeadway: FrequencyMinutes;
  overlays: Record<OverlayKey, boolean>;
  inspectedFeature?: InspectedFeature;
  compareScenarioIds: string[];
  lastSavedAt?: string;
  simulationNotice?: string;
  setMode: (mode: AppMode) => void;
  setBuildTool: (buildTool: BuildTool) => void;
  setRoadSnapEnabled: (enabled: boolean) => void;
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
  selectRoutePoint: (lineId: string, pointIndex: number) => void;
  addRoutePoint: (coordinate: Coordinate) => void;
  addRouteStop: (coordinate: Coordinate) => void;
  addStation: (coordinate: Coordinate) => void;
  updateRoutePointCoordinate: (lineId: string, pointIndex: number, coordinate: Coordinate) => void;
  removeRoutePoint: (lineId: string, pointIndex: number) => void;
  insertRoutePointAfter: (lineId: string, pointIndex: number) => void;
  updateStationCoordinate: (lineId: string, stationId: string, coordinate: Coordinate) => void;
  moveStation: (lineId: string, stationId: string, direction: -1 | 1) => void;
  removeStation: (lineId: string, stationId: string) => void;
  updateLineHeadway: (lineId: string, headway: FrequencyMinutes) => void;
  updateLineTechnology: (lineId: string, technology: TransitTechnologyId) => void;
  renameLine: (lineId: string, name: string) => void;
  renameStation: (lineId: string, stationId: string, name: string) => void;
  removeLastRoutePoint: (lineId: string) => void;
  removeSelected: () => void;
  repairGeometryOnlyLines: () => void;
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

const zoneOverlayKeys: OverlayKey[] = [
  'population',
  'employment',
  'density',
  'accessibility',
  'ridership',
  'development',
  'landValue'
];

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

function closestRouteVertexIndex(geometry: Coordinate[], coordinate: Coordinate): number | undefined {
  if (geometry.length === 0) {
    return undefined;
  }

  let closestIndex = 0;
  let closestDistanceFeet = Number.POSITIVE_INFINITY;
  geometry.forEach((point, index) => {
    const distanceFeet = distanceMiles(point, coordinate) * 5280;
    if (distanceFeet < closestDistanceFeet) {
      closestDistanceFeet = distanceFeet;
      closestIndex = index;
    }
  });

  return closestDistanceFeet <= STATION_VERTEX_PULL_DISTANCE_FEET ? closestIndex : undefined;
}

function geometryPulledByStation(
  line: TransitLine,
  station: Station,
  coordinate: Coordinate
): Coordinate[] {
  if (line.geometry.length <= 1) {
    return [coordinate];
  }

  const vertexIndex = closestRouteVertexIndex(line.geometry, station.coordinate);
  if (vertexIndex !== undefined) {
    return line.geometry.map((point, index) => (index === vertexIndex ? coordinate : point));
  }

  const snapResult = snapCoordinateToLineGeometry(station.coordinate, line.geometry);
  const insertIndex =
    snapResult.segmentStartIndex !== undefined
      ? snapResult.segmentStartIndex + 1
      : line.geometry.length;

  return [
    ...line.geometry.slice(0, insertIndex),
    coordinate,
    ...line.geometry.slice(insertIndex)
  ];
}

function withGeometryAndSnappedStations(
  line: TransitLine,
  geometry: Coordinate[],
  pinnedStation?: { stationId: string; coordinate: Coordinate }
): TransitLine {
  if (geometry.length === 0) {
    return {
      ...line,
      geometry,
      stations: line.stations.map((station) =>
        station.id === pinnedStation?.stationId
          ? { ...station, coordinate: pinnedStation.coordinate }
          : station
      )
    };
  }

  return {
    ...line,
    geometry,
    stations: line.stations.map((station) => ({
      ...station,
      coordinate:
        station.id === pinnedStation?.stationId
          ? pinnedStation.coordinate
          : snapCoordinateToLineGeometry(station.coordinate, geometry).coordinate
    }))
  };
}

function withoutStation(line: TransitLine, stationId: string): TransitLine {
  return {
    ...line,
    stations: line.stations
      .filter((station) => station.id !== stationId)
      .map((station, order) => ({ ...station, order }))
  };
}

function latestStationNearCoordinate(line: TransitLine, coordinate: Coordinate): string | undefined {
  const latestStation = [...line.stations]
    .sort((a, b) => b.order - a.order)
    .find((station) => distanceMiles(station.coordinate, coordinate) * 5280 < 20);
  return latestStation?.id;
}

function withLastRoutePointRemoved(line: TransitLine): TransitLine {
  if (line.geometry.length === 0) {
    return line;
  }

  const removedCoordinate = line.geometry[line.geometry.length - 1];
  const stationId = latestStationNearCoordinate(line, removedCoordinate);
  const lineWithoutRouteStop = stationId ? withoutStation(line, stationId) : line;
  return withGeometryAndSnappedStations(lineWithoutRouteStop, line.geometry.slice(0, -1));
}

function geometryWithAddedStation(line: TransitLine, coordinate: Coordinate): Coordinate[] {
  if (line.geometry.length === 0) {
    return [coordinate];
  }
  if (line.geometry.length === 1) {
    const existing = line.geometry[0];
    return distanceMiles(existing, coordinate) * 5280 < 20 ? line.geometry : [existing, coordinate];
  }
  return line.geometry;
}

function withStationsFromRouteGeometry(line: TransitLine): TransitLine {
  if (line.stations.length > 0 || line.geometry.length < 2) {
    return line;
  }

  return {
    ...line,
    stations: line.geometry.map((coordinate, order) => ({
      id: makeId('station'),
      lineId: line.id,
      name: `Station ${order + 1}`,
      coordinate,
      order
    }))
  };
}

function scenarioWithGeometryOnlyLinesRepaired(scenario: Scenario): {
  scenario: Scenario;
  changed: boolean;
} {
  let changed = false;
  const lines = scenario.lines.map((line) => {
    const updatedLine = withStationsFromRouteGeometry(line);
    if (updatedLine !== line) {
      changed = true;
    }
    return updatedLine;
  });

  return {
    scenario: changed ? { ...scenario, lines, results: undefined } : scenario,
    changed
  };
}

export const useScenarioStore = create<ScenarioState>()(
  persist(
    (set, get) => ({
      scenarios: [cloneScenario(DEMO_SCENARIO)],
      activeScenarioId: DEMO_SCENARIO.id,
      selectedLineId: DEMO_SCENARIO.lines[0]?.id,
      selectedStationId: undefined,
      selectedRoutePointIndex: undefined,
      mode: 'inspect',
      buildTool: 'draw-line',
      roadSnapEnabled: false,
      selectedTechnology: 'brt',
      selectedHeadway: 10,
      overlays: defaultOverlays,
      inspectedFeature: undefined,
      compareScenarioIds: [DEMO_SCENARIO.id],
      simulationNotice: undefined,
      setMode: (mode) => set({ mode, inspectedFeature: undefined }),
      setBuildTool: (buildTool) => set({ buildTool }),
      setRoadSnapEnabled: (enabled) => set({ roadSnapEnabled: enabled }),
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
                selectedRoutePointIndex: undefined,
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
            selectedRoutePointIndex: undefined,
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
            selectedStationId: undefined,
            selectedRoutePointIndex: undefined
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
            selectedRoutePointIndex: undefined,
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
            selectedRoutePointIndex: undefined,
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
          overlays:
            overlay === 'catchments'
              ? {
                  ...state.overlays,
                  catchments: !state.overlays.catchments
                }
              : {
                  ...state.overlays,
                  ...Object.fromEntries(
                    zoneOverlayKeys.map((key) => [key, key === overlay ? !state.overlays[overlay] : false])
                  )
                }
        })),
      setInspectedFeature: (feature) =>
        set({
          inspectedFeature: feature,
          selectedLineId:
            feature?.type === 'line'
              ? feature.id
              : feature?.type === 'station'
                ? feature.lineId
                : get().selectedLineId,
          selectedStationId: feature?.type === 'station' ? feature.stationId : undefined,
          selectedRoutePointIndex: undefined
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
        set({
          selectedLineId: createdLineId,
          selectedStationId: undefined,
          selectedRoutePointIndex: undefined,
          mode: 'build'
        });
        return createdLineId;
      },
      selectLine: (lineId) =>
        set({ selectedLineId: lineId, selectedStationId: undefined, selectedRoutePointIndex: undefined }),
      selectRoutePoint: (lineId, pointIndex) =>
        set({
          selectedLineId: lineId,
          selectedStationId: undefined,
          selectedRoutePointIndex: pointIndex,
          inspectedFeature: { type: 'line', id: lineId }
        }),
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
                line.id === selectedLineId ? withGeometryAndSnappedStations(line, [...line.geometry, coordinate]) : line
              ),
              results: undefined
            };
          })
        ),
      addRouteStop: (coordinate) =>
        set((state) => {
          let nextLineId = state.selectedLineId;
          let nextStationId: string | undefined;
          const update = updateActiveScenario(state, (scenario) => {
            let selectedLineId = state.selectedLineId;
            let lines = scenario.lines;
            if (!selectedLineId || !scenario.lines.some((line) => line.id === selectedLineId)) {
              const line = createTransitLine(state, scenario);
              selectedLineId = line.id;
              lines = [...scenario.lines, line];
            }
            nextLineId = selectedLineId;

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
                nextStationId = station.id;
                return withGeometryAndSnappedStations(
                  {
                    ...line,
                    stations: [...line.stations, station]
                  },
                  [...line.geometry, coordinate],
                  { stationId: station.id, coordinate }
                );
              }),
              results: undefined
            };
          });

          return {
            ...update,
            selectedLineId: nextLineId,
            selectedStationId: nextStationId,
            selectedRoutePointIndex: undefined,
            inspectedFeature:
              nextLineId && nextStationId
                ? { type: 'station', lineId: nextLineId, stationId: nextStationId }
                : state.inspectedFeature
          };
        }),
      addStation: (coordinate) =>
        set((state) => {
          let nextLineId = state.selectedLineId;
          let nextStationId: string | undefined;
          const update = updateActiveScenario(state, (scenario) => {
            let selectedLineId = state.selectedLineId;
            let lines = scenario.lines;
            if (!selectedLineId || !scenario.lines.some((line) => line.id === selectedLineId)) {
              const line = createTransitLine(state, scenario);
              selectedLineId = line.id;
              lines = [...scenario.lines, line];
            }
            nextLineId = selectedLineId;

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
                nextStationId = station.id;
                return {
                  ...line,
                  geometry: geometryWithAddedStation(line, coordinate),
                  stations: [...line.stations, station]
                };
              }),
              results: undefined
            };
          });

          return {
            ...update,
            selectedLineId: nextLineId,
            selectedStationId: nextStationId,
            selectedRoutePointIndex: undefined,
            inspectedFeature:
              nextLineId && nextStationId
                ? { type: 'station', lineId: nextLineId, stationId: nextStationId }
                : state.inspectedFeature
          };
        }),
      updateRoutePointCoordinate: (lineId, pointIndex, coordinate) =>
        set((state) =>
          updateActiveScenario(state, (scenario) => ({
            ...scenario,
            lines: scenario.lines.map((line) =>
              line.id === lineId
                ? withGeometryAndSnappedStations(
                    line,
                    line.geometry.map((point, index) => (index === pointIndex ? coordinate : point))
                  )
                : line
            ),
            results: undefined
          }))
        ),
      removeRoutePoint: (lineId, pointIndex) =>
        set((state) =>
          updateActiveScenario(state, (scenario) => ({
            ...scenario,
            lines: scenario.lines.map((line) =>
              line.id === lineId
                ? withGeometryAndSnappedStations(
                    line,
                    line.geometry.filter((_, index) => index !== pointIndex)
                  )
                : line
            ),
            selectedRoutePointIndex: undefined,
            results: undefined
          }))
        ),
      insertRoutePointAfter: (lineId, pointIndex) =>
        set((state) =>
          updateActiveScenario(state, (scenario) => {
            let insertedIndex: number | undefined;
            return {
              ...scenario,
              lines: scenario.lines.map((line) => {
                if (line.id !== lineId || line.geometry.length === 0) {
                  return line;
                }
                const current = line.geometry[Math.min(pointIndex, line.geometry.length - 1)];
                const next = line.geometry[pointIndex + 1];
                const inserted: Coordinate = next
                  ? [(current[0] + next[0]) / 2, (current[1] + next[1]) / 2]
                  : [current[0] + 0.002, current[1] + 0.002];
                insertedIndex = Math.min(pointIndex + 1, line.geometry.length);
                return withGeometryAndSnappedStations(
                  line,
                  [
                    ...line.geometry.slice(0, insertedIndex),
                    inserted,
                    ...line.geometry.slice(insertedIndex)
                  ]
                );
              }),
              selectedLineId: lineId,
              selectedStationId: undefined,
              selectedRoutePointIndex: insertedIndex,
              results: undefined
            };
          })
        ),
      updateStationCoordinate: (lineId, stationId, coordinate) =>
        set((state) => ({
          ...updateActiveScenario(state, (scenario) => ({
            ...scenario,
            lines: scenario.lines.map((line) => {
              if (line.id !== lineId) {
                return line;
              }

              const station = line.stations.find((candidate) => candidate.id === stationId);
              if (!station) {
                return line;
              }

              return withGeometryAndSnappedStations(
                line,
                geometryPulledByStation(line, station, coordinate),
                { stationId, coordinate }
              );
            }),
            results: undefined
          })),
          selectedLineId: lineId,
          selectedStationId: stationId,
          selectedRoutePointIndex: undefined,
          inspectedFeature: { type: 'station', lineId, stationId }
        })),
      moveStation: (lineId, stationId, direction) =>
        set((state) =>
          updateActiveScenario(state, (scenario) => ({
            ...scenario,
            lines: scenario.lines.map((line) => {
              if (line.id !== lineId) {
                return line;
              }
              const stations = [...line.stations].sort((a, b) => a.order - b.order);
              const fromIndex = stations.findIndex((station) => station.id === stationId);
              const toIndex = fromIndex + direction;
              if (fromIndex < 0 || toIndex < 0 || toIndex >= stations.length) {
                return line;
              }
              const [station] = stations.splice(fromIndex, 1);
              stations.splice(toIndex, 0, station);
              return {
                ...line,
                stations: stations.map((candidate, order) => ({ ...candidate, order }))
              };
            }),
            selectedStationId: stationId,
            selectedRoutePointIndex: undefined,
            results: undefined
          }))
        ),
      removeStation: (lineId, stationId) =>
        set((state) => ({
          ...updateActiveScenario(state, (scenario) => ({
            ...scenario,
            lines: scenario.lines.map((line) => (line.id === lineId ? withoutStation(line, stationId) : line)),
            results: undefined
          })),
          selectedLineId: lineId,
          selectedStationId: undefined,
          selectedRoutePointIndex: undefined,
          inspectedFeature: undefined
        })),
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
              line.id === lineId ? withLastRoutePointRemoved(line) : line
            ),
            selectedRoutePointIndex: undefined,
            results: undefined
          }))
        ),
      removeSelected: () =>
        set((state) => {
          const selectedStationId = state.selectedStationId;
          const selectedLineId = state.selectedLineId;
          const selectedRoutePointIndex = state.selectedRoutePointIndex;
          const update = updateActiveScenario(state, (scenario) => {
            if (selectedLineId && selectedRoutePointIndex !== undefined) {
              return {
                ...scenario,
                lines: scenario.lines.map((line) =>
                  line.id === selectedLineId
                    ? withGeometryAndSnappedStations(
                        line,
                        line.geometry.filter((_, index) => index !== selectedRoutePointIndex)
                      )
                    : line
                ),
                results: undefined
              };
            }
            if (state.selectedStationId && state.selectedLineId) {
              return {
                ...scenario,
                lines: scenario.lines.map((line) =>
                  line.id === state.selectedLineId ? withoutStation(line, state.selectedStationId as string) : line
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
            selectedRoutePointIndex: undefined,
            selectedLineId:
              selectedLineId && !selectedStationId && selectedRoutePointIndex === undefined
                ? undefined
                : state.selectedLineId,
            inspectedFeature: undefined
          };
        }),
      repairGeometryOnlyLines: () =>
        set((state) => {
          let didRepair = false;
          const update = updateActiveScenario(state, (scenario) => {
            const repaired = scenarioWithGeometryOnlyLinesRepaired(scenario);
            didRepair = repaired.changed;
            return repaired.scenario;
          });
          return didRepair ? update : {};
        }),
      runActiveSimulation: () =>
        set((state) => {
          const activeScenario = scenarioWithGeometryOnlyLinesRepaired(getActiveScenario(state)).scenario;
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
              scenario.id === activeScenario.id ? { ...activeScenario, results } : scenario
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
