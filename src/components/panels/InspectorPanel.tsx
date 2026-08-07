import { Info, MapPin, Route } from 'lucide-react';
import { PENSACOLA_ZONES } from '../../data/pensacola/zones';
import { calculateStationCatchment } from '../../simulation/catchment';
import { calculateConstructionCost, calculateLineMileage } from '../../simulation/costs';
import { selectActiveScenario, useScenarioStore } from '../../store/scenarioStore';
import { formatCurrency, formatMiles, formatNumber, formatPercent } from '../../utils/format';

export function InspectorPanel() {
  const scenario = useScenarioStore(selectActiveScenario);
  const inspectedFeature = useScenarioStore((state) => state.inspectedFeature);

  let content = (
    <div className="empty-state">
      <strong>Inspect</strong>
      <span>Select a zone, line, or station on the map.</span>
    </div>
  );

  if (inspectedFeature?.type === 'zone') {
    const zone = PENSACOLA_ZONES.find((candidate) => candidate.id === inspectedFeature.id);
    const result = scenario.results?.zoneResults.find((candidate) => candidate.zoneId === inspectedFeature.id);
    if (zone) {
      content = (
        <>
          <h3>{zone.name}</h3>
          <div className="metric-list compact">
            {zone.countyName ? (
              <div>
                <span>County</span>
                <strong>{zone.countyName.replace(' County', '')}</strong>
              </div>
            ) : null}
            <div>
              <span>Population</span>
              <strong>{formatNumber(zone.population + (result?.populationGrowth ?? 0))}</strong>
            </div>
            <div>
              <span>Jobs</span>
              <strong>{formatNumber(zone.jobs + (result?.jobsGrowth ?? 0))}</strong>
            </div>
            <div>
              <span>Density Index</span>
              <strong>{formatNumber(zone.density)}</strong>
            </div>
            {zone.areaSqMiles ? (
              <div>
                <span>Area</span>
                <strong>{formatNumber(zone.areaSqMiles, 2)} sq mi</strong>
              </div>
            ) : null}
            <div>
              <span>Car Ownership</span>
              <strong>{formatPercent(zone.carOwnership ?? 0)}</strong>
            </div>
            <div>
              <span>Accessibility</span>
              <strong>{formatPercent(result?.accessibilityScore ?? 0)}</strong>
            </div>
            <div>
              <span>Development Pressure</span>
              <strong>{formatPercent(result?.developmentPressure ?? 0)}</strong>
            </div>
            <div>
              <span>Housing Growth</span>
              <strong>{formatNumber(result?.housingGrowth ?? 0)}</strong>
            </div>
            <div>
              <span>Transit Trips</span>
              <strong>{formatNumber(result?.transitTrips ?? 0)}</strong>
            </div>
          </div>
        </>
      );
    }
  }

  if (inspectedFeature?.type === 'line') {
    const line = scenario.lines.find((candidate) => candidate.id === inspectedFeature.id);
    const result = scenario.results?.lineResults.find((candidate) => candidate.lineId === inspectedFeature.id);
    if (line) {
      content = (
        <>
          <h3>{line.name}</h3>
          <div className="metric-list compact">
            <div>
              <span>Technology</span>
              <strong>{scenario.assumptions.technologies[line.technology].name}</strong>
            </div>
            <div>
              <span>Frequency</span>
              <strong>{line.headwayMinutes} min</strong>
            </div>
            <div>
              <span>Mileage</span>
              <strong>{formatMiles(calculateLineMileage(line))}</strong>
            </div>
            <div>
              <span>Stations</span>
              <strong>{formatNumber(line.stations.length)}</strong>
            </div>
            <div>
              <span>Construction Cost</span>
              <strong>{formatCurrency(calculateConstructionCost(line, scenario.assumptions))}</strong>
            </div>
            <div>
              <span>Weekday Ridership</span>
              <strong>{formatNumber(result?.weekdayRidership ?? 0)}</strong>
            </div>
            <div>
              <span>Riders per Mile</span>
              <strong>{formatNumber(result?.ridersPerMile ?? 0)}</strong>
            </div>
          </div>
        </>
      );
    }
  }

  if (inspectedFeature?.type === 'station') {
    const line = scenario.lines.find((candidate) => candidate.id === inspectedFeature.lineId);
    const station = line?.stations.find((candidate) => candidate.id === inspectedFeature.stationId);
    const result = scenario.results?.stationResults.find((candidate) => candidate.stationId === inspectedFeature.stationId);
    if (line && station) {
      const catchment = result?.catchment ?? calculateStationCatchment(station, PENSACOLA_ZONES, scenario.assumptions);
      content = (
        <>
          <h3>{station.name}</h3>
          <div className="metric-list compact">
            <div>
              <span>Population within 0.5 mi</span>
              <strong>{formatNumber(catchment.populationHalfMile)}</strong>
            </div>
            <div>
              <span>Jobs within 0.5 mi</span>
              <strong>{formatNumber(catchment.jobsHalfMile)}</strong>
            </div>
            <div>
              <span>Population within 1 mi</span>
              <strong>{formatNumber(catchment.populationOneMile)}</strong>
            </div>
            <div>
              <span>Jobs within 1 mi</span>
              <strong>{formatNumber(catchment.jobsOneMile)}</strong>
            </div>
            <div>
              <span>Entries</span>
              <strong>{formatNumber(result?.entries ?? 0)}</strong>
            </div>
            <div>
              <span>Exits</span>
              <strong>{formatNumber(result?.exits ?? 0)}</strong>
            </div>
            <div>
              <span>Transfers</span>
              <strong>{formatNumber(result?.transfers ?? 0)}</strong>
            </div>
            <div>
              <span>Development Potential</span>
              <strong>{formatNumber(result?.developmentPotential ?? 0, 1)}</strong>
            </div>
          </div>
        </>
      );
    }
  }

  return (
    <section className="panel inspector-panel">
      <div className="panel-title">
        {inspectedFeature?.type === 'station' ? <MapPin size={18} /> : inspectedFeature?.type === 'line' ? <Route size={18} /> : <Info size={18} />}
        <span>Inspector</span>
      </div>
      {content}
    </section>
  );
}
