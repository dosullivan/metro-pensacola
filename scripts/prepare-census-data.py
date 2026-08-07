#!/usr/bin/env python3
"""Build Metro Pensacola simulation zones from ACS block groups and LODES jobs.

Inputs are official public data endpoints:

- Census TIGERweb ACS 2024 block-group geometries.
- Census ACS 2024 5-year table-based Summary File detailed tables.
- Census LEHD LODES8 2023 WAC workplace jobs.

The generated TypeScript file is consumed directly by the browser app.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import math
import pathlib
import statistics
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any


STATE_FIPS = "12"
DEFAULT_COUNTIES = {
    "033": "Escambia County",
    "113": "Santa Rosa County",
}
DEFAULT_BBOX = "-87.36,30.34,-87.10,30.62"
TIGERWEB_LAYER = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/8/query"
ACS_TABLE_BASE = "https://www2.census.gov/programs-surveys/acs/summary_file/{year}/table-based-SF/data/5YRData/acsdt5y{year}-{table}.dat"
LODES_WAC_URL = "https://lehd.ces.census.gov/data/lodes/LODES8/fl/wac/fl_wac_S000_JT00_{year}.csv.gz"
SQUARE_METERS_PER_SQUARE_MILE = 2_589_988.110336


ACS_TABLES = {
    "b01003": ["B01003_E001"],
    "b11001": ["B11001_E001"],
    "b25001": ["B25001_E001"],
    "b19013": ["B19013_E001"],
    "b08201": ["B08201_E001", "B08201_E002"],
}


@dataclass
class GeometryRecord:
    geoid: str
    name: str
    county: str
    tract: str
    block_group: str
    arealand_square_meters: float
    geometry: dict[str, Any]
    centroid: tuple[float, float]
    primary_ring: list[list[float]]


def parse_bbox(value: str) -> tuple[float, float, float, float]:
    west, south, east, north = [float(part.strip()) for part in value.split(",")]
    return west, south, east, north


def in_bbox(point: tuple[float, float], bbox: tuple[float, float, float, float]) -> bool:
    west, south, east, north = bbox
    lon, lat = point
    return west <= lon <= east and south <= lat <= north


def fetch_json(url: str) -> dict[str, Any]:
    request = urllib.request.Request(url, headers={"User-Agent": "MetroPensacola/0.1"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def open_text(url: str) -> io.TextIOBase:
    request = urllib.request.Request(url, headers={"User-Agent": "MetroPensacola/0.1"})
    response = urllib.request.urlopen(request, timeout=180)
    return io.TextIOWrapper(response, encoding="utf-8", newline="")


def open_gzip_text(url: str) -> io.TextIOBase:
    request = urllib.request.Request(url, headers={"User-Agent": "MetroPensacola/0.1"})
    response = urllib.request.urlopen(request, timeout=180)
    return io.TextIOWrapper(gzip.GzipFile(fileobj=response), encoding="utf-8", newline="")


def ring_area(ring: list[list[float]]) -> float:
    if len(ring) < 4:
        return 0
    total = 0.0
    for index, current in enumerate(ring):
        nxt = ring[(index + 1) % len(ring)]
        total += current[0] * nxt[1] - nxt[0] * current[1]
    return total / 2


def ring_centroid(ring: list[list[float]]) -> tuple[float, float]:
    area = ring_area(ring)
    if abs(area) < 1e-12:
        lon = sum(point[0] for point in ring) / len(ring)
        lat = sum(point[1] for point in ring) / len(ring)
        return lon, lat

    cx = 0.0
    cy = 0.0
    for index, current in enumerate(ring):
        nxt = ring[(index + 1) % len(ring)]
        factor = current[0] * nxt[1] - nxt[0] * current[1]
        cx += (current[0] + nxt[0]) * factor
        cy += (current[1] + nxt[1]) * factor
    return cx / (6 * area), cy / (6 * area)


def primary_exterior_ring(geometry: dict[str, Any]) -> list[list[float]]:
    if geometry["type"] == "Polygon":
        return geometry["coordinates"][0]
    if geometry["type"] == "MultiPolygon":
        polygons = geometry["coordinates"]
        return max((polygon[0] for polygon in polygons if polygon), key=lambda ring: abs(ring_area(ring)))
    raise ValueError(f"Unsupported geometry type: {geometry['type']}")


def round_coordinate(value: float) -> float:
    return round(value, 6)


def round_geometry_coordinates(coordinates: Any) -> Any:
    if isinstance(coordinates, list) and coordinates and isinstance(coordinates[0], (int, float)):
        return [round_coordinate(float(coordinates[0])), round_coordinate(float(coordinates[1]))]
    return [round_geometry_coordinates(item) for item in coordinates]


def fetch_block_group_geometries(
    counties: dict[str, str],
    bbox: tuple[float, float, float, float],
) -> dict[str, GeometryRecord]:
    records: dict[str, GeometryRecord] = {}
    for county_fips, county_name in counties.items():
        params = {
            "where": f"STATE='{STATE_FIPS}' AND COUNTY='{county_fips}'",
            "outFields": "GEOID,BASENAME,NAME,STATE,COUNTY,TRACT,BLKGRP,AREALAND,AREAWATER",
            "returnGeometry": "true",
            "outSR": "4326",
            "f": "geojson",
        }
        data = fetch_json(f"{TIGERWEB_LAYER}?{urllib.parse.urlencode(params)}")
        for feature in data.get("features", []):
            properties = feature["properties"]
            geometry = feature["geometry"]
            primary_ring = primary_exterior_ring(geometry)
            centroid = ring_centroid(primary_ring)
            if not in_bbox(centroid, bbox):
                continue
            geoid = str(properties["GEOID"])
            rounded_geometry = {
                "type": geometry["type"],
                "coordinates": round_geometry_coordinates(geometry["coordinates"]),
            }
            rounded_ring = round_geometry_coordinates(primary_ring)
            records[geoid] = GeometryRecord(
                geoid=geoid,
                name=f"Block Group {properties['BLKGRP']}, Tract {properties['TRACT']}",
                county=county_name,
                tract=str(properties["TRACT"]),
                block_group=str(properties["BLKGRP"]),
                arealand_square_meters=float(properties.get("AREALAND") or 0),
                geometry=rounded_geometry,
                centroid=(round_coordinate(centroid[0]), round_coordinate(centroid[1])),
                primary_ring=rounded_ring,
            )
    return records


def parse_acs_value(value: str) -> int | None:
    try:
        parsed = int(float(value))
    except ValueError:
        return None
    if parsed < 0:
        return None
    return parsed


def fetch_acs_tables(year: int, geoids: set[str]) -> dict[str, dict[str, int | None]]:
    values: dict[str, dict[str, int | None]] = {geoid: {} for geoid in geoids}
    acs_geoids = {f"1500000US{geoid}" for geoid in geoids}

    for table, columns in ACS_TABLES.items():
        url = ACS_TABLE_BASE.format(year=year, table=table)
        with open_text(url) as stream:
            reader = csv.DictReader(stream, delimiter="|")
            for row in reader:
                geo_id = row.get("GEO_ID", "")
                if geo_id not in acs_geoids:
                    continue
                geoid = geo_id.removeprefix("1500000US")
                for column in columns:
                    values[geoid][column] = parse_acs_value(row.get(column, ""))

    return values


def fetch_lodes_jobs(year: int, geoids: set[str]) -> dict[str, int]:
    jobs = {geoid: 0 for geoid in geoids}
    county_prefixes = {geoid[:5] for geoid in geoids}
    url = LODES_WAC_URL.format(year=year)

    with open_gzip_text(url) as stream:
        reader = csv.DictReader(stream)
        for row in reader:
            block = row["w_geocode"]
            if block[:5] not in county_prefixes:
                continue
            block_group = block[:12]
            if block_group in jobs:
                jobs[block_group] += int(row["C000"])

    return jobs


def percentile(values: list[float], value: float) -> float:
    if not values:
        return 0.5
    below = sum(1 for item in values if item <= value)
    return below / len(values)


def clamp(value: float, minimum: float, maximum: float) -> float:
    return min(maximum, max(minimum, value))


def build_zone_records(
    geometries: dict[str, GeometryRecord],
    acs: dict[str, dict[str, int | None]],
    jobs: dict[str, int],
) -> list[dict[str, Any]]:
    median_incomes = [
        float(values["B19013_E001"])
        for values in acs.values()
        if values.get("B19013_E001") is not None
    ]
    median_income_fallback = int(statistics.median(median_incomes)) if median_incomes else 55_000

    population_densities: list[float] = []
    job_densities: list[float] = []
    interim: list[dict[str, Any]] = []

    for geoid, geometry in geometries.items():
        values = acs.get(geoid, {})
        population = values.get("B01003_E001") or 0
        households = values.get("B11001_E001") or max(0, round(population / 2.35))
        housing_units = values.get("B25001_E001") or households
        median_income = values.get("B19013_E001") or median_income_fallback
        vehicle_households = values.get("B08201_E001")
        no_vehicle_households = values.get("B08201_E002")
        car_ownership = None
        if vehicle_households and no_vehicle_households is not None and vehicle_households > 0:
            car_ownership = clamp(1 - no_vehicle_households / vehicle_households, 0, 1)

        area_square_miles = max(geometry.arealand_square_meters / SQUARE_METERS_PER_SQUARE_MILE, 0.01)
        zone_jobs = jobs.get(geoid, 0)
        density = population / area_square_miles
        job_density = zone_jobs / area_square_miles
        population_densities.append(density)
        job_densities.append(job_density)

        interim.append(
            {
                "id": geoid,
                "name": f"{geometry.name}, {geometry.county}",
                "countyName": geometry.county,
                "tract": geometry.tract,
                "blockGroup": geometry.block_group,
                "centroid": [geometry.centroid[0], geometry.centroid[1]],
                "polygon": geometry.primary_ring,
                "geometry": geometry.geometry,
                "population": population,
                "households": households,
                "jobs": zone_jobs,
                "density": round(density),
                "carOwnership": round(car_ownership, 3) if car_ownership is not None else None,
                "medianIncome": median_income,
                "housingUnits": housing_units,
                "commercialSqFt": round(zone_jobs * 340),
                "areaSqMiles": round(area_square_miles, 4),
            }
        )

    for zone in interim:
        income_score = percentile(median_incomes, float(zone["medianIncome"]))
        density_score = percentile(population_densities, float(zone["density"]))
        job_score = percentile(job_densities, float(zone["jobs"] / max(zone["areaSqMiles"], 0.01)))
        vacancy_rate = max(0, (zone["housingUnits"] - zone["households"]) / max(zone["housingUnits"], 1))
        low_density_capacity = 1 - density_score

        zone["landValueIndex"] = round(clamp(0.62 + income_score * 0.48 + job_score * 0.22, 0.55, 1.45), 3)
        zone["developmentCapacity"] = round(
            clamp(0.18 + low_density_capacity * 0.42 + vacancy_rate * 1.35 + job_score * 0.12, 0.12, 0.88),
            3,
        )

        if zone["carOwnership"] is None:
            zone.pop("carOwnership")

    return sorted(interim, key=lambda zone: zone["id"])


def ts_literal(value: Any) -> str:
    return json.dumps(value, indent=2, separators=(",", ": "))


def write_typescript(
    zones: list[dict[str, Any]],
    output: pathlib.Path,
    acs_year: int,
    lodes_year: int,
    counties: dict[str, str],
    bbox: tuple[float, float, float, float],
) -> None:
    total_population = sum(zone["population"] for zone in zones)
    total_households = sum(zone["households"] for zone in zones)
    total_jobs = sum(zone["jobs"] for zone in zones)
    metadata = {
        "zoneCount": len(zones),
        "totalPopulation": total_population,
        "totalHouseholds": total_households,
        "totalJobs": total_jobs,
        "acsYear": acs_year,
        "lodesYear": lodes_year,
        "tigerwebLayer": "TIGERweb Tracts_Blocks MapServer layer 8, ACS 2024 Census Block Groups",
        "counties": counties,
        "bbox": {
            "west": bbox[0],
            "south": bbox[1],
            "east": bbox[2],
            "north": bbox[3],
        },
        "notes": [
            "Population, households, housing units, median income, and vehicle availability come from ACS 5-year detailed tables.",
            "Jobs are LEHD LODES8 WAC all-jobs workplace counts aggregated from blocks to block groups.",
            "Land value index, commercial square feet, and development capacity are gameplay-derived fields, not direct Census estimates.",
        ],
    }

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        "\n".join(
            [
                "import type { SimulationZone } from '../../types';",
                "",
                "// Generated by scripts/prepare-census-data.py. Do not edit by hand.",
                f"export const PENSACOLA_DATA_METADATA = {ts_literal(metadata)} as const;",
                "",
                f"export const PENSACOLA_ZONES: SimulationZone[] = {ts_literal(zones)};",
                "",
            ]
        ),
        encoding="utf-8",
    )


def write_geojson(zones: list[dict[str, Any]], output: pathlib.Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    features = [
        {
            "type": "Feature",
            "properties": {key: value for key, value in zone.items() if key not in {"geometry", "polygon"}},
            "geometry": zone["geometry"],
        }
        for zone in zones
    ]
    output.write_text(
        json.dumps({"type": "FeatureCollection", "features": features}, indent=2),
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--acs-year", type=int, default=2024)
    parser.add_argument("--lodes-year", type=int, default=2023)
    parser.add_argument("--bbox", default=DEFAULT_BBOX, help="west,south,east,north")
    parser.add_argument(
        "--counties",
        default="033,113",
        help="Comma-separated Florida county FIPS codes. Defaults to Escambia and Santa Rosa.",
    )
    parser.add_argument("--out", default="src/data/pensacola/zones.ts")
    parser.add_argument("--geojson-out", default="public/data/pensacola/block-groups.geojson")
    args = parser.parse_args()

    county_codes = [county.strip() for county in args.counties.split(",") if county.strip()]
    counties = {code: DEFAULT_COUNTIES.get(code, f"County {code}") for code in county_codes}
    bbox = parse_bbox(args.bbox)

    geometries = fetch_block_group_geometries(counties, bbox)
    if not geometries:
        raise SystemExit("No block groups matched the requested counties and bbox.")

    acs = fetch_acs_tables(args.acs_year, set(geometries))
    jobs = fetch_lodes_jobs(args.lodes_year, set(geometries))
    zones = build_zone_records(geometries, acs, jobs)

    write_typescript(zones, pathlib.Path(args.out), args.acs_year, args.lodes_year, counties, bbox)
    write_geojson(zones, pathlib.Path(args.geojson_out))

    print(
        "Wrote "
        f"{len(zones)} ACS/LODES block-group zones, "
        f"{sum(zone['population'] for zone in zones):,} residents, "
        f"{sum(zone['jobs'] for zone in zones):,} jobs."
    )


if __name__ == "__main__":
    main()
