# Metro Pensacola

Metro Pensacola is a playable browser-based urban transit planning simulation for the Pensacola, Florida area. It combines a real MapLibre/OpenStreetMap basemap with lightweight transit drawing, station placement, scenario storage, ridership modeling, costs, accessibility, and long-range development effects.

The MVP is frontend-only. It runs locally with Vite and stores scenarios in browser storage.

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
- Optionally snap BRT/light-rail route clicks to nearby OSM road corridors.
- Drag stops to reshape routes and undo the most recent stop or route bend.
- Place stations on the selected line, then drag them to pull the route through a new stop location.
- Reorder stations on a line.
- Set peak frequency from 5 to 30 minutes.
- Run the deterministic aggregate simulation.
- Inspect zones, lines, and stations.
- Toggle population, employment, density, accessibility, ridership, development, land value, and station catchment overlays.
- Save, load, duplicate, delete, and compare scenarios from browser storage.
- Start from a clearly labeled conceptual demo corridor from downtown Pensacola to UWF via Baptist Health, Cordova Mall, PNS airport, and Ferry Pass.

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
  store/
    scenarioStore.ts
  types/
scripts/
docs/
tests/
```

The simulation modules are independent of React and are covered by unit tests. React components read and write scenarios through Zustand.

## Data

The visible basemap uses OpenStreetMap raster tiles through MapLibre GL JS. The zone model in `src/data/pensacola/zones.ts` is generated from real Census block-group geometry, ACS 5-year data, and LEHD/LODES workplace jobs.

Current generated dataset:

- TIGERweb ACS 2024 block-group geometry.
- ACS 2024 5-year detailed tables for population, households, housing units, median household income, and vehicle availability.
- LEHD/LODES8 2023 WAC all-jobs workplace counts aggregated from blocks to block groups.
- Escambia and Santa Rosa block groups whose centroids fall inside the configured Pensacola-area bounding box.

The generated `landValueIndex`, `commercialSqFt`, and `developmentCapacity` fields are gameplay-derived transforms. They are not direct Census estimates.

To refresh the optional OSM corridor extract:

```bash
python3 scripts/prepare-osm-data.py \
  --bbox -87.36,30.34,-87.10,30.62 \
  --out public/data/pensacola/osm-corridors.geojson
```

To refresh the ACS/LODES simulation zones:

```bash
python3 scripts/prepare-census-data.py \
  --out src/data/pensacola/zones.ts \
  --geojson-out public/data/pensacola/block-groups.geojson
```

## Modeling Status

This is not a microscopic traffic simulator. It uses aggregate zone-to-zone demand, Dijkstra transit routing, configurable costs, and explainable assumptions. See [docs/simulation-model.md](docs/simulation-model.md).
