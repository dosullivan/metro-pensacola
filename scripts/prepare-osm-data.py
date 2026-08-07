#!/usr/bin/env python3
"""Fetch a compact Pensacola OSM corridor extract from Overpass.

The MVP uses live OSM raster tiles for the visible basemap. This script creates
an optional static GeoJSON extract that can later support road-following route
snapping, corridor inspection, or offline QA layers.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import urllib.parse
import urllib.request
from typing import Any


DEFAULT_BBOX = "-87.36,30.34,-87.11,30.57"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"


def parse_bbox(value: str) -> tuple[float, float, float, float]:
    west, south, east, north = [float(part.strip()) for part in value.split(",")]
    return west, south, east, north


def build_query(bbox: tuple[float, float, float, float]) -> str:
    west, south, east, north = bbox
    overpass_bbox = f"{south},{west},{north},{east}"
    return f"""
    [out:json][timeout:90];
    (
      way["highway"~"motorway|trunk|primary|secondary|tertiary|residential|service"]({overpass_bbox});
      way["railway"]({overpass_bbox});
      way["public_transport"]({overpass_bbox});
    );
    (._;>;);
    out body;
    """


def fetch_overpass(query: str) -> dict[str, Any]:
    data = urllib.parse.urlencode({"data": query}).encode()
    request = urllib.request.Request(OVERPASS_URL, data=data, method="POST")
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def osm_to_geojson(osm: dict[str, Any]) -> dict[str, Any]:
    nodes: dict[int, tuple[float, float]] = {}
    features: list[dict[str, Any]] = []

    for element in osm.get("elements", []):
        if element.get("type") == "node":
            nodes[int(element["id"])] = (float(element["lon"]), float(element["lat"]))

    for element in osm.get("elements", []):
        if element.get("type") != "way":
            continue
        coordinates = [nodes[node_id] for node_id in element.get("nodes", []) if node_id in nodes]
        if len(coordinates) < 2:
            continue
        tags = element.get("tags", {})
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "osm_id": element.get("id"),
                    "name": tags.get("name"),
                    "highway": tags.get("highway"),
                    "railway": tags.get("railway"),
                    "public_transport": tags.get("public_transport"),
                    "maxspeed": tags.get("maxspeed"),
                },
                "geometry": {"type": "LineString", "coordinates": coordinates},
            }
        )

    return {
        "type": "FeatureCollection",
        "metadata": {
            "source": "OpenStreetMap via Overpass API",
            "note": "Optional corridor extract for Metro Pensacola MVP preprocessing.",
        },
        "features": features,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bbox", default=DEFAULT_BBOX, help="west,south,east,north")
    parser.add_argument("--out", default="public/data/pensacola/osm-corridors.geojson")
    args = parser.parse_args()

    bbox = parse_bbox(args.bbox)
    query = build_query(bbox)
    osm = fetch_overpass(query)
    geojson = osm_to_geojson(osm)

    out_path = pathlib.Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(geojson, indent=2), encoding="utf-8")
    print(f"Wrote {len(geojson['features'])} OSM corridor features to {out_path}")


if __name__ == "__main__":
    main()
