export type Coordinate = [number, number];

export type TransitTechnologyId = 'brt' | 'light-rail' | 'elevated-metro' | 'subway';

export type FrequencyMinutes = 5 | 10 | 15 | 20 | 30;

export type AppMode = 'inspect' | 'build';

export type BuildTool = 'draw-line' | 'place-station';

export type OverlayKey =
  | 'population'
  | 'employment'
  | 'density'
  | 'accessibility'
  | 'ridership'
  | 'development'
  | 'landValue'
  | 'catchments';

export interface TransitTechnology {
  id: TransitTechnologyId;
  name: string;
  capitalCostPerMile: number;
  stationCost: number;
  averageSpeedMph: number;
  dwellMinutesPerStop: number;
  vehicleCapacity: number;
  baseOperatingCostPer15Miles: number;
  color: string;
}

export interface Station {
  id: string;
  lineId: string;
  name: string;
  coordinate: Coordinate;
  order: number;
}

export interface TransitLine {
  id: string;
  name: string;
  technology: TransitTechnologyId;
  color: string;
  headwayMinutes: FrequencyMinutes;
  geometry: Coordinate[];
  stations: Station[];
}

export interface SimulationZone {
  id: string;
  name: string;
  centroid: Coordinate;
  polygon: Coordinate[];
  geometry?: ZoneGeometry;
  population: number;
  households: number;
  jobs: number;
  density: number;
  carOwnership?: number;
  medianIncome?: number;
  housingUnits?: number;
  commercialSqFt?: number;
  areaSqMiles?: number;
  countyName?: string;
  tract?: string;
  blockGroup?: string;
  landValueIndex: number;
  developmentCapacity: number;
}

export type ZoneGeometry =
  | {
      type: 'Polygon';
      coordinates: Coordinate[][];
    }
  | {
      type: 'MultiPolygon';
      coordinates: Coordinate[][][];
    };

export interface CatchmentStats {
  populationHalfMile: number;
  jobsHalfMile: number;
  populationOneMile: number;
  jobsOneMile: number;
  zoneIdsHalfMile: string[];
  zoneIdsOneMile: string[];
}

export interface SimulationAssumptions {
  technologies: Record<TransitTechnologyId, TransitTechnology>;
  walkCatchmentMiles: number;
  extendedCatchmentMiles: number;
  transferDistanceFeet: number;
  transferPenaltyMinutes: number;
  walkSpeedMph: number;
  defaultFare: number;
  valueOfTimeDollarsPerHour: number;
  carCostPerMile: number;
  capitalBudget: number;
  annualOperatingBudget: number;
  capitalAssetLifeYears: number;
  capitalDiscountRate: number;
  totalDailyRegionalTrips: number;
  gravityDistanceExponent: number;
  minimumGravityDistanceMiles: number;
  carAverageSpeedMph: number;
  roadCircuityFactor: number;
  congestionPenaltyMinutes: number;
  parkingPenaltyMinutes: number;
  carEmploymentNormalizationJobs: number;
  carDensityNormalization: number;
  modeChoiceBeta: number;
  maxTransitModeShare: number;
  transitSpecificConstantMinutes: number;
  pathChoiceBeta: number;
  pathChoiceMaximumExtraMinutes: number;
  accessibilityMidpointMinutes: number;
  accessibilityDecayBeta: number;
  annualizationFactor: number;
  vehicleTripsRemovedPerTransitTrip: number;
  co2KgPerVehicleTrip: number;
  baseHeadwayMinutes: FrequencyMinutes;
  peakHourRidershipShare: number;
  crowdingThreshold: number;
  crowdingTimePenaltyFactor: number;
  developmentGrowthRatePerFiveYears: number;
  developmentAccessibilityWeight: number;
  developmentTransitSuccessWeight: number;
  developmentDowntownWeight: number;
  developmentJobsGrowthFactor: number;
  commercialSqFtPerJob: number;
  averageHouseholdSize: number;
  roadSnapDistanceFeet: number;
  specialGeneratorRadiusMiles: number;
  specialGeneratorDemandBonus: number;
  downtownCoordinate: Coordinate;
  airportCoordinate: Coordinate;
  uwfCoordinate: Coordinate;
}

export interface Scenario {
  id: string;
  name: string;
  lines: TransitLine[];
  assumptions: SimulationAssumptions;
  simulationYear: number;
  budgetLimitsEnabled: boolean;
  results?: SimulationResults;
}

export interface LineResults {
  lineId: string;
  lineName: string;
  technology: TransitTechnologyId;
  mileage: number;
  stationCount: number;
  constructionCost: number;
  operatingCost: number;
  weekdayRidership: number;
  ridersPerMile: number;
}

export interface StationResults {
  stationId: string;
  lineId: string;
  stationName: string;
  entries: number;
  exits: number;
  transfers: number;
  nearbyPopulation: number;
  nearbyJobs: number;
  catchment: CatchmentStats;
  developmentPotential: number;
}

export interface ZoneResults {
  zoneId: string;
  accessibilityScore: number;
  transitTrips: number;
  developmentPressure: number;
  populationGrowth: number;
  jobsGrowth: number;
  housingGrowth: number;
  landValueGrowth: number;
  developmentCapacityUsed: number;
}

export interface SimulationMessage {
  id: string;
  title: string;
  body: string;
}

export interface SimulationResults {
  baseDailyRegionalTrips: number;
  modeledDailyRegionalTrips: number;
  constructionCost: number;
  annualizedCapitalCost: number;
  annualOperatingCost: number;
  dailyRidership: number;
  annualRidership: number;
  costPerDailyRider: number;
  annualizedCostPerRider: number;
  fareRevenue: number;
  operatingSubsidy: number;
  averageRiderTravelTimeSavings: number;
  vehicleTripsRemoved: number;
  co2ReductionKg: number;
  populationWithinWalkingDistance: number;
  jobsWithinWalkingDistance: number;
  lineResults: LineResults[];
  stationResults: StationResults[];
  zoneResults: ZoneResults[];
  messages: SimulationMessage[];
  generatedAt: string;
}
