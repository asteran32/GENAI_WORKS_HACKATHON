"""Write and verify the bounded CBD walking, tree and hourly observation bundle."""
import hashlib
import json
from pathlib import Path
import sys

import pyarrow as pa
import pyarrow.parquet as pq

from parquet import wkb

SCHEMAS = {
    "walk_nodes": [("id", pa.string()), ("lon", pa.float64()), ("lat", pa.float64()), ("level", pa.string()), ("degree", pa.int32())],
    "walk_edges": [("id", pa.string()), ("from_id", pa.string()), ("to_id", pa.string()), ("length_m", pa.float64()), ("quality", pa.string()), ("steps", pa.bool_()), ("step_free_candidate", pa.bool_()), ("level", pa.string()), ("way_id", pa.string()), ("direction", pa.string())],
    "trees": [("id", pa.string()), ("lon", pa.float64()), ("lat", pa.float64()), ("height_m", pa.float64()), ("canopy_raw", pa.float64()), ("canopy_diameter_m", pa.float64()), ("canopy_method", pa.string()), ("status", pa.string())],
    "pedestrian_sites": [("id", pa.string()), ("name", pa.string()), ("description", pa.string()), ("lon", pa.float64()), ("lat", pa.float64()), ("matched_edge_id", pa.string()), ("match_distance_m", pa.float64()), ("match_quality", pa.string())],
    "pedestrian_counts": [("site_id", pa.string()), ("instant_utc", pa.string()), ("passages", pa.int32()), ("source_object_id", pa.int64()), ("quality", pa.string()), ("evidence_type", pa.string())],
    "weather": [("instant_utc", pa.string()), ("temperature_c", pa.float64()), ("humidity_pct", pa.float64()), ("wind_m_s", pa.float64()), ("shortwave_w_m2", pa.float64()), ("grid_lat", pa.float64()), ("grid_lon", pa.float64()), ("evidence_type", pa.string())],
}
SPATIAL = {"walk_nodes", "walk_edges", "trees", "pedestrian_sites"}


def sha(location):
    return hashlib.sha256(location.read_bytes()).hexdigest()


def write(source, destination):
    payload = json.loads(Path(source).read_text())
    directory = Path(destination)
    directory.mkdir(parents=True, exist_ok=True)
    files = []
    for name, fields in SCHEMAS.items():
        rows = payload["tables"][name]
        columns = list(fields)
        if name in SPATIAL:
            columns += [("geometry", pa.binary()), ("geometry_json", pa.string())]
            converted = [{**{k: row.get(k) for k, _ in fields}, "geometry": wkb(row["geometry"]), "geometry_json": json.dumps(row["geometry"], separators=(",", ":"))} for row in rows]
        else:
            converted = [{k: row.get(k) for k, _ in fields} for row in rows]
        schema = pa.schema(columns)
        if name in SPATIAL:
            geo = {"version": "1.1.0", "primary_column": "geometry", "columns": {"geometry": {"encoding": "WKB", "geometry_types": sorted({r["geometry"]["type"] for r in rows})}}}
            schema = schema.with_metadata({b"geo": json.dumps(geo).encode()})
        location = directory / f"{name}.parquet"
        table = pa.Table.from_pylist(converted, schema=schema)
        pq.write_table(table, location, compression="snappy")
        if pq.read_table(location).to_pylist() != converted:
            raise ValueError(f"Parquet round-trip mismatch: {name}")
        files.append({"name": location.name, "rows": len(rows), "bytes": location.stat().st_size, "sha256": sha(location), "spatial": name in SPATIAL})
    manifest = {k: payload[k] for k in ("area_id", "bundle_version", "date", "created_at_utc", "components", "sources", "quality")}
    manifest.update({"files": files, "validation_status": "passed", "format": "GeoParquet 1.1 / Parquet", "round_trip_verified": True})
    (directory / "manifest.json").write_text(json.dumps(manifest, indent=2))
    return manifest


def read(directory):
    directory = Path(directory)
    manifest = json.loads((directory / "manifest.json").read_text())
    if manifest.get("validation_status") != "passed":
        raise ValueError("Bundle validation status is not passed")
    tables = {}
    for info in manifest["files"]:
        name = info["name"].removesuffix(".parquet")
        if name not in SCHEMAS or info["name"] != f"{name}.parquet":
            raise ValueError("Invalid table path")
        location = directory / info["name"]
        if sha(location) != info["sha256"]:
            raise ValueError("Parquet checksum mismatch")
        rows = pq.read_table(location).to_pylist()
        if len(rows) != info["rows"]:
            raise ValueError("Parquet row count mismatch")
        if name in SPATIAL:
            for row in rows:
                row.pop("geometry")
                row["geometry"] = json.loads(row.pop("geometry_json"))
        tables[name] = rows
    if set(tables) != set(SCHEMAS):
        raise ValueError("Incomplete CBD bundle")
    return {"manifest": manifest, "tables": tables}


if __name__ == "__main__":
    try:
        command = sys.argv[1]
        result = write(sys.argv[2], sys.argv[3]) if command == "write" else read(sys.argv[2]) if command == "read" else None
        if result is None:
            raise ValueError("Expected write or read")
        print(json.dumps(result, separators=(",", ":")))
    except Exception as error:
        print(f"CBD Parquet: {error}", file=sys.stderr)
        raise SystemExit(1)
