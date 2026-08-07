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
