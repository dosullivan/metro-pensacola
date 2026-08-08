import { AlertTriangle, Clock3, Copy, FilePlus2, GitCompareArrows, RotateCcw, Save, Trash2 } from 'lucide-react';
import { calculateScenarioCapitalCost } from '../../simulation/costs';
import { CAREER_OBJECTIVES, careerObjectiveValue } from '../../data/gameplay';
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
  const advanceYear = useScenarioStore((state) => state.advanceYear);
  const resolveOperatingDeficit = useScenarioStore((state) => state.resolveOperatingDeficit);
  const isSimulating = useScenarioStore((state) => state.isSimulating);
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

      {scenario.gameMode === 'sandbox' ? (
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
      ) : (
        <div className="career-clock">
          <div>
            <span>Career Year</span>
            <strong>{scenario.simulationYear}</strong>
            <small>{formatCurrency(scenario.career?.cumulativeOperatingSubsidy ?? 0)} total subsidy</small>
          </div>
          <button
            className="command primary"
            disabled={isSimulating || Boolean(scenario.career?.pendingOperatingDeficit) || Boolean(scenario.career?.outcome)}
            onClick={advanceYear}
          >
            <Clock3 size={16} />
            Advance Year
          </button>
        </div>
      )}

      {scenario.career?.pendingOperatingDeficit ? (
        <div className="deficit-choice">
          <div className="panel-title small">
            <AlertTriangle size={15} />
            Operating Deficit
          </div>
          <p>
            Year {scenario.career.pendingOperatingDeficit.year} exceeds the subsidy cap by{' '}
            {formatCurrency(scenario.career.pendingOperatingDeficit.amount)}. Choose a response.
          </p>
          <button className="command" onClick={() => resolveOperatingDeficit('cut-frequency')}>
            Cut service frequency
          </button>
          <button className="command" onClick={() => resolveOperatingDeficit('raise-fare')}>
            Raise fare by $0.50
          </button>
          <button className="command danger" onClick={() => resolveOperatingDeficit('emergency-grant')}>
            Emergency grant (lose 2× deficit in capital)
          </button>
        </div>
      ) : null}

      {scenario.gameMode === 'career' && scenario.career ? (
        <div className="objective-list">
          <div className="panel-title small">Career Objectives</div>
          {CAREER_OBJECTIVES.map((objective) => {
            const result = scenario.career?.objectiveResults[objective.id];
            const value = result && result.status !== 'pending'
              ? result.value
              : careerObjectiveValue(objective, scenario.results);
            const displayedValue = objective.metric === 'operating-subsidy'
              ? formatCurrency(value)
              : objective.metric === 'airport-connected'
                ? value >= 1 ? 'Connected' : 'Not connected'
                : formatNumber(value);
            const target = objective.metric === 'operating-subsidy'
              ? formatCurrency(objective.target)
              : objective.metric === 'airport-connected'
                ? 'Connection'
                : formatNumber(objective.target);
            return (
              <div className={`objective ${result?.status ?? 'pending'}`} key={objective.id}>
                <div>
                  <strong>{objective.title}</strong>
                  <span>{result?.status === 'met' ? 'Met' : result?.status === 'missed' ? 'Missed' : `Year ${objective.deadlineYear}`}</span>
                </div>
                <small>{displayedValue} · target {objective.comparison === 'at-most' ? '≤' : '≥'} {target}</small>
                <small>{objective.description}</small>
              </div>
            );
          })}
        </div>
      ) : null}

      {scenario.career?.activeCouncilReview ? (
        <div className="council-review">
          <strong>Council review: {scenario.career.activeCouncilReview.lineName}</strong>
          <span>
            Improve ridership 25% by Year {scenario.career.activeCouncilReview.deadlineYear}, or lose {formatCurrency(scenario.career.activeCouncilReview.subsidyCapCut)} from the annual subsidy cap.
          </span>
        </div>
      ) : null}

      {scenario.career?.outcome ? (
        <div className={`career-summary ${scenario.career.outcome.status}`}>
          <small>FINAL CAREER RESULT · YEAR {scenario.career.outcome.year}</small>
          <strong>{scenario.career.outcome.status === 'won' ? 'REGIONAL MANDATE WON' : 'REGIONAL MANDATE LOST'}</strong>
          <div>
            <span>{formatNumber(scenario.career.outcome.dailyRidership)} riders/day</span>
            <span>{formatCurrency(scenario.career.outcome.operatingSubsidy)} subsidy/year</span>
            <span>{formatCurrency(scenario.career.remainingCapital)} capital remaining</span>
          </div>
        </div>
      ) : null}

      {scenario.gameMode === 'sandbox' ? (
        <button className={scenario.budgetLimitsEnabled ? 'toggle wide active' : 'toggle wide'} onClick={toggleBudgetLimits}>
          Advisory Budgets {scenario.budgetLimitsEnabled ? 'On' : 'Off'}
        </button>
      ) : null}

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
