import {
  ArrowDown,
  ArrowUp,
  CircleDot,
  MapPinned,
  MousePointer2,
  Play,
  Plus,
  Route,
  Save,
  SlidersHorizontal,
  Trash2,
  Undo2
} from 'lucide-react';
import { useEffect } from 'react';
import type { CSSProperties } from 'react';
import { FREQUENCIES } from '../../data/assumptions';
import { calculateAnnualOperatingCost, calculateConstructionCost, calculateLineMileage, calculateScenarioCapitalCost, calculateScenarioOperatingCost } from '../../simulation/costs';
import { selectActiveScenario, useScenarioStore } from '../../store/scenarioStore';
import type { FrequencyMinutes, TransitTechnologyId } from '../../types';
import { formatCurrency, formatMiles, formatNumber } from '../../utils/format';

export function BuildControls() {
  const scenario = useScenarioStore(selectActiveScenario);
  const mode = useScenarioStore((state) => state.mode);
  const buildTool = useScenarioStore((state) => state.buildTool);
  const selectedTechnology = useScenarioStore((state) => state.selectedTechnology);
  const selectedHeadway = useScenarioStore((state) => state.selectedHeadway);
  const selectedLineId = useScenarioStore((state) => state.selectedLineId);
  const selectedStationId = useScenarioStore((state) => state.selectedStationId);
  const selectedRoutePointIndex = useScenarioStore((state) => state.selectedRoutePointIndex);
  const roadSnapEnabled = useScenarioStore((state) => state.roadSnapEnabled);
  const simulationNotice = useScenarioStore((state) => state.simulationNotice);
  const setMode = useScenarioStore((state) => state.setMode);
  const setBuildTool = useScenarioStore((state) => state.setBuildTool);
  const setRoadSnapEnabled = useScenarioStore((state) => state.setRoadSnapEnabled);
  const setSelectedTechnology = useScenarioStore((state) => state.setSelectedTechnology);
  const setSelectedHeadway = useScenarioStore((state) => state.setSelectedHeadway);
  const createLine = useScenarioStore((state) => state.createLine);
  const selectLine = useScenarioStore((state) => state.selectLine);
  const removeSelected = useScenarioStore((state) => state.removeSelected);
  const removeLastRoutePoint = useScenarioStore((state) => state.removeLastRoutePoint);
  const removeRoutePoint = useScenarioStore((state) => state.removeRoutePoint);
  const insertRoutePointAfter = useScenarioStore((state) => state.insertRoutePointAfter);
  const selectRoutePoint = useScenarioStore((state) => state.selectRoutePoint);
  const moveStation = useScenarioStore((state) => state.moveStation);
  const updateLineHeadway = useScenarioStore((state) => state.updateLineHeadway);
  const updateLineTechnology = useScenarioStore((state) => state.updateLineTechnology);
  const renameLine = useScenarioStore((state) => state.renameLine);
  const renameStation = useScenarioStore((state) => state.renameStation);
  const runActiveSimulation = useScenarioStore((state) => state.runActiveSimulation);
  const saveScenario = useScenarioStore((state) => state.saveScenario);
  const setInspectedFeature = useScenarioStore((state) => state.setInspectedFeature);

  const selectedLine = scenario.lines.find((line) => line.id === selectedLineId);
  const selectedStation = selectedLine?.stations.find((station) => station.id === selectedStationId);
  const selectedStationOrder = selectedStation ? selectedStation.order : undefined;
  const selectedRoutePoint =
    selectedLine && selectedRoutePointIndex !== undefined ? selectedLine.geometry[selectedRoutePointIndex] : undefined;
  const snapTechnology = selectedLine?.technology ?? selectedTechnology;
  const canUseRoadSnap = snapTechnology === 'brt' || snapTechnology === 'light-rail';
  const capitalCost = calculateScenarioCapitalCost(scenario.lines, scenario.assumptions);
  const operatingCost = calculateScenarioOperatingCost(scenario.lines, scenario.assumptions);
  const remainingCapital = scenario.assumptions.capitalBudget - capitalCost;
  const remainingOperating = scenario.assumptions.annualOperatingBudget - operatingCost;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isUndo = event.key.toLowerCase() === 'z' && (event.metaKey || event.ctrlKey);
      if (!isUndo || mode !== 'build' || !selectedLine || selectedLine.geometry.length === 0) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'SELECT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable;
      if (isTyping) {
        return;
      }

      event.preventDefault();
      removeLastRoutePoint(selectedLine.id);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode, removeLastRoutePoint, selectedLine]);

  return (
    <section className="panel build-panel">
      <div className="panel-title">
        <Route size={18} />
        <span>Build Transit</span>
      </div>

      <div className="segmented">
        <button className={mode === 'inspect' ? 'active' : ''} onClick={() => setMode('inspect')}>
          <MousePointer2 size={16} />
          Inspect
        </button>
        <button className={mode === 'build' ? 'active' : ''} onClick={() => setMode('build')}>
          <Route size={16} />
          Build
        </button>
      </div>

      <div className="segmented">
        <button
          className={buildTool === 'draw-line' ? 'active' : ''}
          onClick={() => {
            setMode('build');
            setBuildTool('draw-line');
          }}
        >
          <Route size={16} />
          Route
        </button>
        <button
          className={buildTool === 'place-station' ? 'active' : ''}
          onClick={() => {
            setMode('build');
            setBuildTool('place-station');
          }}
        >
          <CircleDot size={16} />
          Station
        </button>
      </div>

      <div className="technology-grid">
        {(Object.keys(scenario.assumptions.technologies) as TransitTechnologyId[]).map((technologyId) => {
          const technology = scenario.assumptions.technologies[technologyId];
          return (
            <button
              key={technology.id}
              className={selectedTechnology === technology.id ? 'technology active' : 'technology'}
              style={{ '--line-color': technology.color } as CSSProperties}
              onClick={() => setSelectedTechnology(technology.id)}
            >
              <span>{technology.name}</span>
              <small>{formatCurrency(technology.capitalCostPerMile)}/mi</small>
            </button>
          );
        })}
      </div>

      <div className="inline-control">
        <label>Peak Frequency</label>
        <select
          value={selectedHeadway}
          onChange={(event) => setSelectedHeadway(Number(event.target.value) as FrequencyMinutes)}
        >
          {FREQUENCIES.map((frequency) => (
            <option key={frequency} value={frequency}>
              Every {frequency} min
            </option>
          ))}
        </select>
      </div>

      <button
        className={roadSnapEnabled && canUseRoadSnap ? 'toggle wide active' : 'toggle wide'}
        disabled={!canUseRoadSnap}
        title={
          canUseRoadSnap
            ? `Snap route clicks to nearby OSM roads within ${scenario.assumptions.roadSnapDistanceFeet ?? 650} feet.`
            : 'Road snapping is available for BRT and light rail lines.'
        }
        onClick={() => setRoadSnapEnabled(!roadSnapEnabled)}
      >
        <MapPinned size={15} />
        Road Snap {roadSnapEnabled && canUseRoadSnap ? 'On' : 'Off'}
      </button>

      <div className="button-row">
        <button className="command primary" onClick={() => createLine()}>
          <Plus size={16} />
          New Line
        </button>
        <button className="command" onClick={() => saveScenario()}>
          <Save size={16} />
          Save
        </button>
        <button className="command run" onClick={() => runActiveSimulation()}>
          <Play size={16} />
          Run Simulation
        </button>
      </div>
      {simulationNotice ? <div className="run-feedback">{simulationNotice}</div> : null}

      <div className="line-list">
        {scenario.lines.map((line) => (
          <button
            key={line.id}
            className={line.id === selectedLineId ? 'line-chip active' : 'line-chip'}
            style={{ '--line-color': line.color } as CSSProperties}
            onClick={() => {
              selectLine(line.id);
              setInspectedFeature({ type: 'line', id: line.id });
            }}
          >
            <span>{line.name}</span>
            <small>{formatMiles(calculateLineMileage(line))}</small>
          </button>
        ))}
      </div>

      {selectedLine ? (
        <div className="editor-block">
          <div className="panel-title small">
            <SlidersHorizontal size={15} />
            <span>Selected Line</span>
          </div>
          <input value={selectedLine.name} onChange={(event) => renameLine(selectedLine.id, event.target.value)} />
          <div className="two-col">
            <label>
              Technology
              <select
                value={selectedLine.technology}
                onChange={(event) => updateLineTechnology(selectedLine.id, event.target.value as TransitTechnologyId)}
              >
                {(Object.keys(scenario.assumptions.technologies) as TransitTechnologyId[]).map((technologyId) => (
                  <option key={technologyId} value={technologyId}>
                    {scenario.assumptions.technologies[technologyId].name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Headway
              <select
                value={selectedLine.headwayMinutes}
                onChange={(event) => updateLineHeadway(selectedLine.id, Number(event.target.value) as FrequencyMinutes)}
              >
                {FREQUENCIES.map((frequency) => (
                  <option key={frequency} value={frequency}>
                    {frequency} min
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="metric-list compact">
            <div>
              <span>Mileage</span>
              <strong>{formatMiles(calculateLineMileage(selectedLine))}</strong>
            </div>
            <div>
              <span>Route Points</span>
              <strong>{formatNumber(selectedLine.geometry.length)}</strong>
            </div>
            <div>
              <span>Capital</span>
              <strong>{formatCurrency(calculateConstructionCost(selectedLine, scenario.assumptions))}</strong>
            </div>
            <div>
              <span>Operating</span>
              <strong>{formatCurrency(calculateAnnualOperatingCost(selectedLine, scenario.assumptions))}/yr</strong>
            </div>
            <div>
              <span>Stations</span>
              <strong>{formatNumber(selectedLine.stations.length)}</strong>
            </div>
          </div>

          {selectedStation ? (
            <div className="station-editor">
              <label>
                Station
                <input
                  value={selectedStation.name}
                  onChange={(event) => renameStation(selectedLine.id, selectedStation.id, event.target.value)}
                />
              </label>
              <div className="button-row tight">
                <button
                  className="command"
                  disabled={selectedStationOrder === 0}
                  onClick={() => moveStation(selectedLine.id, selectedStation.id, -1)}
                >
                  <ArrowUp size={16} />
                  Earlier
                </button>
                <button
                  className="command"
                  disabled={selectedStationOrder === selectedLine.stations.length - 1}
                  onClick={() => moveStation(selectedLine.id, selectedStation.id, 1)}
                >
                  <ArrowDown size={16} />
                  Later
                </button>
              </div>
            </div>
          ) : null}

          {selectedLine.geometry.length > 0 ? (
            <div className="route-point-editor">
              <div className="panel-title small">
                <MapPinned size={15} />
                <span>Route Vertices</span>
              </div>
              <div className="route-point-list">
                {selectedLine.geometry.map((_, index) => (
                  <button
                    key={`${selectedLine.id}-${index}`}
                    className={index === selectedRoutePointIndex ? 'route-point-chip active' : 'route-point-chip'}
                    onClick={() => selectRoutePoint(selectedLine.id, index)}
                  >
                    {index + 1}
                  </button>
                ))}
              </div>
              {selectedRoutePoint ? (
                <div className="route-point-actions">
                  <small>
                    {selectedRoutePoint[1].toFixed(5)}, {selectedRoutePoint[0].toFixed(5)}
                  </small>
                  <div className="button-row tight">
                    <button
                      className="command"
                      onClick={() => insertRoutePointAfter(selectedLine.id, selectedRoutePointIndex as number)}
                    >
                      <Plus size={16} />
                      Insert After
                    </button>
                    <button
                      className="command danger"
                      onClick={() => removeRoutePoint(selectedLine.id, selectedRoutePointIndex as number)}
                    >
                      <Trash2 size={16} />
                      Delete Point
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="button-row">
            <button
              className="command"
              disabled={selectedLine.geometry.length === 0}
              title="Remove the most recently clicked route point. Cmd/Ctrl+Z also works in build mode."
              onClick={() => removeLastRoutePoint(selectedLine.id)}
            >
              <Undo2 size={16} />
              Undo Last Point
            </button>
            <button className="command danger" onClick={() => removeSelected()}>
              <Trash2 size={16} />
              Remove
            </button>
          </div>
        </div>
      ) : null}

      <div className="budget-strip">
        <div>
          <span>Capital</span>
          <strong>{formatCurrency(capitalCost)}</strong>
          <small className={remainingCapital < 0 && scenario.budgetLimitsEnabled ? 'bad' : ''}>
            {formatCurrency(remainingCapital)} left
          </small>
        </div>
        <div>
          <span>Operating</span>
          <strong>{formatCurrency(operatingCost)}/yr</strong>
          <small className={remainingOperating < 0 && scenario.budgetLimitsEnabled ? 'bad' : ''}>
            {formatCurrency(remainingOperating)} left
          </small>
        </div>
      </div>
    </section>
  );
}
