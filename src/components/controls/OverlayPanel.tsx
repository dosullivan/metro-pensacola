import { Layers } from 'lucide-react';
import { useScenarioStore } from '../../store/scenarioStore';
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

export function OverlayPanel() {
  const overlays = useScenarioStore((state) => state.overlays);
  const toggleOverlay = useScenarioStore((state) => state.toggleOverlay);

  return (
    <section className="panel overlay-panel">
      <div className="panel-title">
        <Layers size={18} />
        <span>Map Overlays</span>
      </div>
      <div className="toggle-grid">
        {overlayLabels.map(([key, label]) => (
          <button key={key} className={overlays[key] ? 'toggle active' : 'toggle'} onClick={() => toggleOverlay(key)}>
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}
