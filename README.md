# Metro Pensacola

Metro Pensacola is a playable browser-based urban transit planning simulation for the Pensacola, Florida area. It combines a real MapLibre/OpenStreetMap basemap with lightweight transit drawing, station placement, scenario storage, ridership modeling, costs, accessibility, and long-range development effects.

The MVP is frontend-only. It runs locally with Vite and automatically persists scenarios and UI state in browser storage. The visible basemap still requires network access to load OpenStreetMap tiles.

## Run

```bash
npm install
npm run dev
```

Then open the local URL printed by Vite.

Useful checks:

```bash
npm run test
npm run build
```

## Current Gameplay

- View Pensacola on a MapLibre map.
- Build BRT, light rail, elevated metro, or subway lines.
- Draw stops and loose route geometry by clicking the map.
- Optionally snap BRT/light-rail stops to nearby OSM road corridors and draw route segments along the extracted road network.
- Drag stops to reshape routes and undo the most recent stop or route bend.
- Place stations on the selected line, then drag them to pull the route through a new stop location.
- Link lines by placing or dragging a stop near another line's stop; nearby stops snap together and allow transfers.
- Reorder stations on a line.
- Set peak frequency from 5 to 30 minutes.
- Run the deterministic aggregate simulation.
- Inspect zones, lines, and stations.
- Toggle population, employment, density, accessibility, ridership, development, land value, and station catchment overlays.
- Automatically persist scenarios in browser storage, with controls to switch, duplicate, delete, restore, and compare them.
- Keep the classic manual-run Sandbox workflow, or switch a scenario to Career mode for debounced live simulation with latest-change-wins worker scheduling.
- Use advisory capital and operating budgets in Sandbox, or persistent hard capital funds in Career. Career construction spends funds, demolition returns 50%, and one-time ridership, access, and crowding milestones award new grants.
- Advance the Career clock one year at a time. New and upgraded lines remain under construction for a technology- and mileage-based duration, then begin carrying riders and incurring operating cost; annual subsidy overruns pause for a player choice.
- Pursue deadline-based Career objectives through Year 20 while deterministic airport, council-review, and station-development events change demand, subsidy support, and growth capacity.
- Start from a clearly labeled conceptual three-corridor BRT demo network covering downtown, Cordova, Ferry Pass, UWF, West Pensacola, and Pace Boulevard.

## Architecture

```text
src/
  components/
    controls/
    map/
    panels/
  data/
    assumptions.ts
    pensacola/
  simulation/
    accessibility.ts
    catchment.ts
    costs.ts
    demand.ts
    development.ts
    geo.ts
    ridership.ts
    routing.ts
    runSimulation.ts
    snapping.ts
    transfers.ts
  store/
    scenarioStore.ts
  types/
scripts/
docs/
tests/
```

The simulation modules are independent of React and are covered by unit tests. React components read and write scenarios through Zustand.

Route geometry has two distinct roles in the current model: the drawn polyline determines displayed alignment and construction mileage, while in-vehicle travel time is calculated between ordered station coordinates using a road-circuity factor. Route bends therefore change cost and appearance without changing ridership unless station positions or ordering also change.

## Data

The visible basemap uses OpenStreetMap raster tiles through MapLibre GL JS. The zone model in `src/data/pensacola/zones.ts` is generated from real Census block-group geometry, ACS 5-year data, and LEHD/LODES workplace jobs.

Current generated dataset:

- TIGERweb ACS 2024 block-group geometry.
- ACS 2024 5-year detailed tables for population, households, housing units, median household income, and vehicle availability.
- LEHD/LODES8 2023 WAC all-jobs workplace counts aggregated from blocks to block groups.
- All Escambia County and Santa Rosa County block groups.
- Current generated coverage: 296 block groups, 524,395 residents, and 205,446 workplace jobs.

The generated `landValueIndex`, `commercialSqFt`, and `developmentCapacity` fields are gameplay-derived transforms. They are not direct Census estimates.

To refresh the optional OSM corridor extract:

```bash
python3 scripts/prepare-osm-data.py \
  --out public/data/pensacola/osm-corridors.geojson \
  --metadata-out src/data/pensacola/osmCorridorsMetadata.ts
```

By default this fetches OSM highway corridors for Escambia County and Santa Rosa County using their OSM county relation areas. Pass `--bbox west,south,east,north` only when you intentionally want a smaller road-snapping extract.

To refresh the ACS/LODES simulation zones:

```bash
python3 scripts/prepare-census-data.py \
  --out src/data/pensacola/zones.ts \
  --geojson-out public/data/pensacola/block-groups.geojson
```

Pass `--bbox west,south,east,north` only when you intentionally want a smaller clipped Census study area.

## Modeling Status

This is not a microscopic traffic simulator. It uses aggregate zone-to-zone demand, Dijkstra transit routing, configurable costs, and explainable assumptions. See [docs/simulation-model.md](docs/simulation-model.md).

## Current Technical Constraints

- `src/data/pensacola/zones.ts` is imported synchronously and is roughly 10 MB before bundling, so production startup and bundle size need future optimization through lazy loading or code splitting.
- The roughly 34 MB OSM corridor GeoJSON is loaded only after Road Snap is enabled. Its road graph is then built in the browser, which can produce a noticeable one-time delay.
- Simulation work still scores about 87,000 ordered origin-destination pairs per model pass, but transit paths are computed once per origin zone and reused across destinations. Larger networks may eventually need a web worker or further demand-performance work.
- Scenarios are local to a browser profile. There is no account sync, backend storage, or import/export workflow yet.
