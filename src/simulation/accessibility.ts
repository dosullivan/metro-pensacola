import type { SimulationAssumptions, SimulationZone, TransitLine } from '../types';
import { buildTransitGraph, transitTimesFromOrigin } from './routing';

export function accessibilityWeight(
  travelMinutes: number,
  assumptions: SimulationAssumptions
): number {
  return 1 / (
    1 + Math.exp(
      assumptions.accessibilityDecayBeta *
        (travelMinutes - assumptions.accessibilityMidpointMinutes)
    )
  );
}

export function calculateAccessibilityScores(
  lines: TransitLine[],
  zones: SimulationZone[],
  assumptions: SimulationAssumptions
): Map<string, number> {
  const usableLines = lines.filter((line) => line.stations.length >= 2);
  const scores = new Map<string, number>(zones.map((zone) => [zone.id, 0]));
  if (usableLines.length === 0) {
    return scores;
  }

  const graph = buildTransitGraph(usableLines, assumptions);
  const totalJobs = zones.reduce((sum, zone) => sum + zone.jobs, 0) || 1;
  const totalPopulation = zones.reduce((sum, zone) => sum + zone.population, 0) || 1;

  for (const origin of zones) {
    let reachableJobs = 0;
    let reachablePopulation = 0;
    const originPaths = transitTimesFromOrigin(origin.centroid, usableLines, assumptions, graph);
    for (const destination of zones) {
      if (origin.id === destination.id) {
        continue;
      }
      const path = originPaths.pathTo(destination.centroid);
      if (path) {
        const weight = accessibilityWeight(path.totalMinutes, assumptions);
        reachableJobs += destination.jobs * weight;
        reachablePopulation += destination.population * weight;
      }
    }
    const jobScore = reachableJobs / totalJobs;
    const residentScore = reachablePopulation / totalPopulation;
    scores.set(origin.id, Math.min(1, jobScore * 0.7 + residentScore * 0.3));
  }

  return scores;
}
