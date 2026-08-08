import { describe, expect, it } from 'vitest';
import {
  CAREER_ANNUAL_OPERATING_SUBSIDY_CAP,
  FUNDING_MILESTONES,
  createCareerProgress,
  unlockFundingMilestones
} from '../src/data/gameplay';
import type { SimulationResults } from '../src/types';

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
