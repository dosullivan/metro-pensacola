import type {
  CareerProgress,
  SimulationResults,
  TransitLine,
  TransitTechnologyId
} from '../types';
import { calculateConstructionCost, calculateLineMileage } from '../simulation/costs';

export const CAREER_STARTING_CAPITAL = 500_000_000;
export const CAREER_ANNUAL_OPERATING_SUBSIDY_CAP = 25_000_000;
export const DEMOLITION_REFUND_FRACTION = 0.5;
export const FARE_INCREASE_PER_DEFICIT_CHOICE = 0.5;
export const EMERGENCY_GRANT_CAPITAL_PENALTY_MULTIPLIER = 2;

export const CONSTRUCTION_MILES_PER_YEAR: Record<TransitTechnologyId, number> = {
  brt: 10,
  'light-rail': 5,
  'elevated-metro': 3,
  subway: 1.5
};

export type FundingMilestoneMetric =
  | 'weekday-ridership'
  | 'walk-population'
  | 'crowded-lines';

export interface FundingMilestone {
  id: string;
  title: string;
  description: string;
  metric: FundingMilestoneMetric;
  target: number;
  capitalGrant: number;
}

export const FUNDING_MILESTONES: FundingMilestone[] = [
  {
    id: 'first-300-riders',
    title: 'Early Ridership Grant',
    description: 'Reach 300 weekday riders.',
    metric: 'weekday-ridership',
    target: 300,
    capitalGrant: 250_000_000
  },
  {
    id: 'walk-access-25000',
    title: 'Walk Access Grant',
    description: 'Put 25,000 residents within walking distance of transit.',
    metric: 'walk-population',
    target: 25_000,
    capitalGrant: 500_000_000
  },
  {
    id: 'first-crowded-line',
    title: 'Capacity Relief Grant',
    description: 'Operate the first line that exceeds its crowding threshold.',
    metric: 'crowded-lines',
    target: 1,
    capitalGrant: 750_000_000
  }
];

export function createCareerProgress(existingCapitalCost = 0): CareerProgress {
  return {
    remainingCapital: Math.max(0, CAREER_STARTING_CAPITAL - existingCapitalCost),
    annualOperatingSubsidyCap: CAREER_ANNUAL_OPERATING_SUBSIDY_CAP,
    cumulativeOperatingSubsidy: 0,
    unlockedMilestoneIds: []
  };
}

export function careerProgressWithDefaults(
  progress: Partial<CareerProgress> | undefined,
  existingCapitalCost = 0
): CareerProgress {
  return { ...createCareerProgress(existingCapitalCost), ...progress };
}

export function constructionDurationYears(line: TransitLine): number {
  return Math.max(1, Math.ceil(calculateLineMileage(line) / CONSTRUCTION_MILES_PER_YEAR[line.technology]));
}

export function lineOpeningYear(line: TransitLine, startYear: number): number {
  return startYear + constructionDurationYears(line);
}

export function isLineOpen(line: TransitLine, simulationYear: number): boolean {
  return line.openingYear === undefined || simulationYear >= line.openingYear;
}

export function scheduleCareerConstruction(
  previousLines: TransitLine[],
  nextLines: TransitLine[],
  simulationYear: number,
  assumptions: Parameters<typeof calculateConstructionCost>[1]
): TransitLine[] {
  const previousById = new Map(previousLines.map((line) => [line.id, line]));
  return nextLines.map((line) => {
    const previous = previousById.get(line.id);
    if (!previous) {
      return {
        ...line,
        constructionStartedYear: simulationYear,
        openingYear: lineOpeningYear(line, simulationYear)
      };
    }
    const previousCost = calculateConstructionCost(previous, assumptions);
    const nextCost = calculateConstructionCost(line, assumptions);
    const requiresConstruction =
      nextCost > previousCost + 0.01 || previous.technology !== line.technology;
    const changesActiveConstruction =
      !isLineOpen(previous, simulationYear) && line !== previous;
    if (!requiresConstruction && !changesActiveConstruction) return line;

    const constructionStartedYear =
      !isLineOpen(previous, simulationYear) && previous.constructionStartedYear !== undefined
        ? previous.constructionStartedYear
        : simulationYear;
    return {
      ...line,
      constructionStartedYear,
      openingYear: lineOpeningYear(line, constructionStartedYear)
    };
  });
}

export function fundingMilestoneValue(
  milestone: FundingMilestone,
  results: SimulationResults | undefined
): number {
  if (!results) return 0;
  switch (milestone.metric) {
    case 'weekday-ridership':
      return results.dailyRidership;
    case 'walk-population':
      return results.populationWithinWalkingDistance;
    case 'crowded-lines':
      return (results.lineResults ?? []).filter((line) => line.crowdingMultiplier > 1).length;
  }
}

export function unlockFundingMilestones(
  progress: CareerProgress,
  results: SimulationResults
): { progress: CareerProgress; unlocked: FundingMilestone[] } {
  const unlocked = FUNDING_MILESTONES.filter(
    (milestone) =>
      !progress.unlockedMilestoneIds.includes(milestone.id) &&
      fundingMilestoneValue(milestone, results) >= milestone.target
  );
  if (unlocked.length === 0) return { progress, unlocked };
  return {
    progress: {
      ...progress,
      remainingCapital:
        progress.remainingCapital + unlocked.reduce((sum, milestone) => sum + milestone.capitalGrant, 0),
      unlockedMilestoneIds: [
        ...progress.unlockedMilestoneIds,
        ...unlocked.map((milestone) => milestone.id)
      ]
    },
    unlocked
  };
}
