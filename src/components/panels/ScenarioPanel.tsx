import { Copy, FilePlus2, GitCompareArrows, RotateCcw, Save, Trash2 } from 'lucide-react';
import { calculateScenarioCapitalCost } from '../../simulation/costs';
import { selectActiveScenario, useScenarioStore } from '../../store/scenarioStore';
import { formatCurrency, formatNumber } from '../../utils/format';

const yearOptions = [
  { label: 'Present Day', value: 0 },
  { label: '+5 Years', value: 5 },
  { label: '+10 Years', value: 10 },
  { label: '+20 Years', value: 20 }
];

export function ScenarioPanel() {
  const scenario = useScenarioStore(selectActiveScenario);
  const scenarios = useScenarioStore((state) => state.scenarios);
  const compareScenarioIds = useScenarioStore((state) => state.compareScenarioIds);
  const setActiveScenario = useScenarioStore((state) => state.setActiveScenario);
  const newScenario = useScenarioStore((state) => state.newScenario);
  const duplicateScenario = useScenarioStore((state) => state.duplicateScenario);
  const deleteScenario = useScenarioStore((state) => state.deleteScenario);
  const restoreDemoScenario = useScenarioStore((state) => state.restoreDemoScenario);
  const renameScenario = useScenarioStore((state) => state.renameScenario);
  const saveScenario = useScenarioStore((state) => state.saveScenario);
  const setSimulationYear = useScenarioStore((state) => state.setSimulationYear);
  const setScenarioGameMode = useScenarioStore((state) => state.setScenarioGameMode);
  const toggleBudgetLimits = useScenarioStore((state) => state.toggleBudgetLimits);
  const toggleScenarioComparison = useScenarioStore((state) => state.toggleScenarioComparison);

  const comparisonScenarios = scenarios.filter((candidate) => compareScenarioIds.includes(candidate.id));

  return (
    <section className="panel scenario-panel">
      <div className="panel-title">
        <GitCompareArrows size={18} />
        <span>Scenarios</span>
      </div>

      <select value={scenario.id} onChange={(event) => setActiveScenario(event.target.value)}>
        {scenarios.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.name}
          </option>
        ))}
      </select>

      <input value={scenario.name} onChange={(event) => renameScenario(scenario.id, event.target.value)} />

      <div className="segmented">
        <button
          className={scenario.gameMode === 'sandbox' ? 'active' : ''}
          onClick={() => setScenarioGameMode('sandbox')}
        >
          Sandbox
        </button>
        <button
          className={scenario.gameMode === 'career' ? 'active' : ''}
          onClick={() => setScenarioGameMode('career')}
        >
          Career
        </button>
      </div>

      <div className="button-row">
        <button className="command" onClick={() => newScenario()}>
          <FilePlus2 size={16} />
          New
        </button>
        <button className="command" onClick={() => duplicateScenario(scenario.id)}>
          <Copy size={16} />
          Duplicate
        </button>
        <button className="command" onClick={() => saveScenario()}>
          <Save size={16} />
          Save
        </button>
        <button className="command" onClick={() => restoreDemoScenario()}>
          <RotateCcw size={16} />
          Demo
        </button>
        <button className="command danger" onClick={() => deleteScenario(scenario.id)}>
          <Trash2 size={16} />
          Delete
        </button>
      </div>

      <div className="segmented year-tabs">
        {yearOptions.map((option) => (
          <button
            key={option.value}
            className={scenario.simulationYear === option.value ? 'active' : ''}
            onClick={() => setSimulationYear(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <button className={scenario.budgetLimitsEnabled ? 'toggle wide active' : 'toggle wide'} onClick={toggleBudgetLimits}>
        Budget Limits {scenario.budgetLimitsEnabled ? 'On' : 'Off'}
      </button>

      <div className="compare-list">
        {scenarios.map((candidate) => (
          <label key={candidate.id} className="compare-option">
            <input
              type="checkbox"
              checked={compareScenarioIds.includes(candidate.id)}
              onChange={() => toggleScenarioComparison(candidate.id)}
            />
            <span>{candidate.name}</span>
          </label>
        ))}
      </div>

      {comparisonScenarios.length >= 2 ? (
        <div className="comparison-table">
          <div className="comparison-header">
            <span>Scenario</span>
            <span>Cost</span>
            <span>Riders/day</span>
          </div>
          {comparisonScenarios.map((candidate) => (
            <div key={candidate.id} className="comparison-row">
              <span>{candidate.name}</span>
              <strong>{formatCurrency(candidate.results?.constructionCost ?? calculateScenarioCapitalCost(candidate.lines, candidate.assumptions))}</strong>
              <strong>{formatNumber(candidate.results?.dailyRidership ?? 0)}</strong>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
