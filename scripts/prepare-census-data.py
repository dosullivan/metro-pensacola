#!/usr/bin/env python3
"""Write the current synthetic Pensacola zone schema as GeoJSON.

Actual ACS block-group and LODES imports are not implemented in the MVP. This
script gives the project a stable preprocessing target and output schema while
the browser game uses src/data/pensacola/zones.ts.
"""

from __future__ import annotations

import argparse
import json
import pathlib


SYNTHETIC_ZONES = [
    {"id": "downtown-core", "name": "Downtown Core", "lon": -87.2155, "lat": 30.4122, "population": 4400, "jobs": 16800},
    {"id": "brent", "name": "Brent", "lon": -87.2361, "lat": 30.4688, "population": 11800, "jobs": 9600},
    {"id": "cordova-mall", "name": "Cordova Mall", "lon": -87.2076, "lat": 30.4756, "population": 4800, "jobs": 14200},
    {"id": "airport", "name": "Pensacola International Airport", "lon": -87.1866, "lat": 30.4734, "population": 1300, "jobs": 7300},
    {"id": "ferry-pass", "name": "Ferry Pass", "lon": -87.2122, "lat": 30.5144, "population": 17600, "jobs": 8200},
    {"id": "uwf", "name": "University of West Florida", "lon": -87.2181, "lat": 30.5495, "population": 7200, "jobs": 8900},
]


def feature(zone: dict[str, object]) -> dict[str, object]:
    lon = float(zone["lon"])
    lat = float(zone["lat"])
    radius_lon = 0.014
    radius_lat = 0.011
    ring = [
        [lon + radius_lon, lat],
        [lon + radius_lon / 2, lat + radius_lat],
        [lon - radius_lon / 2, lat + radius_lat],
        [lon - radius_lon, lat],
        [lon - radius_lon / 2, lat - radius_lat],
        [lon + radius_lon / 2, lat - radius_lat],
        [lon + radius_lon, lat],
    ]
    return {
        "type": "Feature",
        "properties": {
            "id": zone["id"],
            "name": zone["name"],
            "population": zone["population"],
            "jobs": zone["jobs"],
            "synthetic": True,
        },
        "geometry": {"type": "Polygon", "coordinates": [ring]},
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="public/data/pensacola/synthetic-zones.geojson")
    args = parser.parse_args()

    geojson = {
        "type": "FeatureCollection",
        "metadata": {
            "source": "Synthetic gameplay data",
            "note": "Not Census or LODES. Replace with block-group/LODES preprocessing later.",
        },
        "features": [feature(zone) for zone in SYNTHETIC_ZONES],
    }

    out_path = pathlib.Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(geojson, indent=2), encoding="utf-8")
    print(f"Wrote {len(geojson['features'])} synthetic zone features to {out_path}")


if __name__ == "__main__":
    main()
