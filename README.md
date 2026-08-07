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
- Draw loose route geometry by clicking the map.
- Place draggable stations on the selected line.
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

The visible basemap uses OpenStreetMap raster tiles through MapLibre GL JS. The zone model is a synthetic gameplay dataset in `src/data/pensacola/zones.ts`; it uses real Pensacola place anchors but is not Census or LODES data.

To refresh the optional OSM corridor extract:

```bash
python3 scripts/prepare-osm-data.py \
  --bbox -87.36,30.34,-87.11,30.57 \
  --out public/data/pensacola/osm-corridors.geojson
```

To export the current synthetic zone schema as GeoJSON:

```bash
python3 scripts/prepare-census-data.py \
  --out public/data/pensacola/synthetic-zones.geojson
```

Actual ACS block-group and LODES job imports are documented as a future replacement path in [docs/data-sources.md](docs/data-sources.md).

## Modeling Status

This is not a microscopic traffic simulator. It uses aggregate zone-to-zone demand, Dijkstra transit routing, configurable costs, and explainable assumptions. See [docs/simulation-model.md](docs/simulation-model.md).
