import {
  area,
  bbox,
  buffer,
  featureCollection,
  intersect,
  point,
  union
} from '@turf/turf';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import type { CatchmentStats, SimulationAssumptions, SimulationZone, Station, TransitLine } from '../types';
import { clamp, distanceMiles } from './geo';

type AreaFeature = Feature<Polygon | MultiPolygon>;

interface ZoneAreaData {
  feature: AreaFeature;
  squareMeters: number;
  bounds: number[];
}

const zoneAreaCache = new WeakMap<object, ZoneAreaData | null>();

const COVERAGE_CACHE_LIMIT = 50_000;
const coverageCache = new Map<string, number>();

function cacheCoverage(key: string, fraction: number): number {
  if (coverageCache.size >= COVERAGE_CACHE_LIMIT) {
    coverageCache.clear();
  }
  coverageCache.set(key, fraction);
  return fraction;
}

function zoneAreaData(zone: SimulationZone): ZoneAreaData | undefined {
  const geometryKey = zone.geometry ?? zone.polygon;
  const cached = zoneAreaCache.get(geometryKey);
  if (cached !== undefined) {
    return cached ?? undefined;
  }

  try {
    let feature: AreaFeature | undefined;
    if (zone.geometry) {
      feature = {
        type: 'Feature',
        properties: {},
        geometry: zone.geometry
      };
    } else if (zone.polygon.length >= 3) {
      const ring = [...zone.polygon];
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        ring.push(first);
      }
      feature = {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [ring] }
      };
    }
    if (!feature) {
      zoneAreaCache.set(geometryKey, null);
      return undefined;
    }
    const squareMeters = area(feature);
    if (!Number.isFinite(squareMeters) || squareMeters <= 0) {
      zoneAreaCache.set(geometryKey, null);
      return undefined;
    }
    const result = { feature, squareMeters, bounds: bbox(feature) };
    zoneAreaCache.set(geometryKey, result);
    return result;
  } catch {
    zoneAreaCache.set(geometryKey, null);
    return undefined;
  }
}

function boundsOverlap(a: number[], b: number[]): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function catchmentArea(coordinate: [number, number], radiusMiles: number): AreaFeature {
  return buffer(point(coordinate), radiusMiles, { units: 'miles', steps: 32 }) as AreaFeature;
}

function coverageFraction(
  zone: SimulationZone,
  catchment: AreaFeature,
  catchmentBounds: number[],
  catchmentSignature: string,
  fallbackCoordinates: [number, number][],
  fallbackRadiusMiles: number
): number {
  const cacheKey = `${zone.id}|${catchmentSignature}`;
  const cached = coverageCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const data = zoneAreaData(zone);
  if (!data) {
    return cacheCoverage(
      cacheKey,
      fallbackCoordinates.some(
        (coordinate) => distanceMiles(coordinate, zone.centroid) <= fallbackRadiusMiles
      ) ? 1 : 0
    );
  }
  if (!boundsOverlap(data.bounds, catchmentBounds)) {
    return cacheCoverage(cacheKey, 0);
  }
  try {
    const overlap = intersect(featureCollection([data.feature, catchment]));
    return cacheCoverage(cacheKey, overlap ? clamp(area(overlap) / data.squareMeters, 0, 1) : 0);
  } catch {
    return cacheCoverage(
      cacheKey,
      fallbackCoordinates.some(
        (coordinate) => distanceMiles(coordinate, zone.centroid) <= fallbackRadiusMiles
      ) ? 1 : 0
    );
  }
}

function bufferSignature(coordinates: [number, number][], radiusMiles: number): string {
  return `${radiusMiles}|${coordinates.map(([lon, lat]) => `${lon},${lat}`).join(';')}`;
}

export function calculateStationCatchment(
  station: Station,
  zones: SimulationZone[],
  assumptions: SimulationAssumptions
): CatchmentStats {
  const stats: CatchmentStats = {
    populationHalfMile: 0,
    jobsHalfMile: 0,
    populationOneMile: 0,
    jobsOneMile: 0,
    zoneIdsHalfMile: [],
    zoneIdsOneMile: [],
    zoneWeightsHalfMile: {},
    zoneWeightsOneMile: {}
  };

  const halfMileArea = catchmentArea(station.coordinate, assumptions.walkCatchmentMiles);
  const oneMileArea = catchmentArea(station.coordinate, assumptions.extendedCatchmentMiles);
  const halfMileBounds = bbox(halfMileArea);
  const oneMileBounds = bbox(oneMileArea);
  const halfMileSignature = bufferSignature([station.coordinate], assumptions.walkCatchmentMiles);
  const oneMileSignature = bufferSignature([station.coordinate], assumptions.extendedCatchmentMiles);

  for (const zone of zones) {
    const oneMileWeight = coverageFraction(
      zone,
      oneMileArea,
      oneMileBounds,
      oneMileSignature,
      [station.coordinate],
      assumptions.extendedCatchmentMiles
    );
    if (oneMileWeight > 0) {
      stats.populationOneMile += zone.population * oneMileWeight;
      stats.jobsOneMile += zone.jobs * oneMileWeight;
      stats.zoneIdsOneMile.push(zone.id);
      stats.zoneWeightsOneMile[zone.id] = oneMileWeight;
    }
    const halfMileWeight = coverageFraction(
      zone,
      halfMileArea,
      halfMileBounds,
      halfMileSignature,
      [station.coordinate],
      assumptions.walkCatchmentMiles
    );
    if (halfMileWeight > 0) {
      stats.populationHalfMile += zone.population * halfMileWeight;
      stats.jobsHalfMile += zone.jobs * halfMileWeight;
      stats.zoneIdsHalfMile.push(zone.id);
      stats.zoneWeightsHalfMile[zone.id] = halfMileWeight;
    }
  }

  return stats;
}

export function calculateSystemCatchment(
  lines: TransitLine[],
  zones: SimulationZone[],
  assumptions: SimulationAssumptions
): { population: number; jobs: number; zoneIds: string[] } {
  const stationCoordinates = lines.flatMap((line) => line.stations.map((station) => station.coordinate));
  if (stationCoordinates.length === 0) {
    return { population: 0, jobs: 0, zoneIds: [] };
  }
  const stationAreas = stationCoordinates.map((coordinate) =>
    catchmentArea(coordinate, assumptions.walkCatchmentMiles)
  );
  const systemArea = stationAreas.length === 1
    ? stationAreas[0]
    : union(featureCollection(stationAreas)) as AreaFeature;
  const systemBounds = bbox(systemArea);
  const systemSignature = bufferSignature(stationCoordinates, assumptions.walkCatchmentMiles);
  const zoneIds: string[] = [];
  let population = 0;
  let jobs = 0;

  for (const zone of zones) {
    const weight = coverageFraction(
      zone,
      systemArea,
      systemBounds,
      systemSignature,
      stationCoordinates,
      assumptions.walkCatchmentMiles
    );
    if (weight > 0) {
      zoneIds.push(zone.id);
      population += zone.population * weight;
      jobs += zone.jobs * weight;
    }
  }

  return { population, jobs, zoneIds };
}

export function stationDevelopmentPotential(
  station: Station,
  zones: SimulationZone[],
  assumptions: SimulationAssumptions,
  catchment = calculateStationCatchment(station, zones, assumptions)
): number {
  const nearbyZones = zones.filter((zone) => (catchment.zoneWeightsOneMile[zone.id] ?? 0) > 0);
  if (nearbyZones.length === 0) {
    return 0;
  }

  const weightedCapacity = nearbyZones.reduce((sum, zone) => {
    const activity = zone.population + zone.jobs;
    const coverage = catchment.zoneWeightsOneMile[zone.id] ?? 0;
    return sum + zone.developmentCapacity * Math.log1p(activity) * coverage;
  }, 0);
  const totalCoverage = nearbyZones.reduce(
    (sum, zone) => sum + (catchment.zoneWeightsOneMile[zone.id] ?? 0),
    0
  );

  return totalCoverage > 0 ? weightedCapacity / totalCoverage : 0;
}
