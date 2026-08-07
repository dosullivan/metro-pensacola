import type { Coordinate, SimulationZone } from '../../types';

interface ZoneSeed {
  id: string;
  name: string;
  centroid: Coordinate;
  population: number;
  jobs: number;
  landValueIndex: number;
  developmentCapacity: number;
  carOwnership: number;
  medianIncome: number;
}

const ZONE_SEEDS: ZoneSeed[] = [
  { id: 'downtown-core', name: 'Downtown Core', centroid: [-87.2155, 30.4122], population: 4400, jobs: 16800, landValueIndex: 1.28, developmentCapacity: 0.72, carOwnership: 0.86, medianIncome: 52000 },
  { id: 'seville-square', name: 'Seville Square', centroid: [-87.2075, 30.4104], population: 2600, jobs: 5100, landValueIndex: 1.34, developmentCapacity: 0.38, carOwnership: 0.9, medianIncome: 62000 },
  { id: 'north-hill', name: 'North Hill', centroid: [-87.2202, 30.4268], population: 5100, jobs: 4200, landValueIndex: 1.1, developmentCapacity: 0.32, carOwnership: 0.92, medianIncome: 57000 },
  { id: 'east-hill', name: 'East Hill', centroid: [-87.1952, 30.4326], population: 7600, jobs: 3600, landValueIndex: 1.18, developmentCapacity: 0.25, carOwnership: 0.91, medianIncome: 69000 },
  { id: 'bayview', name: 'Bayview', centroid: [-87.1797, 30.4514], population: 5200, jobs: 2400, landValueIndex: 1.16, developmentCapacity: 0.3, carOwnership: 0.93, medianIncome: 66000 },
  { id: 'brownsville', name: 'Brownsville', centroid: [-87.2515, 30.4286], population: 8600, jobs: 4300, landValueIndex: 0.76, developmentCapacity: 0.64, carOwnership: 0.89, medianIncome: 39000 },
  { id: 'warrington', name: 'Warrington', centroid: [-87.2767, 30.3837], population: 10600, jobs: 6200, landValueIndex: 0.84, developmentCapacity: 0.58, carOwnership: 0.93, medianIncome: 43000 },
  { id: 'nas-pensacola', name: 'NAS Pensacola', centroid: [-87.2998, 30.3526], population: 2400, jobs: 11900, landValueIndex: 0.92, developmentCapacity: 0.15, carOwnership: 0.95, medianIncome: 56000 },
  { id: 'myrtle-grove', name: 'Myrtle Grove', centroid: [-87.3071, 30.4216], population: 12900, jobs: 5200, landValueIndex: 0.78, developmentCapacity: 0.52, carOwnership: 0.96, medianIncome: 45000 },
  { id: 'west-pensacola', name: 'West Pensacola', centroid: [-87.2793, 30.4273], population: 11200, jobs: 5800, landValueIndex: 0.82, developmentCapacity: 0.61, carOwnership: 0.95, medianIncome: 47000 },
  { id: 'bellview', name: 'Bellview', centroid: [-87.3121, 30.4618], population: 14400, jobs: 5400, landValueIndex: 0.86, developmentCapacity: 0.65, carOwnership: 0.97, medianIncome: 51000 },
  { id: 'brent', name: 'Brent', centroid: [-87.2361, 30.4688], population: 11800, jobs: 9600, landValueIndex: 0.94, developmentCapacity: 0.66, carOwnership: 0.94, medianIncome: 48000 },
  { id: 'baptist-campus', name: 'Baptist Health Campus', centroid: [-87.2254, 30.4778], population: 3100, jobs: 9800, landValueIndex: 1.0, developmentCapacity: 0.55, carOwnership: 0.94, medianIncome: 52000 },
  { id: 'cordova-mall', name: 'Cordova Mall', centroid: [-87.2076, 30.4756], population: 4800, jobs: 14200, landValueIndex: 1.12, developmentCapacity: 0.5, carOwnership: 0.95, medianIncome: 61000 },
  { id: 'airport', name: 'Pensacola International Airport', centroid: [-87.1866, 30.4734], population: 1300, jobs: 7300, landValueIndex: 1.02, developmentCapacity: 0.36, carOwnership: 0.96, medianIncome: 56000 },
  { id: 'cordova-park', name: 'Cordova Park', centroid: [-87.1906, 30.4881], population: 9200, jobs: 4100, landValueIndex: 1.14, developmentCapacity: 0.28, carOwnership: 0.96, medianIncome: 69000 },
  { id: 'scenic-heights', name: 'Scenic Heights', centroid: [-87.1652, 30.4824], population: 8200, jobs: 3500, landValueIndex: 1.06, developmentCapacity: 0.32, carOwnership: 0.96, medianIncome: 60000 },
  { id: 'ferry-pass', name: 'Ferry Pass', centroid: [-87.2122, 30.5144], population: 17600, jobs: 8200, landValueIndex: 0.96, developmentCapacity: 0.7, carOwnership: 0.97, medianIncome: 52000 },
  { id: 'ensley', name: 'Ensley', centroid: [-87.2727, 30.5185], population: 23800, jobs: 9600, landValueIndex: 0.84, developmentCapacity: 0.75, carOwnership: 0.97, medianIncome: 48000 },
  { id: 'olive', name: 'Olive Road', centroid: [-87.241, 30.514], population: 10800, jobs: 6400, landValueIndex: 0.9, developmentCapacity: 0.69, carOwnership: 0.97, medianIncome: 51000 },
  { id: 'uwf', name: 'University of West Florida', centroid: [-87.2181, 30.5495], population: 7200, jobs: 8900, landValueIndex: 0.98, developmentCapacity: 0.48, carOwnership: 0.91, medianIncome: 46000 },
  { id: 'nine-mile', name: 'Nine Mile Road', centroid: [-87.1866, 30.5342], population: 10800, jobs: 7200, landValueIndex: 0.98, developmentCapacity: 0.73, carOwnership: 0.97, medianIncome: 56000 },
  { id: 'pace-edge', name: 'Pace Edge', centroid: [-87.1352, 30.5811], population: 9200, jobs: 3400, landValueIndex: 0.9, developmentCapacity: 0.78, carOwnership: 0.98, medianIncome: 64000 },
  { id: 'gulf-breeze', name: 'Gulf Breeze', centroid: [-87.1769, 30.3685], population: 6500, jobs: 4200, landValueIndex: 1.32, developmentCapacity: 0.25, carOwnership: 0.97, medianIncome: 81000 }
];

function hexagon(center: Coordinate, radiusLon = 0.014, radiusLat = 0.011): Coordinate[] {
  const points: Coordinate[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 3) * i + Math.PI / 6;
    points.push([center[0] + Math.cos(angle) * radiusLon, center[1] + Math.sin(angle) * radiusLat]);
  }
  points.push(points[0]);
  return points;
}

export const PENSACOLA_ZONES: SimulationZone[] = ZONE_SEEDS.map((zone) => {
  const households = Math.round(zone.population / 2.28);
  return {
    ...zone,
    polygon: hexagon(zone.centroid),
    households,
    density: Math.round(zone.population / 2.8),
    housingUnits: Math.round(households * 1.1),
    commercialSqFt: Math.round(zone.jobs * 340)
  };
});
