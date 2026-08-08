import type { CareerProgress, SimulationResults } from '../types';

export const CAREER_STARTING_CAPITAL = 500_000_000;
export const CAREER_ANNUAL_OPERATING_SUBSIDY_CAP = 25_000_000;
export const DEMOLITION_REFUND_FRACTION = 0.5;

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
    unlockedMilestoneIds: []
  };
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
