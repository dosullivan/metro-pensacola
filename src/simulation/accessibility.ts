import type { SimulationAssumptions, SimulationZone, TransitLine } from '../types';
import { buildTransitGraph, fastestTransitPath } from './routing';

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
    for (const destination of zones) {
      if (origin.id === destination.id) {
        continue;
      }
      const path = fastestTransitPath(origin.centroid, destination.centroid, usableLines, assumptions, graph);
      if (path && path.totalMinutes <= 30) {
        reachableJobs += destination.jobs;
        reachablePopulation += destination.population;
      }
    }
    const jobScore = reachableJobs / totalJobs;
    const residentScore = reachablePopulation / totalPopulation;
    scores.set(origin.id, Math.min(1, jobScore * 0.7 + residentScore * 0.3));
  }

  return scores;
}
