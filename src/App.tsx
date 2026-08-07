import { useEffect } from 'react';
import { BuildControls } from './components/controls/BuildControls';
import { OverlayPanel } from './components/controls/OverlayPanel';
import { TransitMap } from './components/map/TransitMap';
import { InspectorPanel } from './components/panels/InspectorPanel';
import { ResultsPanel } from './components/panels/ResultsPanel';
import { ScenarioPanel } from './components/panels/ScenarioPanel';
import { selectActiveScenario, useScenarioStore } from './store/scenarioStore';

export function App() {
  const scenario = useScenarioStore(selectActiveScenario);
  const mode = useScenarioStore((state) => state.mode);
  const buildTool = useScenarioStore((state) => state.buildTool);
  const repairGeometryOnlyLines = useScenarioStore((state) => state.repairGeometryOnlyLines);

  useEffect(() => {
    repairGeometryOnlyLines();
  }, [repairGeometryOnlyLines, scenario.id, scenario.lines]);

  return (
    <main className="app-shell">
      <TransitMap />
      <header className="top-bar">
        <div>
          <strong>Metro Pensacola</strong>
          <span>{scenario.name}</span>
        </div>
        <div className="status-pill">
          {mode === 'build' ? (buildTool === 'draw-line' ? 'Draw Stops' : 'Add Stop') : 'Inspect'}
        </div>
      </header>
      <aside className="left-stack">
        <BuildControls />
        <OverlayPanel />
        <ScenarioPanel />
      </aside>
      <aside className="right-stack">
        <ResultsPanel />
        <InspectorPanel />
      </aside>
    </main>
  );
}
