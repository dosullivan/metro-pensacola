import { describe, expect, it } from 'vitest';
import {
  CAREER_ANNUAL_OPERATING_SUBSIDY_CAP,
  CAREER_OBJECTIVES,
  COUNCIL_SUBSIDY_CAP_CUT,
  CONSTRUCTION_MILES_PER_YEAR,
  FUNDING_MILESTONES,
  constructionDurationYears,
  createCareerProgress,
  evaluateCareerGameplay,
  isLineOpen,
  lineOpeningYear,
  unlockFundingMilestones
} from '../src/data/gameplay';
import { DEFAULT_ASSUMPTIONS } from '../src/data/assumptions';
import type { Scenario, SimulationResults, TransitLine, TransitTechnologyId } from '../src/types';

function results(overrides: Partial<SimulationResults> = {}): SimulationResults {
  return {
    dailyRidership: 0,
    populationWithinWalkingDistance: 0,
    lineResults: [],
    ...overrides
  } as SimulationResults;
}

describe('career funding milestones', () => {
  it('unlocks a milestone exactly once and adds its grant', () => {
    const initial = createCareerProgress();
    const first = unlockFundingMilestones(initial, results({ dailyRidership: 300 }));
    const milestone = FUNDING_MILESTONES.find((candidate) => candidate.id === 'first-300-riders');

    expect(first.unlocked.map((candidate) => candidate.id)).toEqual(['first-300-riders']);
    expect(first.progress.remainingCapital).toBe(initial.remainingCapital + milestone!.capitalGrant);

    const second = unlockFundingMilestones(first.progress, results({ dailyRidership: 500 }));
    expect(second.unlocked).toEqual([]);
    expect(second.progress.remainingCapital).toBe(first.progress.remainingCapital);
  });

  it('creates persisted finance state with the configured operating cap', () => {
    const progress = createCareerProgress(125_000_000);
    expect(progress.remainingCapital).toBe(375_000_000);
    expect(progress.annualOperatingSubsidyCap).toBe(CAREER_ANNUAL_OPERATING_SUBSIDY_CAP);
  });
});

describe('construction timing', () => {
  const line = (technology: TransitTechnologyId, longitudeSpan: number): TransitLine => ({
    id: `${technology}-line`,
    name: 'Construction Test',
    technology,
    color: DEFAULT_ASSUMPTIONS.technologies[technology].color,
    headwayMinutes: 10,
    geometry: [[-87.2, 30.4], [-87.2 + longitudeSpan, 30.4]],
    stations: []
  });

  it('uses technology-specific construction rates and a minimum one-year build', () => {
    expect(CONSTRUCTION_MILES_PER_YEAR.brt).toBeGreaterThan(CONSTRUCTION_MILES_PER_YEAR.subway);
    expect(constructionDurationYears(line('brt', 0))).toBe(1);
    expect(constructionDurationYears(line('subway', 0.1))).toBeGreaterThan(
      constructionDurationYears(line('brt', 0.1))
    );
  });

  it('opens on the calculated year boundary', () => {
    const subway = line('subway', 0.05);
    subway.constructionStartedYear = 4;
    subway.openingYear = lineOpeningYear(subway, 4);

    expect(isLineOpen(subway, subway.openingYear - 1)).toBe(false);
    expect(isLineOpen(subway, subway.openingYear)).toBe(true);
  });
});

function careerScenario(year: number): Scenario {
  return {
    id: 'career-test',
    name: 'Career Test',
    gameMode: 'career',
    autoSimulationEnabled: false,
    lines: [],
    assumptions: JSON.parse(JSON.stringify(DEFAULT_ASSUMPTIONS)),
    simulationYear: year,
    budgetLimitsEnabled: true,
    career: createCareerProgress()
  };
}

describe('career objectives and events', () => {
  it('meets objectives at their exact thresholds and wins at the final deadline', () => {
    const scenario = careerScenario(20);
    const evaluation = evaluateCareerGameplay(
      scenario,
      results({
        dailyRidership: 1_500,
        operatingSubsidy: 25_000_000,
        airportConnected: true
      })
    );

    expect(CAREER_OBJECTIVES.map((objective) => evaluation.progress.objectiveResults[objective.id].status))
      .toEqual(['met', 'met', 'met']);
    expect(evaluation.progress.outcome?.status).toBe('won');
  });

  it('misses objectives one unit beyond their thresholds', () => {
    const evaluation = evaluateCareerGameplay(
      careerScenario(20),
      results({
        dailyRidership: 1_499,
        operatingSubsidy: 25_000_001,
        airportConnected: false
      })
    );

    expect(evaluation.progress.objectiveResults['airport-by-10'].status).toBe('missed');
    expect(evaluation.progress.objectiveResults['ridership-by-20'].status).toBe('missed');
    expect(evaluation.progress.objectiveResults['subsidy-by-20'].status).toBe('missed');
    expect(evaluation.progress.outcome?.status).toBe('lost');
  });

  it('applies airport and station effects only once', () => {
    const scenario = careerScenario(3);
    const eventResults = results({
      airportStationMovements: 40,
      stationResults: [
        {
          stationId: 'boom',
          stationName: 'Boom Station',
          lineId: 'line',
          entries: 60,
          exits: 40,
          transfers: 0,
          nearbyPopulation: 0,
          nearbyJobs: 0,
          developmentPotential: 0,
          catchment: {
            populationHalfMile: 0,
            jobsHalfMile: 0,
            populationOneMile: 0,
            jobsOneMile: 0,
            zoneIdsHalfMile: [],
            zoneIdsOneMile: ['zone-a'],
            zoneWeightsHalfMile: {},
            zoneWeightsOneMile: { 'zone-a': 0.5 }
          }
        }
      ]
    });

    const first = evaluateCareerGameplay(scenario, eventResults);
    const second = evaluateCareerGameplay(
      { ...scenario, assumptions: first.assumptions, career: first.progress },
      eventResults,
      first.progress
    );

    expect(first.assumptions.airportEventDemandBonus).toBe(0.1);
    expect(second.assumptions.airportEventDemandBonus).toBe(0.1);
    expect(first.progress.developmentCapacityBonuses['zone-a']).toBeCloseTo(0.075);
    expect(second.progress.developmentCapacityBonuses['zone-a']).toBeCloseTo(0.075);
  });

  it('cuts the subsidy cap once when a council review expires without improvement', () => {
    const scenario = careerScenario(0);
    const costlyLine = {
      lineId: 'costly',
      lineName: 'Costly Line',
      constructionCost: 100_000_000,
      weekdayRidership: 100
    } as SimulationResults['lineResults'][number];
    const opened = evaluateCareerGameplay(scenario, results({ lineResults: [costlyLine] }));
    expect(opened.progress.activeCouncilReview?.deadlineYear).toBe(2);

    const deadlineScenario = { ...scenario, simulationYear: 2, career: opened.progress };
    const expired = evaluateCareerGameplay(
      deadlineScenario,
      results({ lineResults: [costlyLine] }),
      opened.progress
    );
    const repeated = evaluateCareerGameplay(
      { ...deadlineScenario, simulationYear: 3, career: expired.progress },
      results({ lineResults: [costlyLine] }),
      expired.progress
    );

    expect(expired.progress.annualOperatingSubsidyCap).toBe(
      CAREER_ANNUAL_OPERATING_SUBSIDY_CAP - COUNCIL_SUBSIDY_CAP_CUT
    );
    expect(repeated.progress.annualOperatingSubsidyCap).toBe(
      expired.progress.annualOperatingSubsidyCap
    );
  });
});
