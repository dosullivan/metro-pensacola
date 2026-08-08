import type { Coordinate, TransitLine } from '../types';
import { distanceMiles, lineMileage } from './geo';

export interface AnimatedVehiclePosition {
  coordinate: Coordinate;
  direction: 'outbound' | 'inbound';
}

const MAX_ANIMATED_VEHICLES_PER_LINE = 64;

export function coordinateAtDistance(
  geometry: Coordinate[],
  distanceAlongMiles: number
): Coordinate | undefined {
  if (geometry.length === 0) return undefined;
  if (geometry.length === 1) return geometry[0];

  const totalMiles = lineMileage(geometry);
  const targetMiles = Math.min(totalMiles, Math.max(0, distanceAlongMiles));
  let traversedMiles = 0;

  for (let index = 1; index < geometry.length; index += 1) {
    const start = geometry[index - 1];
    const end = geometry[index];
    const segmentMiles = distanceMiles(start, end);
    if (segmentMiles === 0) continue;
    if (traversedMiles + segmentMiles >= targetMiles) {
      const ratio = (targetMiles - traversedMiles) / segmentMiles;
      return [
        start[0] + (end[0] - start[0]) * ratio,
        start[1] + (end[1] - start[1]) * ratio
      ];
    }
    traversedMiles += segmentMiles;
  }

  return geometry[geometry.length - 1];
}

export function vehiclePositionsForLine(
  line: TransitLine,
  averageSpeedMph: number,
  elapsedSeconds: number
): AnimatedVehiclePosition[] {
  const routeMiles = lineMileage(line.geometry);
  if (routeMiles <= 0 || averageSpeedMph <= 0) return [];

  const cycleMiles = routeMiles * 2;
  const scheduledSpacingMiles = averageSpeedMph * line.headwayMinutes / 60;
  const vehicleCount = Math.min(
    MAX_ANIMATED_VEHICLES_PER_LINE,
    Math.max(1, Math.ceil(cycleMiles / Math.max(scheduledSpacingMiles, 0.01)))
  );
  const evenSpacingMiles = cycleMiles / vehicleCount;
  const traveledMiles = averageSpeedMph * Math.max(0, elapsedSeconds) / 3600;

  return Array.from({ length: vehicleCount }, (_, index) => {
    const cyclePosition = (traveledMiles + index * evenSpacingMiles) % cycleMiles;
    const outbound = cyclePosition <= routeMiles;
    const routePosition = outbound ? cyclePosition : cycleMiles - cyclePosition;
    return {
      coordinate: coordinateAtDistance(line.geometry, routePosition) as Coordinate,
      direction: outbound ? 'outbound' : 'inbound'
    };
  });
}
