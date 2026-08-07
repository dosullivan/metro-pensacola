import type { SimulationAssumptions, TransitLine } from '../types';
import { lineMileage } from './geo';

export function calculateLineMileage(line: TransitLine): number {
  return lineMileage(line.geometry);
}

export function calculateConstructionCost(line: TransitLine, assumptions: SimulationAssumptions): number {
  const technology = assumptions.technologies[line.technology];
  return calculateLineMileage(line) * technology.capitalCostPerMile + line.stations.length * technology.stationCost;
}

export function calculateAnnualOperatingCost(line: TransitLine, assumptions: SimulationAssumptions): number {
  const technology = assumptions.technologies[line.technology];
  const mileageFactor = calculateLineMileage(line) / 15;
  const frequencyFactor = assumptions.baseHeadwayMinutes / line.headwayMinutes;
  return technology.baseOperatingCostPer15Miles * mileageFactor * frequencyFactor;
}

export function averageWaitTime(headwayMinutes: number): number {
  return headwayMinutes / 2;
}

export function calculateScenarioCapitalCost(lines: TransitLine[], assumptions: SimulationAssumptions): number {
  return lines.reduce((sum, line) => sum + calculateConstructionCost(line, assumptions), 0);
}

export function calculateScenarioOperatingCost(lines: TransitLine[], assumptions: SimulationAssumptions): number {
  return lines.reduce((sum, line) => sum + calculateAnnualOperatingCost(line, assumptions), 0);
}
