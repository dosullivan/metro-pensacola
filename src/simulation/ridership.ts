import type { SimulationAssumptions, SimulationZone, TransitLine } from '../types';
import { createDemandMatrix } from './demand';
import { buildTransitGraph, transitTimesFromOrigin, type TransitOriginPaths } from './routing';
import { clamp, distanceMiles, minutesForDistance } from './geo';

export interface NetworkRidership {
  dailyRidership: number;
  weightedTimeSavings: number;
  lineRidership: Map<string, number>;
  stationEntries: Map<string, number>;
  stationExits: Map<string, number>;
  stationTransfers: Map<string, number>;
  zoneTransitTrips: Map<string, number>;
}

function emptyRidership(lines: TransitLine[], zones: SimulationZone[]): NetworkRidership {
  return {
    dailyRidership: 0,
    weightedTimeSavings: 0,
    lineRidership: new Map(lines.map((line) => [line.id, 0])),
    stationEntries: new Map(lines.flatMap((line) => line.stations.map((station) => [station.id, 0] as [string, number]))),
    stationExits: new Map(lines.flatMap((line) => line.stations.map((station) => [station.id, 0] as [string, number]))),
    stationTransfers: new Map(lines.flatMap((line) => line.stations.map((station) => [station.id, 0] as [string, number]))),
    zoneTransitTrips: new Map(zones.map((zone) => [zone.id, 0]))
  };
}

export function estimateCarTime(
  origin: SimulationZone,
  destination: SimulationZone,
  assumptions: SimulationAssumptions
): number {
  const roadMiles = distanceMiles(origin.centroid, destination.centroid) * assumptions.roadCircuityFactor;
  const baseTime = minutesForDistance(roadMiles, assumptions.carAverageSpeedMph);
  const employmentIntensity = clamp(destination.jobs / 15_000, 0, 1);
  const densityIntensity = clamp((origin.density + destination.density) / 8_000, 0, 1);
  return (
    baseTime +
    assumptions.parkingPenaltyMinutes * employmentIntensity +
    assumptions.congestionPenaltyMinutes * densityIntensity
  );
}

export function transitModeShare(
  transitTime: number,
  carTime: number,
  assumptions: SimulationAssumptions
): number {
  const logistic = 1 / (1 + Math.exp(assumptions.modeChoiceBeta * (transitTime - carTime)));
  return clamp(logistic * assumptions.maxTransitModeShare, 0, assumptions.maxTransitModeShare);
}

export function estimateNetworkRidership(
  lines: TransitLine[],
  zones: SimulationZone[],
  assumptions: SimulationAssumptions
): NetworkRidership {
  const ridership = emptyRidership(lines, zones);
  const usableLines = lines.filter((line) => line.stations.length >= 2);
  if (usableLines.length === 0) {
    return ridership;
  }

  const graph = buildTransitGraph(usableLines, assumptions);
  const demand = createDemandMatrix(zones, assumptions);
  const pathsByOrigin = new Map<number, TransitOriginPaths>();

  for (const od of demand) {
    const origin = zones[od.originIndex];
    const destination = zones[od.destinationIndex];
    let originPaths = pathsByOrigin.get(od.originIndex);
    if (!originPaths) {
      originPaths = transitTimesFromOrigin(origin.centroid, usableLines, assumptions, graph);
      pathsByOrigin.set(od.originIndex, originPaths);
    }
    const path = originPaths.pathTo(destination.centroid);
    if (!path) {
      continue;
    }

    const carTime = estimateCarTime(origin, destination, assumptions);
    const share = transitModeShare(path.totalMinutes, carTime, assumptions);
    const riders = od.dailyTrips * share;
    if (riders <= 0.001) {
      continue;
    }

    ridership.dailyRidership += riders;
    ridership.weightedTimeSavings += riders * Math.max(0, carTime - path.totalMinutes);
    ridership.stationEntries.set(path.originStationId, (ridership.stationEntries.get(path.originStationId) ?? 0) + riders);
    ridership.stationExits.set(
      path.destinationStationId,
      (ridership.stationExits.get(path.destinationStationId) ?? 0) + riders
    );
    ridership.zoneTransitTrips.set(origin.id, (ridership.zoneTransitTrips.get(origin.id) ?? 0) + riders);

    for (const stationId of path.transferStationIds) {
      ridership.stationTransfers.set(stationId, (ridership.stationTransfers.get(stationId) ?? 0) + riders);
    }

    for (const lineId of path.lineIds) {
      ridership.lineRidership.set(lineId, (ridership.lineRidership.get(lineId) ?? 0) + riders);
    }
  }

  return ridership;
}
