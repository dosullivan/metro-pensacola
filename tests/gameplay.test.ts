import { describe, expect, it } from 'vitest';
import {
  CAREER_ANNUAL_OPERATING_SUBSIDY_CAP,
  CONSTRUCTION_MILES_PER_YEAR,
  FUNDING_MILESTONES,
  constructionDurationYears,
  createCareerProgress,
  isLineOpen,
  lineOpeningYear,
  unlockFundingMilestones
} from '../src/data/gameplay';
import { DEFAULT_ASSUMPTIONS } from '../src/data/assumptions';
import type { SimulationResults, TransitLine, TransitTechnologyId } from '../src/types';

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
