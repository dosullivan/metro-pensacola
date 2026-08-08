# Data Sources

## Basemap

The application displays a real Pensacola map with MapLibre GL JS using OpenStreetMap raster tiles:

- https://www.openstreetmap.org/
- https://tile.openstreetmap.org/

The map remains the dominant geographic reference. The app does not invent roads or coastlines.

The tile layer is remote rather than bundled. Scenario data remains in browser storage, but the visible basemap requires network access unless the browser already has the needed tiles cached.

## OSM Corridor Extract

The MVP includes an optional preprocessing path for OpenStreetMap corridors:

```bash
python3 scripts/prepare-osm-data.py \
  --out public/data/pensacola/osm-corridors.geojson \
  --metadata-out src/data/pensacola/osmCorridorsMetadata.ts
```

This script uses the Overpass API to fetch OSM highway ways in Escambia County and Santa Rosa County by default. The generated file powers the road-snap build toggle for BRT and light rail. Snapping moves stops to the nearest OSM highway within the configured snap distance and draws route geometry between consecutive stops along the extracted road network when a connected path is available.

The corridor file is not part of the initial JavaScript bundle. The browser fetches it the first time Road Snap is enabled and constructs the routable graph client-side. The current full-county file is roughly 34 MB, so enabling the feature can have a noticeable initial loading and processing cost.

Current generated OSM coverage:

- Escambia County, Florida OSM relation `1210737`.
- Santa Rosa County, Florida OSM relation `1210706`.
- 37,930 road corridor features.

Pass `--bbox west,south,east,north` only when intentionally producing a smaller road-snapping extract.

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
- All block groups in Escambia County and Santa Rosa County.

The current generated dataset contains 296 block groups, 524,395 residents, 201,632 households, and 205,446 workplace jobs. Pass `--bbox west,south,east,north` only when intentionally producing a smaller clipped study area.

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

The bundled demo scenario is a conceptual example, not an official proposal. It uses user-drawn route geometry and approximate station anchors for:

- Downtown Pensacola
- Baptist Health Campus
- Cordova Mall
- Ferry Pass
- University of West Florida
- West Pensacola
- Bellview
- Pace Boulevard

Reference sources used while setting approximate anchors include OpenStreetMap-derived map references and public coordinate references for Cordova Mall and UWF. These anchors should be reviewed before using the demo outside gameplay.
