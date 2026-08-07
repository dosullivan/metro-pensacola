import { Layers } from 'lucide-react';
import { selectActiveScenario, useScenarioStore } from '../../store/scenarioStore';
import type { OverlayKey } from '../../types';

const overlayLabels: Array<[OverlayKey, string]> = [
  ['population', 'Population'],
  ['employment', 'Employment'],
  ['density', 'Density'],
  ['accessibility', 'Accessibility'],
  ['ridership', 'Ridership'],
  ['development', 'Development'],
  ['landValue', 'Land Value'],
  ['catchments', 'Catchments']
];

const resultOverlayKeys = new Set<OverlayKey>(['accessibility', 'ridership', 'development']);

export function OverlayPanel() {
  const scenario = useScenarioStore(selectActiveScenario);
  const overlays = useScenarioStore((state) => state.overlays);
  const toggleOverlay = useScenarioStore((state) => state.toggleOverlay);

  return (
    <section className="panel overlay-panel">
      <div className="panel-title">
        <Layers size={18} />
        <span>Map Overlays</span>
      </div>
      <div className="toggle-grid">
        {overlayLabels.map(([key, label]) => {
          const needsResults = resultOverlayKeys.has(key);
          const disabled = needsResults && !scenario.results;
          return (
            <button
              key={key}
              className={overlays[key] && !disabled ? 'toggle active' : 'toggle'}
              disabled={disabled}
              title={disabled ? 'Run the simulation to populate this overlay.' : undefined}
              onClick={() => toggleOverlay(key)}
            >
              {label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
