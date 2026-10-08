"""Fetch village points around Sangrur from OpenStreetMap (Overpass API).

Why it exists: the simulator and the demo use real village names and locations, not invented ones.
Raw response -> data/raw/osm_villages_sangrur.json (git-ignored).
Derived, small, committed -> data/derived/villages_sangrur.json.

Run: python3 data/scripts/fetch_villages.py
Data (c) OpenStreetMap contributors, ODbL.
"""

from __future__ import annotations

import json
import pathlib
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
RAW_PATH = ROOT / "data/raw/osm_villages_sangrur.json"
DERIVED_PATH = ROOT / "data/derived/villages_sangrur.json"
# A window around Sangrur town, inside the project bounding box 75.2,29.8,76.2,30.6.
SOUTH, WEST, NORTH, EAST = 30.15, 75.70, 30.35, 75.95
QUERY = f'[out:json][timeout:60];node["place"="village"]({SOUTH},{WEST},{NORTH},{EAST});out;'


def main() -> None:
    if not RAW_PATH.exists():
        body = urllib.parse.urlencode({"data": QUERY}).encode()
        request = urllib.request.Request(
            "https://overpass-api.de/api/interpreter",
            data=body,
            # Overpass answers 406 Not Acceptable without a User-Agent.
            headers={"User-Agent": "vaari-hackathon-dataprep/0.1", "Accept": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=90) as response:
            RAW_PATH.parent.mkdir(parents=True, exist_ok=True)
            RAW_PATH.write_bytes(response.read())
    elements = json.loads(RAW_PATH.read_text())["elements"]
    villages = sorted(
        (
            {
                "id": "v" + str(element["id"]),
                "name": element["tags"]["name"],
                "namePa": element["tags"].get("name:pa"),
                "lat": round(element["lat"], 5),
                "lon": round(element["lon"], 5),
                "osmNodeId": element["id"],
            }
            for element in elements
            if element.get("tags", {}).get("name")
        ),
        key=lambda village: village["name"],
    )
    payload = {
        "source": "OpenStreetMap via Overpass API, place=village",
        "license": "ODbL, (c) OpenStreetMap contributors",
        "bbox": [WEST, SOUTH, EAST, NORTH],
        "villages": villages,
    }
    DERIVED_PATH.parent.mkdir(parents=True, exist_ok=True)
    DERIVED_PATH.write_text(json.dumps(payload, indent=1, ensure_ascii=False) + "\n")
    print(f"wrote {len(villages)} villages to {DERIVED_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
