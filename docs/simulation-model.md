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

## Catchments

Each station has two catchment bands:

```text
normal walking catchment = 0.5 miles
extended catchment = 1.0 mile
```

Block-group centroids inside each band contribute their full population and jobs. This is intentionally simple and explainable.

## Demand

The model creates aggregate origin-destination demand between simulation zones:

```text
rawDemand(i,j) =
  population(i) * jobs(j)
  / max(distance(i,j), minimumDistance)^gravityDistanceExponent
```

The raw matrix is normalized to `totalDailyRegionalTrips`.

## Car Time

Automobile generalized time:

```text
carTime =
  roadDistance / averageCarSpeed
  + parkingPenalty * destinationEmploymentIntensity
  + congestionPenalty * densityIntensity
```

Road distance is approximated as straight-line distance multiplied by a configurable circuity factor.

## Transit Routing

Transit routing uses Dijkstra over a station graph:

- Base station nodes represent platforms or transfer points.
- Boarding an onboard line state adds average wait time.
- Adjacent stations on the same line are connected by in-vehicle time.
- Stations within 400 feet receive transfer edges. In build mode, placing or dragging a stop near a stop on another line snaps to that stop location so the transfer is explicit.
- Transfers add a penalty, and boarding the next line adds its wait time.

Ridership and accessibility run one multi-source, binary-heap Dijkstra search per origin zone and reuse its station paths across all destination zones. Present Day simulations reuse the initial ridership and accessibility pass; future-year simulations run a second pass after applying development growth.

In-vehicle time between adjacent stations currently uses straight-line station distance multiplied by the configured road-circuity factor. It does not follow every vertex of the displayed route polyline. The polyline is used for map rendering and construction mileage, so changing route bends without changing stations can change capital cost without changing ridership.

Transit generalized time:

```text
transitPhysicalTime =
  accessWalkTime
  + averageWaitTime
  + inVehicleTime
  + transferPenalty
  + destinationWalkTime

transitGeneralizedTime =
  transitPhysicalTime
  + defaultFare * 60 / valueOfTimeDollarsPerHour
```

Average wait time:

```text
waitTime = headway / 2
```

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
  maxTransitModeShare
  * 1 / (1 + exp(beta * (transitGeneralizedTime - carGeneralizedTime)))
```

The fare is treated as a flat one-way system fare; transfers do not add another fare. Daily riders are the sum of OD demand multiplied by transit mode share for OD pairs with a usable transit path. Line ridership counts riders assigned to each line used in the fastest path. Reported rider travel-time savings remain physical minutes rather than monetized generalized minutes.

## System Results

The simulation reports:

- Construction cost
- Annual operating cost
- Daily and annual ridership
- Cost per daily rider
- Fare revenue
- Operating subsidy
- Average rider travel-time savings
- Vehicle trips removed
- CO2 reduction
- Population and jobs within walking distance of transit

Fare revenue:

```text
annualRidership * defaultFare
```

Operating subsidy:

```text
max(0, annualOperatingCost - fareRevenue)
```

## Development

The long-term model supports Present Day, +5, +10, and +20 Years.

For each zone:

```text
developmentPressure =
  accessibilityScore * 0.55
  + transitSuccess * 0.25
  + downtownPull * 0.20
```

Growth is then limited by development capacity:

```text
growth =
  developmentGrowthRatePerFiveYears
  * (years / 5)
  * developmentCapacity
  * developmentPressure
```

The model applies this growth to population, housing units, employment, commercial square footage, and land value index.

## Known Simplifications

- No individual agents are simulated.
- No road congestion assignment is performed.
- Transit travel time uses station-to-station distance with a circuity factor rather than the complete drawn or road-snapped route geometry.
- Station catchments use block-group centroid inclusion rather than parcel or network walking distance.
- Road snapping moves BRT/light-rail stops to nearby OSM highway geometries and uses the extracted OSM road graph to draw route geometry between consecutive stops when a connected path is available.
- Station placement projects stations onto the selected transit line geometry. In build mode, dragging a station also pulls the route geometry: stations on existing route vertices move that vertex, while stations between vertices insert a new route vertex at the stop.
- Operating costs are annualized gameplay assumptions.
- Land value and development capacity are gameplay-derived indicators, not appraisal or parcel data.

## Runtime Characteristics

Demand and accessibility are evaluated across ordered zone pairs. With 296 zones, a model pass considers about 87,000 origin-destination pairs before filtering for usable transit paths, but transit routing is computed once per origin and reused for its destinations. Future-year simulations run initial and final ridership/accessibility passes so long-range development can feed back into demand; Present Day runs only one pass. The remaining work scales with the number of zone pairs and transit graph size.
