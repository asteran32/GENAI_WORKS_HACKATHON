"""Local GIS snapshot writer/reader. No network or credentials in this process."""
import hashlib
import json
from pathlib import Path
import struct
import sys

import pyarrow as pa
import pyarrow.parquet as pq

LAYERS = ("building", "transportation", "water", "landcover", "landuse", "poi")
SCHEMA = pa.schema([
    ("feature_id", pa.string()), ("layer", pa.string()),
    ("geometry", pa.binary()), ("geometry_json", pa.string()),
    ("properties_json", pa.string()), ("height_m", pa.float64()),
    ("min_height_m", pa.float64()), ("height_method", pa.string()),
    ("source_url", pa.string()), ("source_tile", pa.string()),
    ("collected_at", pa.string()), ("dataset_version", pa.string()),
    ("source_hash", pa.string()), ("crs", pa.string()),
])


def wkb(geometry):
    kind, coords = geometry["type"], geometry["coordinates"]
    number = {"Point": 1, "LineString": 2, "Polygon": 3,
              "MultiPoint": 4, "MultiLineString": 5, "MultiPolygon": 6}[kind]
    header = struct.pack("<BI", 1, number)
    count = lambda n: struct.pack("<I", n)
    point = lambda p: struct.pack("<dd", p[0], p[1])
    line = lambda points: count(len(points)) + b"".join(point(p) for p in points)
    if kind == "Point": return header + point(coords)
    if kind == "LineString": return header + line(coords)
    if kind == "Polygon": return header + count(len(coords)) + b"".join(line(r) for r in coords)
    child = {"MultiPoint": "Point", "MultiLineString": "LineString", "MultiPolygon": "Polygon"}[kind]
    return header + count(len(coords)) + b"".join(wkb({"type": child, "coordinates": c}) for c in coords)


def write_snapshot(source, destination):
    snapshot = json.loads(Path(source).read_text())
    directory = Path(destination)
    directory.mkdir(parents=True, exist_ok=True)
    files = []
    for layer in LAYERS:
        features = [f for f in snapshot["features"] if f["properties"]["layer"] == layer]
        rows = []
        for feature in features:
            p, g = feature["properties"], feature["geometry"]
            rows.append({
                "feature_id": feature["id"], "layer": layer, "geometry": wkb(g),
                "geometry_json": json.dumps(g, separators=(",", ":")),
                "properties_json": json.dumps(p, separators=(",", ":")),
                "height_m": p.get("height_m"), "min_height_m": p.get("min_height_m"),
                "height_method": p.get("height_method"), "source_url": p["source_url"],
                "source_tile": p["source_tile"], "collected_at": snapshot["fetchedAt"],
                "dataset_version": snapshot["version"], "source_hash": p["source_hash"], "crs": "OGC:CRS84",
            })
        geo = {"version": "1.1.0", "primary_column": "geometry", "columns": {
            "geometry": {"encoding": "WKB", "geometry_types": sorted({f["geometry"]["type"] for f in features})}
        }}  # Omitted CRS means OGC:CRS84 in GeoParquet (longitude, latitude).
        table = pa.Table.from_pylist(rows, schema=SCHEMA).replace_schema_metadata({b"geo": json.dumps(geo).encode()})
        name = f"{layer}.parquet"
        location = directory / name
        pq.write_table(table, location, compression="snappy", version="1.0")
        location.chmod(0o644)  # Public GIS data must be readable by the container UID.
        check = pq.read_table(location)
        if check.to_pylist() != rows: raise ValueError(f"Parquet round-trip mismatch: {layer}")
        files.append({"name": name, "table": layer, "rows": len(rows), "bytes": location.stat().st_size,
                      "sha256": hashlib.sha256(location.read_bytes()).hexdigest()})
    manifest = {"format": "GeoParquet 1.1 / WKB", "version": snapshot["version"],
                "createdAt": snapshot["fetchedAt"], "files": files, "roundTripVerified": True}
    (directory / "manifest.json").write_text(json.dumps(manifest, indent=2))
    return manifest


def read_snapshot(directory):
    directory = Path(directory)
    manifest = json.loads((directory / "manifest.json").read_text())
    features = []
    for info in manifest["files"]:
        if info["name"] not in [f"{layer}.parquet" for layer in LAYERS]: raise ValueError("Invalid layer path")
        location = directory / info["name"]
        if hashlib.sha256(location.read_bytes()).hexdigest() != info["sha256"]: raise ValueError("Parquet checksum mismatch")
        rows = pq.read_table(location).to_pylist()
        if len(rows) != info["rows"]: raise ValueError("Parquet row count mismatch")
        for row in rows:
            if row["dataset_version"] != manifest["version"]: raise ValueError("Dataset version mismatch")
            features.append({"type": "Feature", "id": row["feature_id"], "geometry": json.loads(row["geometry_json"]),
                             "properties": json.loads(row["properties_json"])})
    return {"features": features, "manifest": manifest}


if __name__ == "__main__":
    try:
        if sys.argv[1] == "write": result = write_snapshot(sys.argv[2], sys.argv[3])
        elif sys.argv[1] == "read": result = read_snapshot(sys.argv[2])
        else: raise ValueError("Expected write or read")
        print(json.dumps(result, separators=(",", ":")))
    except Exception as error:
        print(f"Parquet: {error}", file=sys.stderr)
        raise SystemExit(1)
