import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { DEFAULT_ASSUMPTIONS } from '../data/assumptions';
import {
  DEMOLITION_REFUND_FRACTION,
  EMERGENCY_GRANT_CAPITAL_PENALTY_MULTIPLIER,
  FARE_INCREASE_PER_DEFICIT_CHOICE,
  careerProgressWithDefaults,
  createCareerProgress,
  isLineOpen,
  lineOpeningYear,
  scheduleCareerConstruction,
  unlockFundingMilestones
} from '../data/gameplay';
import { DEMO_SCENARIO } from '../data/pensacola/demoScenario';
import { PENSACOLA_ZONES } from '../data/pensacola/zones';
import { runSimulation } from '../simulation/runSimulation';
import { runSimulationAsync, supportsSimulationWorker } from '../simulation/simulationClient';
import { distanceMiles, makeId } from '../simulation/geo';
import { snapCoordinateToLineGeometry } from '../simulation/snapping';
import { calculateScenarioCapitalCost } from '../simulation/costs';
import type {
  AppMode,
  BuildTool,
  Coordinate,
  OverlayKey,
  Scenario,
  ScenarioGameMode,
  Station,
  TransitLine,
  TransitTechnologyId,
  FrequencyMinutes,
  OperatingDeficitChoice,
  SimulationResults,
  SimulationZone
} from '../types';

export type InspectedFeature =
  | { type: 'zone'; id: string }
  | { type: 'line'; id: string }
  | { type: 'station'; lineId: string; stationId: string }
  | undefined;

const STATION_VERTEX_PULL_DISTANCE_FEET = 150;
const SAME_COORDINATE_DISTANCE_FEET = 20;
const CAREER_HEADWAYS: FrequencyMinutes[] = [5, 10, 15, 20, 30];

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
  isSimulating: boolean;
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
  advanceYear: () => void;
  resolveOperatingDeficit: (choice: OperatingDeficitChoice) => void;
  setScenarioGameMode: (mode: ScenarioGameMode) => void;
  toggleAutoSimulation: () => void;
  toggleBudgetLimits: () => void;
  toggleOverlay: (overlay: OverlayKey) => void;
  setInspectedFeature: (feature: InspectedFeature) => void;
  createLine: () => string;
  selectLine: (lineId: string) => void;
  selectRoutePoint: (lineId: string, pointIndex: number) => void;
  addRoutePoint: (coordinate: Coordinate) => void;
  addRouteStop: (coordinate: Coordinate, geometrySegment?: Coordinate[]) => void;
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
  runActiveSimulation: (source?: 'manual' | 'auto') => void;
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

function nextSlowerHeadway(headway: FrequencyMinutes): FrequencyMinutes {
  const index = CAREER_HEADWAYS.indexOf(headway);
  return CAREER_HEADWAYS[Math.min(CAREER_HEADWAYS.length - 1, Math.max(0, index) + 1)];
}

function assumptionsWithDefaults(
  assumptions: Partial<Scenario['assumptions']>
): Scenario['assumptions'] {
  return {
    ...cloneScenario(DEMO_SCENARIO).assumptions,
    ...assumptions,
    technologies: Object.fromEntries(
      Object.entries(DEFAULT_ASSUMPTIONS.technologies).map(([technologyId, technology]) => [
        technologyId,
        {
          ...technology,
          ...assumptions.technologies?.[technologyId as keyof typeof assumptions.technologies]
        }
      ])
    ) as Scenario['assumptions']['technologies']
  };
}

function blankScenario(index: number): Scenario {
  return {
    id: makeId('scenario'),
    name: `New Scenario ${index}`,
    gameMode: 'sandbox',
    autoSimulationEnabled: false,
    lines: [],
    assumptions: cloneScenario({ ...DEMO_SCENARIO, assumptions: DEFAULT_ASSUMPTIONS }).assumptions,
    simulationYear: 0,
    budgetLimitsEnabled: false
  };
}

function getActiveScenario(state: ScenarioState): Scenario {
  return state.scenarios.find((scenario) => scenario.id === state.activeScenarioId) ?? state.scenarios[0];
}

export function simulationInputsFingerprint(scenario: Scenario): string {
  return JSON.stringify({
    lines: scenario.lines,
    assumptions: scenario.assumptions,
    simulationYear: scenario.simulationYear
  });
}

const AUTO_SIMULATION_DEBOUNCE_MS = 300;
let autoSimulationTimer: ReturnType<typeof setTimeout> | undefined;
let autoSimulationPending = false;
let suppressAutoSimulationSubscription = false;

function cancelAutoSimulationTimer(): void {
  if (autoSimulationTimer !== undefined) {
    clearTimeout(autoSimulationTimer);
    autoSimulationTimer = undefined;
  }
}

function scheduleAutoSimulation(delay = AUTO_SIMULATION_DEBOUNCE_MS): void {
  cancelAutoSimulationTimer();
  autoSimulationTimer = setTimeout(() => {
    autoSimulationTimer = undefined;
    const state = useScenarioStore.getState();
    const scenario = getActiveScenario(state);
    if (scenario.gameMode !== 'career' || !scenario.autoSimulationEnabled) {
      autoSimulationPending = false;
      return;
    }
    if (state.isSimulating) {
      autoSimulationPending = true;
      return;
    }
    autoSimulationPending = false;
    state.runActiveSimulation('auto');
  }, delay);
}

function flushPendingAutoSimulation(): void {
  if (!autoSimulationPending) {
    return;
  }
  autoSimulationPending = false;
  scheduleAutoSimulation(0);
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

function applyConstructionUpdate(
  state: ScenarioState,
  updater: (scenario: Scenario) => Scenario
): { update: Partial<ScenarioState>; applied: boolean } {
  const activeScenario = getActiveScenario(state);
  let nextScenario = updater(activeScenario);
  if (activeScenario.gameMode !== 'career' || !activeScenario.career) {
    return { update: updateActiveScenario(state, () => nextScenario), applied: true };
  }
  const career = activeScenario.career;
  nextScenario = {
    ...nextScenario,
    lines: scheduleCareerConstruction(
      activeScenario.lines,
      nextScenario.lines,
      activeScenario.simulationYear,
      activeScenario.assumptions
    )
  };

  const previousCost = calculateScenarioCapitalCost(activeScenario.lines, activeScenario.assumptions);
  const nextCost = calculateScenarioCapitalCost(nextScenario.lines, nextScenario.assumptions);
  const capitalDelta = nextCost - previousCost;
  if (capitalDelta > career.remainingCapital + 0.01) {
    return {
      update: {
        simulationNotice: `That change costs $${Math.ceil(capitalDelta).toLocaleString()}, but only $${Math.floor(career.remainingCapital).toLocaleString()} remains.`
      },
      applied: false
    };
  }

  const remainingCapital =
    capitalDelta >= 0
      ? career.remainingCapital - capitalDelta
      : career.remainingCapital + -capitalDelta * DEMOLITION_REFUND_FRACTION;
  return {
    update: updateActiveScenario(state, () => ({
      ...nextScenario,
      career: { ...career, remainingCapital }
    })),
    applied: true
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

function coordinatesWithinFeet(a: Coordinate, b: Coordinate, maxDistanceFeet = SAME_COORDINATE_DISTANCE_FEET): boolean {
  return distanceMiles(a, b) * 5280 < maxDistanceFeet;
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
    return coordinatesWithinFeet(existing, coordinate) ? line.geometry : [existing, coordinate];
  }

  if (line.geometry.some((point) => coordinatesWithinFeet(point, coordinate))) {
    return line.geometry;
  }

  const snapResult = snapCoordinateToLineGeometry(coordinate, line.geometry);
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

function geometryWithAddedRouteStop(
  line: TransitLine,
  coordinate: Coordinate,
  geometrySegment: Coordinate[] | undefined
): Coordinate[] {
  if (line.geometry.length === 0) {
    return [coordinate];
  }

  if (!geometrySegment || geometrySegment.length < 2) {
    return [...line.geometry, coordinate];
  }

  const lastPoint = line.geometry[line.geometry.length - 1];
  const startsAtCurrentEnd =
    coordinatesWithinFeet(geometrySegment[0], lastPoint, SAME_COORDINATE_DISTANCE_FEET);
  const newGeometry = [...line.geometry, ...(startsAtCurrentEnd ? geometrySegment.slice(1) : geometrySegment)];
  const routeEnd = newGeometry[newGeometry.length - 1];
  return coordinatesWithinFeet(routeEnd, coordinate) ? newGeometry : [...newGeometry, coordinate];
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
      isSimulating: false,
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
            simulationNotice: 'Demo network restored.'
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
      advanceYear: () =>
        set((state) => {
          const scenario = getActiveScenario(state);
          if (scenario.gameMode !== 'career' || !scenario.career) return {};
          if (state.isSimulating) {
            return { simulationNotice: 'Wait for the current simulation before advancing the year.' };
          }
          if (scenario.career.pendingOperatingDeficit) {
            return { simulationNotice: 'Resolve the operating deficit before advancing.' };
          }
          if (!scenario.results) {
            return { simulationNotice: 'Run the current year before advancing.' };
          }
          const annualSubsidy = scenario.results.operatingSubsidy;
          const amount = annualSubsidy - scenario.career.annualOperatingSubsidyCap;
          if (amount > 0.01) {
            return {
              ...updateActiveScenario(state, (current) => ({
                ...current,
                career: {
                  ...scenario.career!,
                  pendingOperatingDeficit: {
                    year: scenario.simulationYear,
                    amount,
                    annualSubsidy
                  }
                }
              })),
              simulationNotice: `Operating subsidy exceeds the annual cap by $${Math.ceil(amount).toLocaleString()}. Choose a response.`
            };
          }
          return {
            ...updateActiveScenario(state, (current) => ({
              ...current,
              simulationYear: current.simulationYear + 1,
              results: undefined,
              career: {
                ...scenario.career!,
                cumulativeOperatingSubsidy:
                  scenario.career!.cumulativeOperatingSubsidy + annualSubsidy
              }
            })),
            simulationNotice: `Advanced to Year ${scenario.simulationYear + 1}.`
          };
        }),
      resolveOperatingDeficit: (choice) =>
        set((state) => {
          const scenario = getActiveScenario(state);
          const career = scenario.career;
          const deficit = career?.pendingOperatingDeficit;
          if (scenario.gameMode !== 'career' || !career || !deficit) return {};

          if (choice === 'cut-frequency') {
            const lines = scenario.lines.map((line) =>
              isLineOpen(line, scenario.simulationYear)
                ? { ...line, headwayMinutes: nextSlowerHeadway(line.headwayMinutes) }
                : line
            );
            if (lines.every((line, index) => line.headwayMinutes === scenario.lines[index].headwayMinutes)) {
              return { simulationNotice: 'All open lines are already at the lowest service frequency.' };
            }
            return {
              ...updateActiveScenario(state, (current) => ({
                ...current,
                lines,
                results: undefined,
                career: { ...career, pendingOperatingDeficit: undefined }
              })),
              simulationNotice: 'Service frequencies reduced. Updating the operating forecast…'
            };
          }

          if (choice === 'raise-fare') {
            return {
              ...updateActiveScenario(state, (current) => ({
                ...current,
                assumptions: {
                  ...current.assumptions,
                  defaultFare: current.assumptions.defaultFare + FARE_INCREASE_PER_DEFICIT_CHOICE
                },
                results: undefined,
                career: { ...career, pendingOperatingDeficit: undefined }
              })),
              simulationNotice: 'Fare increased by $0.50. Updating the operating forecast…'
            };
          }

          const capitalPenalty = deficit.amount * EMERGENCY_GRANT_CAPITAL_PENALTY_MULTIPLIER;
          return {
            ...updateActiveScenario(state, (current) => ({
              ...current,
              simulationYear: current.simulationYear + 1,
              results: undefined,
              career: {
                ...career,
                remainingCapital: Math.max(0, career.remainingCapital - capitalPenalty),
                cumulativeOperatingSubsidy:
                  career.cumulativeOperatingSubsidy + deficit.annualSubsidy,
                pendingOperatingDeficit: undefined
              }
            })),
            simulationNotice: `Emergency operating grant accepted; $${Math.ceil(capitalPenalty).toLocaleString()} removed from capital funds.`
          };
        }),
      setScenarioGameMode: (gameMode) =>
        set((state) => {
          const scenario = getActiveScenario(state);
          if (scenario.gameMode === gameMode) return {};
          if (gameMode === 'career') {
            const repairedScenario = scenarioWithGeometryOnlyLinesRepaired(scenario).scenario;
            const lines = repairedScenario.lines.map((line) =>
              line.constructionStartedYear === undefined
                ? line
                : {
                    ...line,
                    openingYear: lineOpeningYear(line, line.constructionStartedYear)
                  }
            );
            const existingCost = calculateScenarioCapitalCost(lines, repairedScenario.assumptions);
            return updateActiveScenario(state, (current) => ({
              ...repairedScenario,
              lines,
              gameMode: 'career',
              autoSimulationEnabled: true,
              budgetLimitsEnabled: true,
              career: createCareerProgress(existingCost)
            }));
          }
          return updateActiveScenario(state, (current) => ({
            ...current,
            gameMode: 'sandbox',
            autoSimulationEnabled: false,
            career: undefined
          }));
        }),
      toggleAutoSimulation: () =>
        set((state) =>
          updateActiveScenario(state, (scenario) => ({
            ...scenario,
            autoSimulationEnabled:
              scenario.gameMode === 'career' ? !scenario.autoSimulationEnabled : false
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
          applyConstructionUpdate(state, (scenario) => {
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
          }).update
        ),
      addRouteStop: (coordinate, geometrySegment) =>
        set((state) => {
          let nextLineId = state.selectedLineId;
          let nextStationId: string | undefined;
          const transaction = applyConstructionUpdate(state, (scenario) => {
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
                  geometryWithAddedRouteStop(line, coordinate, geometrySegment),
                  { stationId: station.id, coordinate }
                );
              }),
              results: undefined
            };
          });

          if (!transaction.applied) return transaction.update;
          return {
            ...transaction.update,
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
          const transaction = applyConstructionUpdate(state, (scenario) => {
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

          if (!transaction.applied) return transaction.update;
          return {
            ...transaction.update,
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
          applyConstructionUpdate(state, (scenario) => ({
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
          })).update
        ),
      removeRoutePoint: (lineId, pointIndex) =>
        set((state) =>
          applyConstructionUpdate(state, (scenario) => ({
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
          })).update
        ),
      insertRoutePointAfter: (lineId, pointIndex) =>
        set((state) =>
          applyConstructionUpdate(state, (scenario) => {
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
          }).update
        ),
      updateStationCoordinate: (lineId, stationId, coordinate) =>
        set((state) => ({
          ...applyConstructionUpdate(state, (scenario) => ({
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
          })).update,
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
          ...applyConstructionUpdate(state, (scenario) => ({
            ...scenario,
            lines: scenario.lines.map((line) => (line.id === lineId ? withoutStation(line, stationId) : line)),
            results: undefined
          })).update,
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
          applyConstructionUpdate(state, (scenario) => {
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
          }).update
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
          applyConstructionUpdate(state, (scenario) => ({
            ...scenario,
            lines: scenario.lines.map((line) =>
              line.id === lineId ? withLastRoutePointRemoved(line) : line
            ),
            selectedRoutePointIndex: undefined,
            results: undefined
          })).update
        ),
      removeSelected: () =>
        set((state) => {
          const selectedStationId = state.selectedStationId;
          const selectedLineId = state.selectedLineId;
          const selectedRoutePointIndex = state.selectedRoutePointIndex;
          const transaction = applyConstructionUpdate(state, (scenario) => {
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
            ...transaction.update,
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
          const transaction = applyConstructionUpdate(state, (scenario) => {
            const repaired = scenarioWithGeometryOnlyLinesRepaired(scenario);
            didRepair = repaired.changed;
            return repaired.scenario;
          });
          return didRepair ? transaction.update : {};
        }),
      runActiveSimulation: (source = 'manual') => {
        if (get().isSimulating) {
          return;
        }
        cancelAutoSimulationTimer();
        autoSimulationPending = false;
        const activeScenario = scenarioWithGeometryOnlyLinesRepaired(getActiveScenario(get())).scenario;
        const simulatedFingerprint = simulationInputsFingerprint(activeScenario);
        suppressAutoSimulationSubscription = true;
        set((state) => ({
          scenarios: state.scenarios.map((scenario) =>
            scenario.id === activeScenario.id ? activeScenario : scenario
          )
        }));
        suppressAutoSimulationSubscription = false;

        const finish = (rawResults: SimulationResults) => {
          const results = { ...rawResults, generatedAt: new Date().toISOString() };
          const hasUsableService = activeScenario.lines.some(
            (line) =>
              (activeScenario.gameMode !== 'career' ||
                isLineOpen(line, activeScenario.simulationYear)) &&
              line.stations.length >= 2
          );
          const nextOpeningYear = activeScenario.lines
            .filter(
              (line) =>
                activeScenario.gameMode === 'career' &&
                !isLineOpen(line, activeScenario.simulationYear) &&
                line.stations.length >= 2 &&
                line.openingYear !== undefined
            )
            .reduce<number | undefined>(
              (earliest, line) =>
                earliest === undefined ? line.openingYear : Math.min(earliest, line.openingYear!),
              undefined
            );
          const simulationNotice = hasUsableService
            ? `Simulation complete: ${Math.round(results.dailyRidership).toLocaleString()} weekday riders.`
            : nextOpeningYear !== undefined
              ? `Simulation complete: the next line opens in Year ${nextOpeningYear}.`
            : 'Simulation complete, but no usable service exists yet. Place at least two stations on one line.';

          let shouldReschedule = false;
          set((state) => {
            const currentScenario = state.scenarios.find((scenario) => scenario.id === activeScenario.id);
            if (!currentScenario) {
              return { isSimulating: false };
            }
            if (simulationInputsFingerprint(currentScenario) !== simulatedFingerprint) {
              shouldReschedule =
                getActiveScenario(state).gameMode === 'career' &&
                getActiveScenario(state).autoSimulationEnabled;
              return {
                isSimulating: false,
                simulationNotice: shouldReschedule
                  ? 'Updating results for the latest changes…'
                  : 'The scenario changed during the run. Run the simulation again.'
              };
            }
            const milestoneUpdate =
              currentScenario.gameMode === 'career' && currentScenario.career
                ? unlockFundingMilestones(currentScenario.career, results)
                : undefined;
            const milestoneMessages =
              milestoneUpdate?.unlocked.map((milestone) => ({
                id: `funding-${milestone.id}`,
                title: milestone.title,
                body: `$${milestone.capitalGrant.toLocaleString()} in new capital funding has been awarded.`
              })) ?? [];
            const completedResults = {
              ...results,
              messages: [...milestoneMessages, ...(results.messages ?? [])]
            };
            const completedNotice = milestoneUpdate?.unlocked.length
              ? `${milestoneUpdate.unlocked.map((milestone) => milestone.title).join(', ')} unlocked.`
              : simulationNotice;
            return {
              scenarios: state.scenarios.map((scenario) =>
                scenario.id === currentScenario.id
                  ? {
                      ...currentScenario,
                      career: milestoneUpdate?.progress ?? currentScenario.career,
                      results: completedResults
                    }
                  : scenario
              ),
              isSimulating: false,
              simulationNotice: completedNotice
            };
          });
          if (shouldReschedule) {
            scheduleAutoSimulation(0);
          } else {
            flushPendingAutoSimulation();
          }
        };

        if (!supportsSimulationWorker()) {
          finish(runSimulation(activeScenario, PENSACOLA_ZONES));
          return;
        }

        set({
          isSimulating: true,
          simulationNotice: source === 'auto' ? 'Updating live results…' : 'Simulation running…'
        });
        void runSimulationAsync(activeScenario, PENSACOLA_ZONES)
          .then(finish)
          .catch(() => {
            finish(runSimulation(activeScenario, PENSACOLA_ZONES));
          });
      },
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
      storage: createJSONStorage(getScenarioStorage),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<ScenarioState>;
        return {
          ...currentState,
          ...persisted,
          isSimulating: false,
          scenarios:
            persisted.scenarios?.map((scenario) => {
              const assumptions = assumptionsWithDefaults(scenario.assumptions);
              const gameMode = scenario.gameMode ?? 'sandbox';
              const repairedScenario = scenarioWithGeometryOnlyLinesRepaired({ ...scenario, assumptions }).scenario;
              const capitalCost = calculateScenarioCapitalCost(repairedScenario.lines, assumptions);
              return {
                ...repairedScenario,
                gameMode,
                autoSimulationEnabled:
                  gameMode === 'career' ? (scenario.autoSimulationEnabled ?? true) : false,
                assumptions,
                career:
                  gameMode === 'career'
                    ? careerProgressWithDefaults(scenario.career, capitalCost)
                    : undefined
              };
            }) ?? currentState.scenarios
        };
      }
    }
  )
);

useScenarioStore.subscribe((state, previousState) => {
  if (suppressAutoSimulationSubscription) {
    return;
  }
  const scenario = getActiveScenario(state);
  const previousScenario = getActiveScenario(previousState);
  const liveKey =
    scenario.gameMode === 'career' && scenario.autoSimulationEnabled
      ? `${scenario.id}|${simulationInputsFingerprint(scenario)}`
      : undefined;
  const previousLiveKey =
    previousScenario.gameMode === 'career' && previousScenario.autoSimulationEnabled
      ? `${previousScenario.id}|${simulationInputsFingerprint(previousScenario)}`
      : undefined;

  if (!liveKey) {
    cancelAutoSimulationTimer();
    autoSimulationPending = false;
  } else if (liveKey !== previousLiveKey) {
    scheduleAutoSimulation();
  }
});

export function selectActiveScenario(state: ScenarioState): Scenario {
  return getActiveScenario(state);
}
