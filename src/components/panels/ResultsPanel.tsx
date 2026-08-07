import { Activity, Building2, CircleDollarSign, Timer, TrainFront } from 'lucide-react';
import { selectActiveScenario, useScenarioStore } from '../../store/scenarioStore';
import { formatCurrency, formatMiles, formatNumber } from '../../utils/format';

export function ResultsPanel() {
  const scenario = useScenarioStore(selectActiveScenario);
  const results = scenario.results;

  return (
    <section className="panel results-panel">
      <div className="panel-title">
        <Activity size={18} />
        <span>Simulation Results</span>
      </div>

      {!results ? (
        <div className="empty-state">
          <strong>No run yet</strong>
          <span>Results appear after the active scenario is simulated.</span>
        </div>
      ) : (
        <>
          <div className="hero-metrics">
            <div>
              <TrainFront size={18} />
              <span>Weekday Riders</span>
              <strong>{formatNumber(results.dailyRidership)}</strong>
            </div>
            <div>
              <CircleDollarSign size={18} />
              <span>Capital Cost</span>
              <strong>{formatCurrency(results.constructionCost)}</strong>
            </div>
          </div>

          <div className="metric-list">
            <div>
              <span>Annual Operating Cost</span>
              <strong>{formatCurrency(results.annualOperatingCost)}</strong>
            </div>
            <div>
              <span>Annual Ridership</span>
              <strong>{formatNumber(results.annualRidership)}</strong>
            </div>
            <div>
              <span>Cost per Daily Rider</span>
              <strong>{formatCurrency(results.costPerDailyRider)}</strong>
            </div>
            <div>
              <span>Fare Revenue</span>
              <strong>{formatCurrency(results.fareRevenue)}</strong>
            </div>
            <div>
              <span>Operating Subsidy</span>
              <strong>{formatCurrency(results.operatingSubsidy)}</strong>
            </div>
            <div>
              <span>Average Time Savings</span>
              <strong>{formatNumber(results.averageRiderTravelTimeSavings, 1)} min</strong>
            </div>
            <div>
              <span>Vehicle Trips Removed</span>
              <strong>{formatNumber(results.vehicleTripsRemoved)}</strong>
            </div>
            <div>
              <span>CO2 Reduction</span>
              <strong>{formatNumber(results.co2ReductionKg / 1000, 1)} t/day</strong>
            </div>
            <div>
              <span>Population Near Transit</span>
              <strong>{formatNumber(results.populationWithinWalkingDistance)}</strong>
            </div>
            <div>
              <span>Jobs Near Transit</span>
              <strong>{formatNumber(results.jobsWithinWalkingDistance)}</strong>
            </div>
          </div>

          <div className="message-stack">
            {results.messages.map((message) => (
              <article key={message.id} className="game-message">
                <strong>{message.title}</strong>
                <span>{message.body}</span>
              </article>
            ))}
          </div>

          <div className="result-section">
            <div className="panel-title small">
              <TrainFront size={15} />
              <span>Lines</span>
            </div>
            <div className="table-like">
              {results.lineResults.map((line) => (
                <div key={line.lineId} className="table-row">
                  <span>{line.lineName}</span>
                  <strong>{formatNumber(line.weekdayRidership)}</strong>
                  <small>
                    {formatMiles(line.mileage)} | {formatCurrency(line.operatingCost)}/yr
                  </small>
                </div>
              ))}
            </div>
          </div>

          <div className="result-section">
            <div className="panel-title small">
              <Building2 size={15} />
              <span>Stations</span>
            </div>
            <div className="table-like station-table">
              {results.stationResults
                .slice()
                .sort((a, b) => b.entries + b.exits - (a.entries + a.exits))
                .map((station) => (
                  <div key={station.stationId} className="table-row">
                    <span>{station.stationName}</span>
                    <strong>{formatNumber(station.entries + station.exits)}</strong>
                    <small>
                      {formatNumber(station.nearbyPopulation)} pop | {formatNumber(station.nearbyJobs)} jobs
                    </small>
                  </div>
                ))}
            </div>
          </div>

          <div className="timestamp">
            <Timer size={13} />
            <span>{new Date(results.generatedAt).toLocaleString()}</span>
          </div>
        </>
      )}
    </section>
  );
}
