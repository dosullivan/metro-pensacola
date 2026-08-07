import { distance, length, lineString, point } from '@turf/turf';
import type { Coordinate } from '../types';

export function distanceMiles(a: Coordinate, b: Coordinate): number {
  return distance(point(a), point(b), { units: 'miles' });
}

export function lineMileage(coordinates: Coordinate[]): number {
  if (coordinates.length < 2) {
    return 0;
  }
  return length(lineString(coordinates), { units: 'miles' });
}

export function feetToMiles(feet: number): number {
  return feet / 5280;
}

export function minutesForDistance(distanceInMiles: number, speedMph: number): number {
  if (speedMph <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return (distanceInMiles / speedMph) * 60;
}

export function round(value: number, digits = 0): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function makeId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}
