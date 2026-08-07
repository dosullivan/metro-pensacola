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

Current MVP zones are real Census block groups generated into:

```text
src/data/pensacola/zones.ts
```

The refresh script also writes a GeoJSON copy:

```text
public/data/pensacola/block-groups.geojson
```

Refresh command:

```bash
python3 scripts/prepare-census-data.py \
  --out src/data/pensacola/zones.ts \
  --geojson-out public/data/pensacola/block-groups.geojson
```

The default refresh uses:

- TIGERweb Tracts_Blocks MapServer layer 8, ACS 2024 Census Block Groups.
- ACS 2024 5-year table-based Summary File detailed tables.
- LEHD/LODES8 Florida WAC all-jobs file for 2023.
- Escambia County and Santa Rosa County.
- Bounding box `-87.36,30.34,-87.10,30.62`.

Primary source URLs:

- `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/layers`
- `https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/`
- `https://lehd.ces.census.gov/data/lodes/LODES8/fl/wac/`

The generated values include:

- `population`: ACS table B01003.
- `households`: ACS table B11001.
- `housingUnits`: ACS table B25001.
- `medianIncome`: ACS table B19013.
- `carOwnership`: derived from ACS table B08201 as one minus no-vehicle households divided by households in the vehicle-availability universe.
- `jobs`: LODES WAC `C000`, aggregated from workplace blocks to block groups.
- `density`: population divided by Census `AREALAND`.

The following fields remain gameplay-derived because they are not direct ACS/LODES estimates:

- `landValueIndex`
- `developmentCapacity`
- `commercialSqFt`

## Zone Schema

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

The simulation code consumes this interface, so future parcel, GTFS, or local assessor inputs can replace the derived fields without changing routing, ridership, cost, or development logic.

## Demo Scenario Anchors

The bundled demo scenario is a conceptual example, not an official proposal. It uses approximate station anchors for:

- Downtown Pensacola
- Baptist Health Campus
- Cordova Mall
- Pensacola International Airport
- Ferry Pass
- University of West Florida

Reference sources used while setting approximate anchors include OpenStreetMap-derived map references, FAA/AirNav airport coordinates for PNS, and public coordinate references for Cordova Mall and UWF. These anchors should be reviewed before using the demo outside gameplay.
