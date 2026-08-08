import type {
  CareerProgress,
  Scenario,
  SimulationAssumptions,
  SimulationMessage,
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
export const COUNCIL_REVIEW_YEARS = 2;
export const COUNCIL_RIDERSHIP_IMPROVEMENT = 1.25;
export const COUNCIL_SUBSIDY_CAP_CUT = 5_000_000;

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

export type CareerObjectiveMetric =
  | 'weekday-ridership'
  | 'airport-connected'
  | 'operating-subsidy';

export interface CareerObjective {
  id: string;
  title: string;
  description: string;
  metric: CareerObjectiveMetric;
  target: number;
  comparison: 'at-least' | 'at-most';
  deadlineYear: number;
}

export const CAREER_OBJECTIVES: CareerObjective[] = [
  {
    id: 'airport-by-10',
    title: 'Connect Pensacola Airport',
    description: 'Open a station within the airport service radius by Year 10.',
    metric: 'airport-connected',
    target: 1,
    comparison: 'at-least',
    deadlineYear: 10
  },
  {
    id: 'ridership-by-20',
    title: 'Regional Ridership Mandate',
    description: 'Reach 1,500 weekday riders by Year 20.',
    metric: 'weekday-ridership',
    target: 1_500,
    comparison: 'at-least',
    deadlineYear: 20
  },
  {
    id: 'subsidy-by-20',
    title: 'Sustainable Operations',
    description: 'Keep annual operating subsidy at or below $25 million in Year 20.',
    metric: 'operating-subsidy',
    target: 25_000_000,
    comparison: 'at-most',
    deadlineYear: 20
  }
];

export type GameplayEventType = 'airport-demand' | 'council-review' | 'station-capacity';

export interface GameplayEventDefinition {
  id: string;
  title: string;
  type: GameplayEventType;
  threshold: number;
  effect: number;
}

export const GAMEPLAY_EVENTS: GameplayEventDefinition[] = [
  {
    id: 'airport-success',
    title: 'Airport Partnership Signed',
    type: 'airport-demand',
    threshold: 40,
    effect: 0.1
  },
  {
    id: 'council-questions',
    title: 'Council Opens Cost Review',
    type: 'council-review',
    threshold: 450_000,
    effect: COUNCIL_SUBSIDY_CAP_CUT
  },
  {
    id: 'station-booming',
    title: 'Station District Rezoned',
    type: 'station-capacity',
    threshold: 100,
    effect: 0.15
  }
];

export function createCareerProgress(existingCapitalCost = 0): CareerProgress {
  return {
    remainingCapital: Math.max(0, CAREER_STARTING_CAPITAL - existingCapitalCost),
    annualOperatingSubsidyCap: CAREER_ANNUAL_OPERATING_SUBSIDY_CAP,
    cumulativeOperatingSubsidy: 0,
    unlockedMilestoneIds: [],
    objectiveResults: Object.fromEntries(
      CAREER_OBJECTIVES.map((objective) => [objective.id, { status: 'pending', value: 0 }])
    ),
    completedEventIds: [],
    developmentCapacityBonuses: {}
  };
}

export function careerProgressWithDefaults(
  progress: Partial<CareerProgress> | undefined,
  existingCapitalCost = 0
): CareerProgress {
  const defaults = createCareerProgress(existingCapitalCost);
  return {
    ...defaults,
    ...progress,
    objectiveResults: {
      ...defaults.objectiveResults,
      ...(progress?.objectiveResults ?? {})
    },
    completedEventIds: progress?.completedEventIds ?? defaults.completedEventIds,
    developmentCapacityBonuses:
      progress?.developmentCapacityBonuses ?? defaults.developmentCapacityBonuses
  };
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
      return results.dailyRidership ?? 0;
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

export function careerObjectiveValue(
  objective: CareerObjective,
  results: SimulationResults | undefined
): number {
  if (!results) return 0;
  switch (objective.metric) {
    case 'weekday-ridership':
      return results.dailyRidership ?? 0;
    case 'airport-connected':
      return results.airportConnected ? 1 : 0;
    case 'operating-subsidy':
      return results.operatingSubsidy ?? 0;
  }
}

export function objectiveTargetMet(objective: CareerObjective, value: number): boolean {
  return objective.comparison === 'at-least'
    ? value >= objective.target
    : value <= objective.target;
}

export interface CareerGameplayEvaluation {
  progress: CareerProgress;
  assumptions: SimulationAssumptions;
  messages: SimulationMessage[];
}

export function evaluateCareerGameplay(
  scenario: Scenario,
  results: SimulationResults,
  startingProgress: CareerProgress = scenario.career as CareerProgress
): CareerGameplayEvaluation {
  let progress: CareerProgress = {
    ...startingProgress,
    objectiveResults: { ...startingProgress.objectiveResults },
    completedEventIds: [...startingProgress.completedEventIds],
    developmentCapacityBonuses: { ...startingProgress.developmentCapacityBonuses }
  };
  let assumptions = scenario.assumptions;
  const messages: SimulationMessage[] = [];
  let simulationEffectApplied = false;

  if (progress.activeCouncilReview) {
    const review = progress.activeCouncilReview;
    const line = (results.lineResults ?? []).find((candidate) => candidate.lineId === review.lineId);
    if ((line?.weekdayRidership ?? 0) >= review.baselineRidership * COUNCIL_RIDERSHIP_IMPROVEMENT) {
      progress = { ...progress, activeCouncilReview: undefined };
      messages.push({
        id: 'council-review-cleared',
        title: 'Council Review Cleared',
        body: `${review.lineName} improved ridership by at least 25%; the subsidy cap is unchanged.`
      });
    } else if (scenario.simulationYear >= review.deadlineYear) {
      progress = {
        ...progress,
        annualOperatingSubsidyCap: Math.max(
          0,
          progress.annualOperatingSubsidyCap - review.subsidyCapCut
        ),
        activeCouncilReview: undefined
      };
      messages.push({
        id: 'council-review-failed',
        title: 'Council Cuts Operating Support',
        body: `${review.lineName} missed its ridership recovery target. The annual subsidy cap falls by $${(review.subsidyCapCut / 1_000_000).toLocaleString()} million.`
      });
    }
  }

  for (const event of GAMEPLAY_EVENTS) {
    if (progress.completedEventIds.includes(event.id)) continue;

    if (event.type === 'airport-demand' && results.airportStationMovements >= event.threshold) {
      assumptions = {
        ...assumptions,
        airportEventDemandBonus: assumptions.airportEventDemandBonus + event.effect
      };
      simulationEffectApplied = true;
      progress.completedEventIds.push(event.id);
      messages.push({
        id: event.id,
        title: event.title,
        body: 'Airline and airport partners add a permanent 10% demand bonus to airport trips.'
      });
    }

    if (event.type === 'council-review') {
      const line = [...(results.lineResults ?? [])]
        .filter((candidate) => candidate.weekdayRidership > 0)
        .sort(
          (a, b) =>
            b.constructionCost / b.weekdayRidership -
            a.constructionCost / a.weekdayRidership
        )[0];
      const costPerRider = line ? line.constructionCost / line.weekdayRidership : 0;
      if (line && costPerRider >= event.threshold) {
        progress.completedEventIds.push(event.id);
        progress = {
          ...progress,
          activeCouncilReview: {
            lineId: line.lineId,
            lineName: line.lineName,
            baselineRidership: line.weekdayRidership,
            deadlineYear: scenario.simulationYear + COUNCIL_REVIEW_YEARS,
            subsidyCapCut: event.effect
          }
        };
        messages.push({
          id: event.id,
          title: event.title,
          body: `${line.lineName} has two years to improve ridership by 25% or the annual subsidy cap will be cut by $5 million.`
        });
      }
    }

    if (event.type === 'station-capacity') {
      const station = [...(results.stationResults ?? [])].sort(
        (a, b) => b.entries + b.exits - (a.entries + a.exits)
      )[0];
      const movements = station ? station.entries + station.exits : 0;
      if (station && movements >= event.threshold) {
        const developmentCapacityBonuses = { ...progress.developmentCapacityBonuses };
        for (const zoneId of station.catchment.zoneIdsOneMile) {
          developmentCapacityBonuses[zoneId] =
            (developmentCapacityBonuses[zoneId] ?? 0) +
            event.effect * (station.catchment.zoneWeightsOneMile[zoneId] ?? 0);
        }
        progress.completedEventIds.push(event.id);
        progress = { ...progress, developmentCapacityBonuses };
        simulationEffectApplied = true;
        messages.push({
          id: event.id,
          title: event.title,
          body: `${station.stationName}'s one-mile catchment receives a permanent development-capacity increase.`
        });
      }
    }
  }

  for (const objective of CAREER_OBJECTIVES) {
    const existing = progress.objectiveResults[objective.id] ?? { status: 'pending', value: 0 };
    const value = careerObjectiveValue(objective, results);
    progress.objectiveResults[objective.id] = { ...existing, value };
    if (
      !simulationEffectApplied &&
      existing.status === 'pending' &&
      scenario.simulationYear >= objective.deadlineYear
    ) {
      const status = objectiveTargetMet(objective, value) ? 'met' : 'missed';
      progress.objectiveResults[objective.id] = {
        status,
        value,
        evaluatedYear: scenario.simulationYear
      };
      messages.push({
        id: `objective-${objective.id}-${status}`,
        title: `${objective.title}: ${status === 'met' ? 'Complete' : 'Missed'}`,
        body: `Deadline Year ${objective.deadlineYear} result: ${Math.round(value).toLocaleString()}.`
      });
    }
  }

  const finalDeadline = Math.max(...CAREER_OBJECTIVES.map((objective) => objective.deadlineYear));
  if (!progress.outcome && scenario.simulationYear >= finalDeadline) {
    const statuses = CAREER_OBJECTIVES.map(
      (objective) => progress.objectiveResults[objective.id]?.status ?? 'pending'
    );
    if (statuses.every((status) => status !== 'pending')) {
      progress = {
        ...progress,
        outcome: {
          status: statuses.every((status) => status === 'met') ? 'won' : 'lost',
          year: scenario.simulationYear,
          dailyRidership: results.dailyRidership,
          operatingSubsidy: results.operatingSubsidy
        }
      };
    }
  }

  return { progress, assumptions, messages };
}
