import type { SimulationAssumptions, SimulationZone, TransitLine } from '../types';
import { createDemandMatrix } from './demand';
import {
  buildTransitGraph,
  transitTimesFromOrigin,
  type TransitOriginPaths,
  type TransitPath
} from './routing';
import { clamp, distanceMiles, minutesForDistance } from './geo';

export interface NetworkRidership {
  dailyRidership: number;
  weightedTimeSavings: number;
  lineRidership: Map<string, number>;
  stationEntries: Map<string, number>;
  stationExits: Map<string, number>;
  stationTransfers: Map<string, number>;
  zoneTransitTrips: Map<string, number>;
  segmentRidership: Map<string, number>;
  lineCrowdingMultipliers: Map<string, number>;
}

export interface RidershipOptions {
  applyCrowding?: boolean;
  baseZones?: SimulationZone[];
}

export interface WeightedTransitPath {
  path: TransitPath;
  share: number;
}

function pathSignature(path: TransitPath): string {
  return [
    path.originStationId,
    path.destinationStationId,
    ...path.segments.map(
      (segment) => `${segment.lineId}:${segment.fromStationId}->${segment.toStationId}`
    )
  ].join('|');
}

export function spreadTransitPaths(
  paths: TransitPath[],
  assumptions: SimulationAssumptions
): WeightedTransitPath[] {
  const uniquePaths = Array.from(
    new Map(paths.map((path) => [pathSignature(path), path])).values()
  ).sort((a, b) => a.totalMinutes - b.totalMinutes || pathSignature(a).localeCompare(pathSignature(b)));
  const bestMinutes = uniquePaths[0]?.totalMinutes;
  if (bestMinutes === undefined) {
    return [];
  }
  const eligible = uniquePaths.filter(
    (path) => path.totalMinutes <= bestMinutes + assumptions.pathChoiceMaximumExtraMinutes
  );
  const weights = eligible.map((path) =>
    Math.exp(-assumptions.pathChoiceBeta * (path.totalMinutes - bestMinutes))
  );
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  return eligible.map((path, index) => ({
    path,
    share: totalWeight > 0 ? weights[index] / totalWeight : index === 0 ? 1 : 0
  }));
}

export function directedSegmentKey(
  lineId: string,
  fromStationId: string,
  toStationId: string
): string {
  return `${lineId}:${fromStationId}->${toStationId}`;
}

function directedSegmentKeys(lines: TransitLine[]): string[] {
  return lines.flatMap((line) => {
    const stations = [...line.stations].sort((a, b) => a.order - b.order);
    return stations.slice(0, -1).flatMap((station, index) => {
      const next = stations[index + 1];
      return [
        directedSegmentKey(line.id, station.id, next.id),
        directedSegmentKey(line.id, next.id, station.id)
      ];
    });
  });
}

function emptyRidership(lines: TransitLine[], zones: SimulationZone[]): NetworkRidership {
  return {
    dailyRidership: 0,
    weightedTimeSavings: 0,
    lineRidership: new Map(lines.map((line) => [line.id, 0])),
    stationEntries: new Map(lines.flatMap((line) => line.stations.map((station) => [station.id, 0] as [string, number]))),
    stationExits: new Map(lines.flatMap((line) => line.stations.map((station) => [station.id, 0] as [string, number]))),
    stationTransfers: new Map(lines.flatMap((line) => line.stations.map((station) => [station.id, 0] as [string, number]))),
    zoneTransitTrips: new Map(zones.map((zone) => [zone.id, 0])),
    segmentRidership: new Map(directedSegmentKeys(lines).map((key) => [key, 0])),
    lineCrowdingMultipliers: new Map(lines.map((line) => [line.id, 1]))
  };
}

export function estimateCarTime(
  origin: SimulationZone,
  destination: SimulationZone,
  assumptions: SimulationAssumptions
): number {
  const roadMiles = distanceMiles(origin.centroid, destination.centroid) * assumptions.roadCircuityFactor;
  const baseTime = minutesForDistance(roadMiles, assumptions.carAverageSpeedMph);
  const employmentIntensity = clamp(
    destination.jobs / assumptions.carEmploymentNormalizationJobs,
    0,
    1
  );
  const densityIntensity = clamp(
    (origin.density + destination.density) / assumptions.carDensityNormalization,
    0,
    1
  );
  return (
    baseTime +
    assumptions.parkingPenaltyMinutes * employmentIntensity +
    assumptions.congestionPenaltyMinutes * densityIntensity
  );
}

function monetaryCostMinutes(dollars: number, assumptions: SimulationAssumptions): number {
  return assumptions.valueOfTimeDollarsPerHour > 0
    ? dollars * 60 / assumptions.valueOfTimeDollarsPerHour
    : 0;
}

export function estimateTransitGeneralizedTime(
  transitTime: number,
  assumptions: SimulationAssumptions
): number {
  return transitTime + monetaryCostMinutes(assumptions.defaultFare, assumptions);
}

export function estimateCarGeneralizedTime(
  origin: SimulationZone,
  destination: SimulationZone,
  assumptions: SimulationAssumptions
): number {
  const roadMiles = distanceMiles(origin.centroid, destination.centroid) * assumptions.roadCircuityFactor;
  return (
    estimateCarTime(origin, destination, assumptions) +
    monetaryCostMinutes(roadMiles * assumptions.carCostPerMile, assumptions)
  );
}

export function transitModeShare(
  transitTime: number,
  carTime: number,
  assumptions: SimulationAssumptions,
  maximumShare = assumptions.maxTransitModeShare
): number {
  const generalizedDifference =
    transitTime + assumptions.transitSpecificConstantMinutes - carTime;
  const logistic = 1 / (1 + Math.exp(assumptions.modeChoiceBeta * generalizedDifference));
  return clamp(logistic * maximumShare, 0, maximumShare);
}

export function maximumTransitShareForOrigin(
  origin: SimulationZone,
  assumptions: SimulationAssumptions
): number {
  const zeroVehicleHouseholdRate = clamp(1 - (origin.carOwnership ?? 1), 0, 1);
  return (
    assumptions.maxTransitModeShare +
    (1 - assumptions.maxTransitModeShare) * zeroVehicleHouseholdRate
  );
}

function assignNetworkRidership(
  lines: TransitLine[],
  zones: SimulationZone[],
  assumptions: SimulationAssumptions,
  lineTimeMultipliers: ReadonlyMap<string, number>,
  baseZones: SimulationZone[]
): NetworkRidership {
  const ridership = emptyRidership(lines, zones);
  for (const line of lines) {
    ridership.lineCrowdingMultipliers.set(line.id, lineTimeMultipliers.get(line.id) ?? 1);
  }
  const usableLines = lines.filter((line) => line.stations.length >= 2);
  if (usableLines.length === 0) {
    return ridership;
  }

  const graph = buildTransitGraph(usableLines, assumptions, lineTimeMultipliers);
  const singleLineServices = new Map<
    string,
    { line: TransitLine; graph: ReturnType<typeof buildTransitGraph> }
  >();
  function singleLineService(lineId: string) {
    let service = singleLineServices.get(lineId);
    if (!service) {
      const line = usableLines.find((candidate) => candidate.id === lineId) as TransitLine;
      service = { line, graph: buildTransitGraph([line], assumptions, lineTimeMultipliers) };
      singleLineServices.set(lineId, service);
    }
    return service;
  }

  const eligibleLinesByZone = zones.map((zone) =>
    usableLines
      .filter((line) =>
        line.stations.some(
          (station) => distanceMiles(zone.centroid, station.coordinate) <= assumptions.extendedCatchmentMiles
        )
      )
      .map((line) => line.id)
  );

  const demand = createDemandMatrix(zones, assumptions, baseZones);
  const fullPathsByOrigin = new Map<number, TransitOriginPaths>();
  const linePathsByOrigin = new Map<number, Map<string, TransitOriginPaths>>();

  for (const od of demand) {
    const origin = zones[od.originIndex];
    const destination = zones[od.destinationIndex];
    let fullPaths = fullPathsByOrigin.get(od.originIndex);
    if (!fullPaths) {
      fullPaths = transitTimesFromOrigin(origin.centroid, usableLines, assumptions, graph);
      fullPathsByOrigin.set(od.originIndex, fullPaths);
    }
    const fullPath = fullPaths.pathTo(destination.centroid);

    const destinationEligible = eligibleLinesByZone[od.destinationIndex];
    const sharedEligibleLineIds = eligibleLinesByZone[od.originIndex].filter((lineId) =>
      destinationEligible.includes(lineId)
    );

    const alternativePaths: TransitPath[] = [];
    if (usableLines.length > 1 && (fullPath || sharedEligibleLineIds.length > 0)) {
      let linePaths = linePathsByOrigin.get(od.originIndex);
      if (!linePaths) {
        linePaths = new Map<string, TransitOriginPaths>();
        linePathsByOrigin.set(od.originIndex, linePaths);
      }
      for (const lineId of sharedEligibleLineIds) {
        let originPaths = linePaths.get(lineId);
        if (!originPaths) {
          const service = singleLineService(lineId);
          originPaths = transitTimesFromOrigin(origin.centroid, [service.line], assumptions, service.graph);
          linePaths.set(lineId, originPaths);
        }
        const path = originPaths.pathTo(destination.centroid);
        if (path) {
          alternativePaths.push(path);
        }
      }
    }

    const pathChoices = spreadTransitPaths(
      [...(fullPath ? [fullPath] : []), ...alternativePaths],
      assumptions
    );
    const fastestPath = pathChoices[0]?.path;
    if (!fastestPath) {
      continue;
    }

    const carTime = estimateCarTime(origin, destination, assumptions);
    const transitGeneralizedTime = estimateTransitGeneralizedTime(fastestPath.totalMinutes, assumptions);
    const carGeneralizedTime = estimateCarGeneralizedTime(origin, destination, assumptions);
    const share = transitModeShare(
      transitGeneralizedTime,
      carGeneralizedTime,
      assumptions,
      maximumTransitShareForOrigin(origin, assumptions)
    );
    const riders = od.dailyTrips * share;
    if (riders <= 0.001) {
      continue;
    }

    ridership.dailyRidership += riders;
    ridership.zoneTransitTrips.set(origin.id, (ridership.zoneTransitTrips.get(origin.id) ?? 0) + riders);
    ridership.zoneTransitTrips.set(
      destination.id,
      (ridership.zoneTransitTrips.get(destination.id) ?? 0) + riders
    );

    for (const choice of pathChoices) {
      const pathRiders = riders * choice.share;
      const path = choice.path;
      ridership.weightedTimeSavings += pathRiders * Math.max(0, carTime - path.totalMinutes);
      ridership.stationEntries.set(
        path.originStationId,
        (ridership.stationEntries.get(path.originStationId) ?? 0) + pathRiders
      );
      ridership.stationExits.set(
        path.destinationStationId,
        (ridership.stationExits.get(path.destinationStationId) ?? 0) + pathRiders
      );

      for (const stationId of path.transferStationIds) {
        ridership.stationTransfers.set(
          stationId,
          (ridership.stationTransfers.get(stationId) ?? 0) + pathRiders
        );
      }

      for (const lineId of path.lineIds) {
        ridership.lineRidership.set(
          lineId,
          (ridership.lineRidership.get(lineId) ?? 0) + pathRiders
        );
      }

      for (const segment of path.segments) {
        const key = directedSegmentKey(segment.lineId, segment.fromStationId, segment.toStationId);
        ridership.segmentRidership.set(
          key,
          (ridership.segmentRidership.get(key) ?? 0) + pathRiders
        );
      }
    }
  }

  return ridership;
}

function crowdingMultipliers(
  lines: TransitLine[],
  ridership: NetworkRidership,
  assumptions: SimulationAssumptions
): Map<string, number> {
  const multipliers = new Map<string, number>();

  for (const line of lines) {
    const stations = [...line.stations].sort((a, b) => a.order - b.order);
    let peakDailySegmentLoad = 0;
    for (let index = 0; index < stations.length - 1; index += 1) {
      const from = stations[index];
      const to = stations[index + 1];
      peakDailySegmentLoad = Math.max(
        peakDailySegmentLoad,
        ridership.segmentRidership.get(directedSegmentKey(line.id, from.id, to.id)) ?? 0,
        ridership.segmentRidership.get(directedSegmentKey(line.id, to.id, from.id)) ?? 0
      );
    }

    const technology = assumptions.technologies[line.technology];
    const hourlyCapacity = technology.vehicleCapacity * 60 / line.headwayMinutes;
    const peakHourlyLoad = peakDailySegmentLoad * assumptions.peakHourRidershipShare;
    const loadRatio = hourlyCapacity > 0 ? peakHourlyLoad / hourlyCapacity : Number.POSITIVE_INFINITY;
    const excessLoadRatio = Math.max(0, loadRatio - assumptions.crowdingThreshold);
    const multiplier =
      excessLoadRatio > 0
        ? 1 +
          assumptions.crowdingTimePenaltyFactor *
            (excessLoadRatio / (1 + excessLoadRatio))
        : 1;
    multipliers.set(line.id, multiplier);
  }

  return multipliers;
}

export function estimateNetworkRidership(
  lines: TransitLine[],
  zones: SimulationZone[],
  assumptions: SimulationAssumptions,
  options: RidershipOptions = {}
): NetworkRidership {
  const baseZones = options.baseZones ?? zones;
  const baseline = assignNetworkRidership(lines, zones, assumptions, new Map(), baseZones);
  if (options.applyCrowding === false || lines.length === 0) {
    return baseline;
  }

  const multipliers = crowdingMultipliers(lines, baseline, assumptions);
  if (Array.from(multipliers.values()).every((multiplier) => multiplier === 1)) {
    return baseline;
  }

  return assignNetworkRidership(lines, zones, assumptions, multipliers, baseZones);
}
