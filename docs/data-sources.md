# Data Sources

## Basemap

The application displays a real Pensacola map with MapLibre GL JS using OpenStreetMap raster tiles:

- https://www.openstreetmap.org/
- https://tile.openstreetmap.org/

The map remains the dominant geographic reference. The app does not invent roads or coastlines.

## OSM Corridor Extract

The MVP includes an optional preprocessing path for OpenStreetMap corridors:

```bash
python3 scripts/prepare-osm-data.py \
  --bbox -87.36,30.34,-87.11,30.57 \
  --out public/data/pensacola/osm-corridors.geojson
```

This script uses the Overpass API to fetch highways, railways, and public-transport ways in the Pensacola area. The generated file is not required for the current MVP because route drawing is intentionally loose. It is intended for later road-following BRT/light-rail corridor tools.

## Simulation Zones

Current MVP zones are synthetic gameplay zones in:

```text
src/data/pensacola/zones.ts
```

They use real place names and coordinates around Pensacola, but their demographic and employment values are not Census or LODES estimates.

To export a small GeoJSON version of the synthetic schema:

```bash
python3 scripts/prepare-census-data.py \
  --out public/data/pensacola/synthetic-zones.geojson
```

## Future Census and LODES Replacement

A production data refresh should replace the synthetic zones with:

- Census TIGER/Line block-group geometries for Escambia County and, if expanded, Santa Rosa County.
- ACS 5-year block-group tables for population, households, income, housing units, and car ownership.
- LEHD Origin-Destination Employment Statistics for workplace job counts.

Suggested target schema:

```ts
interface SimulationZone {
  id: string;
  centroid: [number, number];
  population: number;
  households: number;
  jobs: number;
  density: number;
  carOwnership?: number;
  medianIncome?: number;
  housingUnits?: number;
  commercialSqFt?: number;
  landValueIndex: number;
  developmentCapacity: number;
}
```

The simulation code consumes this interface, so the replacement should not require changes to routing, ridership, cost, or development logic.

## Demo Scenario Anchors

The bundled demo scenario is a conceptual example, not an official proposal. It uses approximate station anchors for:

- Downtown Pensacola
- Baptist Health Campus
- Cordova Mall
- Pensacola International Airport
- Ferry Pass
- University of West Florida

Reference sources used while setting approximate anchors include OpenStreetMap-derived map references, FAA/AirNav airport coordinates for PNS, and public coordinate references for Cordova Mall and UWF. These anchors should be reviewed before using the demo outside gameplay.
