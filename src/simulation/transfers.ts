import type { Coordinate, Station, TransitLine } from '../types';
import { distanceMiles } from './geo';

export interface TransferCandidate {
  lineId: string;
  lineName: string;
  stationId: string;
  stationName: string;
  coordinate: Coordinate;
  distanceFeet: number;
}

function transferCandidates(
  coordinate: Coordinate,
  lines: TransitLine[],
  currentLineId: string | undefined,
  maxDistanceFeet: number
): TransferCandidate[] {
  return lines.flatMap((line) => {
    if (line.id === currentLineId) {
      return [];
    }

    return line.stations
      .map((station) => ({
        lineId: line.id,
        lineName: line.name,
        stationId: station.id,
        stationName: station.name,
        coordinate: station.coordinate,
        distanceFeet: distanceMiles(coordinate, station.coordinate) * 5280
      }))
      .filter((candidate) => candidate.distanceFeet <= maxDistanceFeet);
  });
}

export function nearestTransferStation(
  coordinate: Coordinate,
  lines: TransitLine[],
  currentLineId: string | undefined,
  maxDistanceFeet: number
): TransferCandidate | undefined {
  return transferCandidates(coordinate, lines, currentLineId, maxDistanceFeet).sort(
    (a, b) => a.distanceFeet - b.distanceFeet
  )[0];
}

export function transferPartnersForStation(
  station: Station,
  lines: TransitLine[],
  maxDistanceFeet: number
): TransferCandidate[] {
  return transferCandidates(station.coordinate, lines, station.lineId, maxDistanceFeet).sort(
    (a, b) => a.distanceFeet - b.distanceFeet
  );
}
