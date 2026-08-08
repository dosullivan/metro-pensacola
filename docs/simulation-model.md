# Simulation Model

Metro Pensacola uses a deterministic aggregate model designed for gameplay and transparency. It is plausible enough to compare scenarios, but it is not an engineering estimate or a travel-demand forecast.

## Real Data vs Assumptions

Real sourced data:

- OpenStreetMap raster tiles provide the visible basemap.
- Demo station coordinates are approximate anchors for real Pensacola places.
- Simulation zones use TIGERweb ACS 2024 block-group geometry.
- Population, households, housing units, median household income, and vehicle availability use ACS 2024 5-year detailed tables.
- Workplace jobs use LEHD/LODES8 2023 WAC all-jobs counts aggregated from blocks to block groups.

Synthetic or gameplay assumptions:

- Transit capital costs, operating costs, speeds, transfer penalties, fares, and demand coefficients in `src/data/assumptions.ts`.
- Land value index, commercial square feet, and development capacity in `src/data/pensacola/zones.ts`.
- Development response rules.

## Costs

Line mileage is calculated geodesically with Turf.js:

```text
mileage = length(route polyline in miles)
```

Construction cost:

```text
capitalCost =
  mileage * technology.capitalCostPerMile
  + stationCount * technology.stationCost
```

Annual operating cost:

```text
operatingCost =
  technology.baseOperatingCostPer15Miles
  * (mileage / 15)
  * (baseHeadwayMinutes / selectedHeadwayMinutes)
```

The base headway is 15 minutes. A 5-minute service costs about 3x the base frequency; a 30-minute service costs about 0.5x.

Capital cost is converted to an equivalent annual amount with the configured asset life and discount rate:

```text
capitalRecoveryFactor =
  discountRate * (1 + discountRate)^assetLifeYears
  / ((1 + discountRate)^assetLifeYears - 1)

annualizedCapitalCost =
  capitalCost * capitalRecoveryFactor
```

At a zero discount rate, the recovery factor is `1 / assetLifeYears`.

## Catchments

Each station has two catchment bands:

```text
normal walking catchment = 0.5 miles
extended catchment = 1.0 mile
```

For zones with polygon geometry, population and jobs are credited according to the share of zone area inside each circular catchment:

```text
zoneCatchmentWeight =
  area(zonePolygon intersect catchmentBuffer) / area(zonePolygon)

creditedPopulation = zonePopulation * zoneCatchmentWeight
creditedJobs = zoneJobs * zoneCatchmentWeight
```

System catchments union all half-mile station buffers before intersecting zones, preventing overlapping station areas from being counted twice. The method assumes population and employment are distributed uniformly within each block group. Zones without valid polygon geometry use deterministic centroid inclusion as a fallback.

## Demand

The model creates aggregate origin-destination demand between simulation zones:

```text
rawDemand(i,j) =
  population(i) * jobs(j)
  / max(distance(i,j), minimumDistance)^gravityDistanceExponent

specialGeneratorDemand(i,j) =
  rawDemand(i,j) * (1 + specialGeneratorDemandBonus)
```

The special-generator multiplier applies when the destination centroid is within the configured radius of Pensacola International Airport or UWF. The complete weighted matrix is still normalized to the same regional trip total, so the bonus redistributes destinations rather than creating trips from nothing.

The base-year raw matrix is normalized to `totalDailyRegionalTrips`. Future-year demand scales with the average growth factor for regional population and jobs:

```text
futureDailyRegionalTrips =
  baseDailyRegionalTrips
  * (populationGrowthFactor + jobsGrowthFactor) / 2
```

This includes background downtown-driven growth as well as transit-supported growth. Transit affects how much development occurs and how the resulting demand is distributed, but it is not required for regional demand to grow.

## Car Time

Automobile generalized time:

```text
carTime =
  roadDistance / averageCarSpeed
  + parkingPenalty * destinationEmploymentIntensity
  + congestionPenalty * densityIntensity

destinationEmploymentIntensity =
  clamp(destinationJobs / carEmploymentNormalizationJobs, 0, 1)

densityIntensity =
  clamp(averageOriginDestinationDensity / carDensityNormalization, 0, 1)
```

Road distance is approximated as straight-line distance multiplied by a configurable circuity factor.

## Transit Routing

Transit routing uses Dijkstra over a station graph:

- Base station nodes represent platforms or transfer points.
- Boarding an onboard line state adds average wait time.
- Adjacent stations on the same line are connected by in-vehicle time.
- Arriving at a non-terminal station adds the technology's dwell time; an end-to-end trip on an N-station line incurs N−2 dwells.
- Stations within 400 feet receive transfer edges. In build mode, placing or dragging a stop near a stop on another line snaps to that stop location so the transfer is explicit.
- Transfers add the actual walk time between the two station coordinates plus a smaller fixed penalty, and boarding the next line adds its wait time.

Ridership and accessibility run one multi-source, binary-heap Dijkstra search per origin zone and reuse its station paths across all destination zones. Present Day simulations reuse the initial ridership and accessibility pass; future-year simulations run a second pass after applying development growth.

For ridership assignment, the model considers the fastest network path plus the fastest direct path on each usable line. Duplicate paths are removed, and alternatives within `pathChoiceMaximumExtraMinutes` of the fastest path receive logit shares:

```text
pathWeight(k) = exp(-pathChoiceBeta * (pathMinutes(k) - fastestPathMinutes))
pathShare(k) = pathWeight(k) / sum(pathWeights)
```

Equal-time parallel services split riders evenly; slower but still competitive services receive a smaller share. The fastest path continues to determine the overall transit mode share, so adding an inferior duplicate does not create new transit trips by itself.

In-vehicle time between adjacent stations currently uses straight-line station distance multiplied by the configured road-circuity factor. It does not follow every vertex of the displayed route polyline. The polyline is used for map rendering and construction mileage, so changing route bends without changing stations can change capital cost without changing ridership.

Transit generalized time:

```text
transitPhysicalTime =
  accessWalkTime
  + averageWaitTime
  + inVehicleTime
  + intermediateStopDwellTime
  + transferWalkTime
  + fixedTransferPenalty
  + destinationWalkTime

transitGeneralizedTime =
  transitPhysicalTime
  + defaultFare * 60 / valueOfTimeDollarsPerHour
```

Average wait time:

```text
waitTime = headway / 2
```

## Accessibility

Accessibility uses the same transit paths, but destinations contribute with a smooth logistic travel-time weight instead of an all-or-nothing 30-minute cutoff:

```text
accessibilityWeight(t) =
  1 / (1 + exp(accessibilityDecayBeta * (t - accessibilityMidpointMinutes)))
```

With the defaults, a 30-minute destination receives 50% weight; closer destinations receive progressively more and farther destinations progressively less.

## Mode Share and Ridership

Car generalized time includes an estimated per-mile operating cost:

```text
carGeneralizedTime =
  carPhysicalTime
  + roadMiles * carCostPerMile * 60 / valueOfTimeDollarsPerHour
```

Transit mode share uses a logistic model over generalized time:

```text
P(transit) =
  originMaximumTransitShare
  * 1 / (1 + exp(beta * generalizedTimeDifference))

generalizedTimeDifference =
  transitGeneralizedTime
  + transitSpecificConstantMinutes
  - carGeneralizedTime

originMaximumTransitShare =
  maxTransitModeShare
  + (1 - maxTransitModeShare) * zeroVehicleHouseholdRate
```

The 17-minute transit-specific constant places equal-generalized-cost share near 12% for an origin where all households have a vehicle. Origins with more zero-vehicle households receive a higher maximum share using the ACS-derived vehicle-availability field. The conceptual demo network has a gameplay calibration band of 75–350 weekday riders. This is a gameplay calibration rather than a regional forecast.

The fare is treated as a flat one-way system fare; transfers do not add another fare. Daily riders are the sum of OD demand multiplied by transit mode share for OD pairs with a usable transit path. Line, station, transfer, and segment ridership are allocated across the eligible path choices. Reported rider travel-time savings remain physical minutes rather than monetized generalized minutes.

## Capacity and Crowding

The first ridership assignment records riders on every directed station-to-station segment. Each line's peak directional segment is converted to a peak-hour load using `peakHourRidershipShare`.

```text
hourlyCapacity = vehicleCapacity * 60 / headwayMinutes
loadRatio = peakDailySegmentLoad * peakHourRidershipShare / hourlyCapacity
```

When `loadRatio` exceeds `crowdingThreshold`, the model increases that line's in-vehicle and dwell time once:

```text
crowdingTimeMultiplier =
  1
  + crowdingTimePenaltyFactor
  * excessLoadRatio / (1 + excessLoadRatio)

excessLoadRatio = max(0, loadRatio - crowdingThreshold)
```

This saturating penalty is bounded at `1 + crowdingTimePenaltyFactor`, preventing a single feedback pass from overcorrecting severely overloaded service. The model then performs one crowding-adjusted reassignment. It does not iterate to equilibrium. Uncrowded networks skip the second assignment and retain byte-identical results.

## System Results

The simulation reports:

- Construction cost
- Annualized capital cost
- Annual operating cost
- Daily and annual ridership
- Annualized capital plus operating cost per annual rider
- Fare revenue
- Operating subsidy
- Average rider travel-time savings
- Vehicle trips removed
- CO2 reduction
- Population and jobs within walking distance of transit
- Base and modeled daily regional trip demand

Fare revenue:

```text
annualRidership * defaultFare
```

Operating subsidy:

```text
max(0, annualOperatingCost - fareRevenue)
```

Annualized cost per rider:

```text
(annualizedCapitalCost + annualOperatingCost) / annualRidership
```

This combines values on the same annual basis. It is reported as zero when the network serves no riders.

## Development

The long-term model supports Present Day, +5, +10, and +20 Years.

For each zone:

```text
developmentPressure =
  accessibilityScore * developmentAccessibilityWeight
  + transitSuccess * developmentTransitSuccessWeight
  + downtownPull * developmentDowntownWeight
```

`transitSuccess` uses transit activity credited at both the origin and destination end of each trip, so employment destinations as well as residential origins receive development credit.

Growth compounds in five-year steps and consumes the remaining development capacity after each step:

```text
periodGrowth =
  developmentGrowthRatePerFiveYears
  * remainingDevelopmentCapacity
  * developmentPressure

growthFactor = growthFactor * (1 + periodGrowth)
remainingDevelopmentCapacity =
  max(0, remainingDevelopmentCapacity - periodGrowth)
```

Partial five-year periods are prorated. The model applies the compounded growth to population, housing units, employment, commercial square footage, and land value index. Household size, commercial square feet per job, employment growth share, pressure weights, and car-time normalizers are all centralized in `src/data/assumptions.ts`.

## Known Simplifications

- No individual agents are simulated.
- No road congestion assignment is performed.
- Transit travel time uses station-to-station distance with a circuity factor rather than the complete drawn or road-snapped route geometry.
- Dwell time is a technology-level gameplay assumption applied at non-terminal stops rather than a schedule-derived value.
- Capacity uses a fixed daily-to-peak-hour share and one crowding feedback pass rather than schedules, vehicle blocks, or a converged transit assignment.
- Path spreading considers the fastest network path and direct single-line alternatives rather than enumerating every possible K-shortest transfer path.
- Station catchments use area-weighted block-group geometry and circular distance buffers rather than parcel-level activity or a pedestrian street network.
- Road snapping moves BRT/light-rail stops to nearby OSM highway geometries and uses the extracted OSM road graph to draw route geometry between consecutive stops when a connected path is available.
- Station placement projects stations onto the selected transit line geometry. In build mode, dragging a station also pulls the route geometry: stations on existing route vertices move that vertex, while stations between vertices insert a new route vertex at the stop.
- Operating costs are annualized gameplay assumptions.
- Land value and development capacity are gameplay-derived indicators, not appraisal or parcel data.

## Runtime Characteristics

Demand and accessibility are evaluated across ordered zone pairs. With 296 zones, a model pass considers about 87,000 origin-destination pairs before filtering for usable transit paths, but transit routing is computed once per origin and reused for its destinations. Future-year simulations run initial and final ridership/accessibility passes so long-range development can feed back into demand; Present Day runs only one pass. The remaining work scales with the number of zone pairs and transit graph size.

Several optimizations keep path spreading and polygon catchments affordable:

- Single-line alternative paths are only evaluated for origin-destination pairs where both endpoint zones have a station of that line within the extended catchment radius. Ineligible lines cannot produce a path, so this gating does not change results. Single-line graphs are also built lazily and shared across origins.
- Zone coverage fractions from polygon intersection are cached per zone geometry (keyed by geometry reference, so future-year zone copies and repeated ids cannot collide) under a catchment signature of buffer coordinates plus radius. Station walk buffers and the system-catchment union are also memoized by signature.
- These caches only help repeat runs. A cold Present Day run is dominated by polygon geometry (buffer intersections and the system union) and measures roughly 1.1 s / 2.5 s / 4.7 s at 1 / 3 / 6 lines on the demo dataset; warm runs measure roughly 0.1-0.4 s.

Because the cold run would otherwise block the page for seconds, the simulation executes in a Web Worker in the browser (`src/simulation/simulationClient.ts` posts the scenario and zones to `src/simulation/simulationWorker.ts`). The store shows an `isSimulating` state and ignores duplicate manual requests while one is in flight. Career scenarios can enable live results: simulation-input changes are debounced by 300 ms, and an edit during a run schedules exactly one follow-up against the latest fingerprint rather than publishing stale results. Sandbox scenarios retain the manual-run workflow. Environments without Worker support (unit tests, SSR) fall back to the same synchronous `runSimulation` call, and a worker failure also falls back synchronously. Browser verification of the production build confirmed the worker executes the run off the main thread with the page remaining interactive.

## Career finances and funding

Sandbox budgets remain advisory. Career scenarios instead persist remaining capital and an annual operating-subsidy cap. Entering Career starts with $500 million less the current network's calculated construction value, floored at zero. A capital-changing edit is priced as the difference between the network before and after the edit: positive differences spend funds, while negative differences return 50% of the retired value. An edit whose positive difference exceeds remaining capital is rejected without changing the network.

Funding milestones are deterministic definitions in `src/data/gameplay.ts`. They read published simulation outputs—weekday ridership, population within walking distance, and line crowding multipliers—and each milestone ID can unlock only once. Its grant is added to remaining capital and its announcement is included in simulation messages. Line results expose the final crowding multiplier for this purpose; a value above 1 means the crowding penalty was active.

## Career time, construction, and annual subsidy

Career time advances in one-year steps. Each paid new line or capital-increasing upgrade records a construction start year and calculates its opening year as `start year + max(1, ceil(route miles / construction miles per year))`. Rates are 10 miles/year for BRT, 5 for light rail, 3 for elevated metro, and 1.5 for subway. Existing lines without construction fields are treated as already open. Edits to work still under construction retain its original start and recompute the finish from the revised line.

The simulation filters service through that opening-year boundary. Under-construction lines remain in total construction cost and line results, but are excluded from routing, accessibility, development response, station/system catchments, airport detection, ridership, and annual operating cost. Their line result reports `isOpen: false`, zero operating cost and ridership, and the scheduled opening year.

Advancing from a completed Career year adds that result's operating subsidy (`max(0, annual operating cost - fare revenue)`) to cumulative subsidy, increments `simulationYear`, clears the old result, and lets live simulation compute the new year from base zones. If the annual subsidy exceeds the persisted cap, no accrual or time change occurs until the player chooses a response. Frequency cuts and a $0.50 fare increase change inputs and require a new forecast before advancing; the emergency grant covers the year immediately, advances the clock, and deducts twice the deficit from remaining capital. The pending deficit is persisted, so reloads cannot bypass the choice.
