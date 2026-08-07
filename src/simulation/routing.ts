import type { Coordinate, SimulationAssumptions, Station, TransitLine } from '../types';
import { averageWaitTime } from './costs';
import { distanceMiles, feetToMiles, minutesForDistance } from './geo';

interface GraphEdge {
  to: string;
  minutes: number;
  lineId?: string;
  transferStationId?: string;
}

interface PreviousStep {
  from: string;
  edge: GraphEdge;
}

interface CandidateStation {
  station: Station;
  accessMinutes: number;
}

export interface TransitPath {
  totalMinutes: number;
  accessMinutes: number;
  egressMinutes: number;
  originStationId: string;
  destinationStationId: string;
  stationIds: string[];
  lineIds: string[];
  transferStationIds: string[];
}

function baseNode(stationId: string): string {
  return `station:${stationId}`;
}

function lineNode(stationId: string, lineId: string): string {
  return `line:${lineId}:station:${stationId}`;
}

function stationIdFromBaseNode(node: string): string | undefined {
  return node.startsWith('station:') ? node.slice('station:'.length) : undefined;
}

function allStations(lines: TransitLine[]): Station[] {
  return lines.flatMap((line) => line.stations);
}

function candidateStations(
  coordinate: Coordinate,
  stations: Station[],
  assumptions: SimulationAssumptions
): CandidateStation[] {
  return stations
    .map((station) => {
      const distance = distanceMiles(coordinate, station.coordinate);
      return {
        station,
        accessMinutes: minutesForDistance(distance, assumptions.walkSpeedMph),
        distance
      };
    })
    .filter((candidate) => candidate.distance <= assumptions.extendedCatchmentMiles)
    .sort((a, b) => a.accessMinutes - b.accessMinutes)
    .slice(0, 6)
    .map(({ station, accessMinutes }) => ({ station, accessMinutes }));
}

export function buildTransitGraph(
  lines: TransitLine[],
  assumptions: SimulationAssumptions
): Map<string, GraphEdge[]> {
  const graph = new Map<string, GraphEdge[]>();
  const stations = allStations(lines);

  function addEdge(from: string, edge: GraphEdge) {
    const edges = graph.get(from) ?? [];
    edges.push(edge);
    graph.set(from, edges);
  }

  for (const station of stations) {
    graph.set(baseNode(station.id), graph.get(baseNode(station.id)) ?? []);
  }

  for (const line of lines) {
    const technology = assumptions.technologies[line.technology];
    const orderedStations = [...line.stations].sort((a, b) => a.order - b.order);

    for (const station of orderedStations) {
      addEdge(baseNode(station.id), {
        to: lineNode(station.id, line.id),
        minutes: averageWaitTime(line.headwayMinutes),
        lineId: line.id
      });
      addEdge(lineNode(station.id, line.id), {
        to: baseNode(station.id),
        minutes: 0
      });
    }

    for (let index = 0; index < orderedStations.length - 1; index += 1) {
      const from = orderedStations[index];
      const to = orderedStations[index + 1];
      const miles = distanceMiles(from.coordinate, to.coordinate) * assumptions.roadCircuityFactor;
      const minutes = minutesForDistance(miles, technology.averageSpeedMph);
      addEdge(lineNode(from.id, line.id), {
        to: lineNode(to.id, line.id),
        minutes,
        lineId: line.id
      });
      addEdge(lineNode(to.id, line.id), {
        to: lineNode(from.id, line.id),
        minutes,
        lineId: line.id
      });
    }
  }

  const transferMiles = feetToMiles(assumptions.transferDistanceFeet);
  for (let i = 0; i < stations.length; i += 1) {
    for (let j = i + 1; j < stations.length; j += 1) {
      const a = stations[i];
      const b = stations[j];
      if (a.lineId === b.lineId) {
        continue;
      }
      if (distanceMiles(a.coordinate, b.coordinate) <= transferMiles) {
        addEdge(baseNode(a.id), {
          to: baseNode(b.id),
          minutes: assumptions.transferPenaltyMinutes,
          transferStationId: a.id
        });
        addEdge(baseNode(b.id), {
          to: baseNode(a.id),
          minutes: assumptions.transferPenaltyMinutes,
          transferStationId: b.id
        });
      }
    }
  }

  return graph;
}

function dijkstra(
  graph: Map<string, GraphEdge[]>,
  starts: CandidateStation[]
): { distances: Map<string, number>; previous: Map<string, PreviousStep>; startForNode: Map<string, CandidateStation> } {
  const distances = new Map<string, number>();
  const previous = new Map<string, PreviousStep>();
  const startForNode = new Map<string, CandidateStation>();
  const unsettled = new Set<string>();

  for (const start of starts) {
    const node = baseNode(start.station.id);
    const current = distances.get(node);
    if (current === undefined || start.accessMinutes < current) {
      distances.set(node, start.accessMinutes);
      startForNode.set(node, start);
      unsettled.add(node);
    }
  }

  while (unsettled.size > 0) {
    let currentNode: string | undefined;
    let currentDistance = Number.POSITIVE_INFINITY;
    for (const node of unsettled) {
      const distanceToNode = distances.get(node) ?? Number.POSITIVE_INFINITY;
      if (distanceToNode < currentDistance) {
        currentDistance = distanceToNode;
        currentNode = node;
      }
    }

    if (!currentNode) {
      break;
    }

    unsettled.delete(currentNode);
    const edges = graph.get(currentNode) ?? [];
    for (const edge of edges) {
      const nextDistance = currentDistance + edge.minutes;
      const oldDistance = distances.get(edge.to) ?? Number.POSITIVE_INFINITY;
      if (nextDistance < oldDistance) {
        distances.set(edge.to, nextDistance);
        previous.set(edge.to, { from: currentNode, edge });
        startForNode.set(edge.to, startForNode.get(currentNode) as CandidateStation);
        unsettled.add(edge.to);
      }
    }
  }

  return { distances, previous, startForNode };
}

function reconstructPath(
  endNode: string,
  previous: Map<string, PreviousStep>
): { stationIds: string[]; lineIds: string[]; transferStationIds: string[] } {
  const nodes: string[] = [endNode];
  const edges: GraphEdge[] = [];
  let current = endNode;

  while (previous.has(current)) {
    const step = previous.get(current) as PreviousStep;
    edges.push(step.edge);
    current = step.from;
    nodes.push(current);
  }

  nodes.reverse();
  edges.reverse();

  const stationIds = Array.from(
    new Set(nodes.map(stationIdFromBaseNode).filter((stationId): stationId is string => Boolean(stationId)))
  );
  const lineIds = Array.from(new Set(edges.map((edge) => edge.lineId).filter((lineId): lineId is string => Boolean(lineId))));
  const transferStationIds = edges
    .map((edge) => edge.transferStationId)
    .filter((stationId): stationId is string => Boolean(stationId));

  return { stationIds, lineIds, transferStationIds };
}

export function fastestTransitPath(
  origin: Coordinate,
  destination: Coordinate,
  lines: TransitLine[],
  assumptions: SimulationAssumptions,
  graph = buildTransitGraph(lines, assumptions)
): TransitPath | undefined {
  const stations = allStations(lines);
  if (stations.length < 2) {
    return undefined;
  }

  const origins = candidateStations(origin, stations, assumptions);
  const destinations = candidateStations(destination, stations, assumptions);
  if (origins.length === 0 || destinations.length === 0) {
    return undefined;
  }

  const destinationByNode = new Map(destinations.map((candidate) => [baseNode(candidate.station.id), candidate]));
  const { distances, previous, startForNode } = dijkstra(graph, origins);

  let bestNode: string | undefined;
  let bestDestination: CandidateStation | undefined;
  let bestMinutes = Number.POSITIVE_INFINITY;

  for (const [node, destinationCandidate] of destinationByNode) {
    const baseMinutes = distances.get(node);
    if (baseMinutes === undefined) {
      continue;
    }
    const total = baseMinutes + destinationCandidate.accessMinutes;
    if (total < bestMinutes) {
      bestMinutes = total;
      bestNode = node;
      bestDestination = destinationCandidate;
    }
  }

  if (!bestNode || !bestDestination || !Number.isFinite(bestMinutes)) {
    return undefined;
  }

  const originCandidate = startForNode.get(bestNode);
  if (!originCandidate) {
    return undefined;
  }

  const reconstructed = reconstructPath(bestNode, previous);
  if (reconstructed.lineIds.length === 0) {
    return undefined;
  }

  return {
    totalMinutes: bestMinutes,
    accessMinutes: originCandidate.accessMinutes,
    egressMinutes: bestDestination.accessMinutes,
    originStationId: originCandidate.station.id,
    destinationStationId: bestDestination.station.id,
    ...reconstructed
  };
}
