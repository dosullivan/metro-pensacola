import { lineString, nearestPointOnLine } from '@turf/turf';
import type { Coordinate } from '../types';
import { distanceMiles } from './geo';

export type CorridorGeometry =
  | {
      type: 'LineString';
      coordinates: Coordinate[];
    }
  | {
      type: 'MultiLineString';
      coordinates: Coordinate[][];
    };

export interface CorridorFeature {
  type: 'Feature';
  properties?: {
    name?: string;
    highway?: string;
    railway?: string;
    public_transport?: string;
    [key: string]: unknown;
  } | null;
  geometry: CorridorGeometry;
}

export interface CorridorCollection {
  type: 'FeatureCollection';
  features: CorridorFeature[];
}

export interface SnapResult {
  coordinate: Coordinate;
  snapped: boolean;
  distanceFeet: number;
  corridorName?: string;
}

export interface LineGeometrySnapResult extends SnapResult {
  segmentStartIndex?: number;
  segmentEndIndex?: number;
  fraction?: number;
}

interface RoadNetworkEdge {
  to: number;
  distanceMiles: number;
}

interface RoadNetworkSegment {
  startNodeIndex: number;
  endNodeIndex: number;
  distanceMiles: number;
}

export interface RoadNetwork {
  nodes: Coordinate[];
  edges: Map<number, RoadNetworkEdge[]>;
  segments: RoadNetworkSegment[];
}

export interface RoadNetworkSnapResult extends SnapResult {
  segmentIndex?: number;
  startNodeIndex?: number;
  endNodeIndex?: number;
  fraction?: number;
}

function featureSegments(feature: CorridorFeature): Coordinate[][] {
  if (feature.geometry.type === 'LineString') {
    return [feature.geometry.coordinates];
  }
  return feature.geometry.coordinates;
}

function segmentCouldBeNearCoordinate(
  segment: Coordinate[],
  coordinate: Coordinate,
  maxDistanceFeet: number
): boolean {
  const latitude = coordinate[1];
  const latitudeDegrees = maxDistanceFeet / 364_000;
  const longitudeDegrees = maxDistanceFeet / (364_000 * Math.max(Math.cos((latitude * Math.PI) / 180), 0.25));
  let minLon = Number.POSITIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;

  for (const point of segment) {
    minLon = Math.min(minLon, point[0]);
    minLat = Math.min(minLat, point[1]);
    maxLon = Math.max(maxLon, point[0]);
    maxLat = Math.max(maxLat, point[1]);
  }

  return (
    coordinate[0] >= minLon - longitudeDegrees &&
    coordinate[0] <= maxLon + longitudeDegrees &&
    coordinate[1] >= minLat - latitudeDegrees &&
    coordinate[1] <= maxLat + latitudeDegrees
  );
}

export function snapCoordinateToRoadCorridors(
  coordinate: Coordinate,
  corridors: CorridorCollection | undefined,
  maxDistanceFeet: number
): SnapResult {
  if (!corridors || maxDistanceFeet <= 0) {
    return { coordinate, snapped: false, distanceFeet: Number.POSITIVE_INFINITY };
  }

  let best: SnapResult | undefined;

  for (const feature of corridors.features) {
    if (!feature.properties?.highway) {
      continue;
    }

    for (const segment of featureSegments(feature)) {
      if (segment.length < 2) {
        continue;
      }
      if (!segmentCouldBeNearCoordinate(segment, coordinate, maxDistanceFeet)) {
        continue;
      }
      const snappedPoint = nearestPointOnLine(lineString(segment), coordinate, { units: 'miles' });
      const snappedCoordinate = snappedPoint.geometry.coordinates as Coordinate;
      const distanceFeet = distanceMiles(coordinate, snappedCoordinate) * 5280;
      if (!best || distanceFeet < best.distanceFeet) {
        best = {
          coordinate: snappedCoordinate,
          snapped: distanceFeet <= maxDistanceFeet,
          distanceFeet,
          corridorName: feature.properties.name
        };
      }
    }
  }

  if (!best || best.distanceFeet > maxDistanceFeet) {
    return { coordinate, snapped: false, distanceFeet: best?.distanceFeet ?? Number.POSITIVE_INFINITY };
  }

  return best;
}

export function snapCoordinateToLineGeometry(
  coordinate: Coordinate,
  geometry: Coordinate[]
): LineGeometrySnapResult {
  if (geometry.length === 0) {
    return { coordinate, snapped: false, distanceFeet: Number.POSITIVE_INFINITY };
  }

  if (geometry.length === 1) {
    const distanceFeet = distanceMiles(coordinate, geometry[0]) * 5280;
    return {
      coordinate: geometry[0],
      snapped: true,
      distanceFeet
    };
  }

  return nearestCoordinateOnLineSegments(coordinate, geometry);
}

function pointToFeet(
  point: Coordinate,
  origin: Coordinate,
  longitudeFeetPerDegree: number
): [number, number] {
  return [
    (point[0] - origin[0]) * longitudeFeetPerDegree,
    (point[1] - origin[1]) * 364_000
  ];
}

function feetToCoordinate(
  point: [number, number],
  origin: Coordinate,
  longitudeFeetPerDegree: number
): Coordinate {
  return [
    origin[0] + point[0] / longitudeFeetPerDegree,
    origin[1] + point[1] / 364_000
  ];
}

function nearestCoordinateOnLineSegments(
  coordinate: Coordinate,
  geometry: Coordinate[]
): LineGeometrySnapResult {
  const latitude = coordinate[1];
  const longitudeFeetPerDegree = 364_000 * Math.max(Math.cos((latitude * Math.PI) / 180), 0.25);
  const originFeet = pointToFeet(coordinate, coordinate, longitudeFeetPerDegree);
  let best: LineGeometrySnapResult | undefined;

  for (let index = 0; index < geometry.length - 1; index += 1) {
    const start = pointToFeet(geometry[index], coordinate, longitudeFeetPerDegree);
    const end = pointToFeet(geometry[index + 1], coordinate, longitudeFeetPerDegree);
    const segmentX = end[0] - start[0];
    const segmentY = end[1] - start[1];
    const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;
    const rawFraction =
      segmentLengthSquared === 0
        ? 0
        : ((originFeet[0] - start[0]) * segmentX + (originFeet[1] - start[1]) * segmentY) /
          segmentLengthSquared;
    const fraction = Math.min(Math.max(rawFraction, 0), 1);
    const projectedFeet: [number, number] = [
      start[0] + segmentX * fraction,
      start[1] + segmentY * fraction
    ];
    const distanceFeet = Math.hypot(originFeet[0] - projectedFeet[0], originFeet[1] - projectedFeet[1]);

    if (!best || distanceFeet < best.distanceFeet) {
      best = {
        coordinate: feetToCoordinate(projectedFeet, coordinate, longitudeFeetPerDegree),
        snapped: true,
        distanceFeet,
        segmentStartIndex: index,
        segmentEndIndex: index + 1,
        fraction
      };
    }
  }

  if (best) {
    return best;
  }

  const snappedPoint = nearestPointOnLine(lineString(geometry), coordinate, { units: 'miles' });
  const snappedCoordinate = snappedPoint.geometry.coordinates as Coordinate;
  return {
    coordinate: snappedCoordinate,
    snapped: true,
    distanceFeet: distanceMiles(coordinate, snappedCoordinate) * 5280
  };
}

function coordinateKey(coordinate: Coordinate): string {
  return `${coordinate[0].toFixed(6)},${coordinate[1].toFixed(6)}`;
}

function addRoadEdge(edges: Map<number, RoadNetworkEdge[]>, from: number, edge: RoadNetworkEdge) {
  const existingEdges = edges.get(from) ?? [];
  existingEdges.push(edge);
  edges.set(from, existingEdges);
}

export function buildRoadNetwork(corridors: CorridorCollection | undefined): RoadNetwork | undefined {
  if (!corridors) {
    return undefined;
  }

  const nodes: Coordinate[] = [];
  const nodeIndexes = new Map<string, number>();
  const edges = new Map<number, RoadNetworkEdge[]>();
  const segments: RoadNetworkSegment[] = [];

  function nodeIndex(coordinate: Coordinate): number {
    const key = coordinateKey(coordinate);
    const existingIndex = nodeIndexes.get(key);
    if (existingIndex !== undefined) {
      return existingIndex;
    }
    const index = nodes.length;
    nodes.push(coordinate);
    nodeIndexes.set(key, index);
    return index;
  }

  for (const feature of corridors.features) {
    if (!feature.properties?.highway) {
      continue;
    }

    for (const segment of featureSegments(feature)) {
      for (let index = 0; index < segment.length - 1; index += 1) {
        const start = segment[index];
        const end = segment[index + 1];
        const segmentMiles = distanceMiles(start, end);
        if (segmentMiles <= 0) {
          continue;
        }
        const startNodeIndex = nodeIndex(start);
        const endNodeIndex = nodeIndex(end);
        addRoadEdge(edges, startNodeIndex, { to: endNodeIndex, distanceMiles: segmentMiles });
        addRoadEdge(edges, endNodeIndex, { to: startNodeIndex, distanceMiles: segmentMiles });
        segments.push({ startNodeIndex, endNodeIndex, distanceMiles: segmentMiles });
      }
    }
  }

  return nodes.length > 0 ? { nodes, edges, segments } : undefined;
}

function projectCoordinateToSegment(
  coordinate: Coordinate,
  start: Coordinate,
  end: Coordinate
): { coordinate: Coordinate; distanceFeet: number; fraction: number } {
  const latitude = coordinate[1];
  const longitudeFeetPerDegree = 364_000 * Math.max(Math.cos((latitude * Math.PI) / 180), 0.25);
  const originFeet = pointToFeet(coordinate, coordinate, longitudeFeetPerDegree);
  const startFeet = pointToFeet(start, coordinate, longitudeFeetPerDegree);
  const endFeet = pointToFeet(end, coordinate, longitudeFeetPerDegree);
  const segmentX = endFeet[0] - startFeet[0];
  const segmentY = endFeet[1] - startFeet[1];
  const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;
  const rawFraction =
    segmentLengthSquared === 0
      ? 0
      : ((originFeet[0] - startFeet[0]) * segmentX + (originFeet[1] - startFeet[1]) * segmentY) /
        segmentLengthSquared;
  const fraction = Math.min(Math.max(rawFraction, 0), 1);
  const projectedFeet: [number, number] = [
    startFeet[0] + segmentX * fraction,
    startFeet[1] + segmentY * fraction
  ];

  return {
    coordinate: feetToCoordinate(projectedFeet, coordinate, longitudeFeetPerDegree),
    distanceFeet: Math.hypot(originFeet[0] - projectedFeet[0], originFeet[1] - projectedFeet[1]),
    fraction
  };
}

export function snapCoordinateToRoadNetwork(
  coordinate: Coordinate,
  network: RoadNetwork | undefined,
  maxDistanceFeet: number
): RoadNetworkSnapResult {
  if (!network || maxDistanceFeet <= 0) {
    return { coordinate, snapped: false, distanceFeet: Number.POSITIVE_INFINITY };
  }

  let best: RoadNetworkSnapResult | undefined;

  network.segments.forEach((segment, segmentIndex) => {
    const start = network.nodes[segment.startNodeIndex];
    const end = network.nodes[segment.endNodeIndex];
    if (!segmentCouldBeNearCoordinate([start, end], coordinate, maxDistanceFeet)) {
      return;
    }

    const projected = projectCoordinateToSegment(coordinate, start, end);
    if (!best || projected.distanceFeet < best.distanceFeet) {
      best = {
        coordinate: projected.coordinate,
        snapped: projected.distanceFeet <= maxDistanceFeet,
        distanceFeet: projected.distanceFeet,
        segmentIndex,
        startNodeIndex: segment.startNodeIndex,
        endNodeIndex: segment.endNodeIndex,
        fraction: projected.fraction
      };
    }
  });

  if (!best || best.distanceFeet > maxDistanceFeet) {
    return { coordinate, snapped: false, distanceFeet: best?.distanceFeet ?? Number.POSITIVE_INFINITY };
  }

  return best;
}

class MinHeap {
  private readonly values: Array<{ node: number; distance: number }> = [];

  get size(): number {
    return this.values.length;
  }

  push(value: { node: number; distance: number }) {
    this.values.push(value);
    this.bubbleUp(this.values.length - 1);
  }

  pop(): { node: number; distance: number } | undefined {
    const first = this.values[0];
    const last = this.values.pop();
    if (!first || !last) {
      return first;
    }
    if (this.values.length > 0) {
      this.values[0] = last;
      this.sinkDown(0);
    }
    return first;
  }

  private bubbleUp(index: number) {
    let currentIndex = index;
    while (currentIndex > 0) {
      const parentIndex = Math.floor((currentIndex - 1) / 2);
      if (this.values[parentIndex].distance <= this.values[currentIndex].distance) {
        break;
      }
      [this.values[parentIndex], this.values[currentIndex]] = [this.values[currentIndex], this.values[parentIndex]];
      currentIndex = parentIndex;
    }
  }

  private sinkDown(index: number) {
    let currentIndex = index;
    while (true) {
      const leftIndex = currentIndex * 2 + 1;
      const rightIndex = currentIndex * 2 + 2;
      let smallestIndex = currentIndex;

      if (
        leftIndex < this.values.length &&
        this.values[leftIndex].distance < this.values[smallestIndex].distance
      ) {
        smallestIndex = leftIndex;
      }
      if (
        rightIndex < this.values.length &&
        this.values[rightIndex].distance < this.values[smallestIndex].distance
      ) {
        smallestIndex = rightIndex;
      }
      if (smallestIndex === currentIndex) {
        break;
      }
      [this.values[currentIndex], this.values[smallestIndex]] = [this.values[smallestIndex], this.values[currentIndex]];
      currentIndex = smallestIndex;
    }
  }
}

function snapConnections(snap: RoadNetworkSnapResult, network: RoadNetwork): RoadNetworkEdge[] {
  if (
    snap.segmentIndex === undefined ||
    snap.startNodeIndex === undefined ||
    snap.endNodeIndex === undefined ||
    snap.fraction === undefined
  ) {
    return [];
  }

  const segment = network.segments[snap.segmentIndex];
  return [
    {
      to: snap.startNodeIndex,
      distanceMiles: segment.distanceMiles * snap.fraction
    },
    {
      to: snap.endNodeIndex,
      distanceMiles: segment.distanceMiles * (1 - snap.fraction)
    }
  ];
}

function compactCoordinates(coordinates: Coordinate[]): Coordinate[] {
  return coordinates.filter((coordinate, index) => {
    const previous = coordinates[index - 1];
    return !previous || coordinate[0] !== previous[0] || coordinate[1] !== previous[1];
  });
}

export function roadPathBetweenCoordinates(
  start: Coordinate,
  end: Coordinate,
  network: RoadNetwork | undefined,
  maxDistanceFeet: number
): Coordinate[] | undefined {
  if (!network) {
    return undefined;
  }
  const roadNetwork = network;

  const startSnap = snapCoordinateToRoadNetwork(start, roadNetwork, maxDistanceFeet);
  const endSnap = snapCoordinateToRoadNetwork(end, roadNetwork, maxDistanceFeet);
  if (!startSnap.snapped || !endSnap.snapped) {
    return undefined;
  }

  if (startSnap.segmentIndex !== undefined && startSnap.segmentIndex === endSnap.segmentIndex) {
    return compactCoordinates([startSnap.coordinate, endSnap.coordinate]);
  }

  const startNode = -1;
  const endNode = -2;
  const distances = new Map<number, number>([[startNode, 0]]);
  const previous = new Map<number, number>();
  const heap = new MinHeap();
  const endConnections = snapConnections(endSnap, roadNetwork);
  const endConnectionByNode = new Map(endConnections.map((edge) => [edge.to, edge.distanceMiles]));

  heap.push({ node: startNode, distance: 0 });

  function edgesForNode(node: number): RoadNetworkEdge[] {
    if (node === startNode) {
      return snapConnections(startSnap, roadNetwork);
    }
    const graphEdges = roadNetwork.edges.get(node) ?? [];
    const endConnectionDistance = endConnectionByNode.get(node);
    return endConnectionDistance === undefined
      ? graphEdges
      : [...graphEdges, { to: endNode, distanceMiles: endConnectionDistance }];
  }

  while (heap.size > 0) {
    const current = heap.pop();
    if (!current) {
      break;
    }
    if (current.distance > (distances.get(current.node) ?? Number.POSITIVE_INFINITY)) {
      continue;
    }
    if (current.node === endNode) {
      break;
    }

    for (const edge of edgesForNode(current.node)) {
      const nextDistance = current.distance + edge.distanceMiles;
      if (nextDistance < (distances.get(edge.to) ?? Number.POSITIVE_INFINITY)) {
        distances.set(edge.to, nextDistance);
        previous.set(edge.to, current.node);
        heap.push({ node: edge.to, distance: nextDistance });
      }
    }
  }

  if (!distances.has(endNode)) {
    return undefined;
  }

  const pathNodes: number[] = [];
  let currentNode = endNode;
  while (currentNode !== startNode) {
    pathNodes.push(currentNode);
    const previousNode = previous.get(currentNode);
    if (previousNode === undefined) {
      return undefined;
    }
    currentNode = previousNode;
  }
  pathNodes.push(startNode);
  pathNodes.reverse();

  return compactCoordinates(
    pathNodes.map((node) => {
      if (node === startNode) {
        return startSnap.coordinate;
      }
      if (node === endNode) {
        return endSnap.coordinate;
      }
      return roadNetwork.nodes[node];
    })
  );
}
