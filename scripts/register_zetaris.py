#!/usr/bin/env python3
"""Register the current 12 Parquet tables through the shipped Zetaris JDBC driver.

No dependencies or API key. Run --prepare-only to validate inputs and write SQL.
Execution needs Docker access and a local JDK (javac). Does not create a UI VDM.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

REPO = Path(__file__).resolve().parents[1]
GIS = {"building", "transportation", "water", "landcover", "landuse", "poi"}
CBD = {"walk_nodes", "walk_edges", "trees", "pedestrian_sites", "pedestrian_counts", "weather"}


def read_json(path):
    return json.loads(path.read_text())


def plan(root):
    gis = read_json(root / "current.json")["version"]
    cbd = read_json(root / "bundles/current.json")["bundle_version"]
    if not re.fullmatch(r"ofm-[a-f0-9]{16}", gis) or not re.fullmatch(r"cbd-[a-f0-9]{16}", cbd):
        raise ValueError("Invalid dataset version")
    tables = []
    for directory, names in [(root / gis, GIS), (root / "bundles" / cbd, CBD)]:
        manifest = read_json(directory / "manifest.json")
        if directory.name == cbd and manifest["components"]["buildings"] != gis:
            raise ValueError("CBD bundle and building dataset versions do not match")
        seen = set()
        for entry in manifest["files"]:
            name = entry["name"].removesuffix(".parquet")
            if name not in names or name in seen or entry["name"] != name + ".parquet":
                raise ValueError("Unexpected or duplicate Parquet table")
            seen.add(name)
            file = directory / entry["name"]
            digest = hashlib.sha256(file.read_bytes()).hexdigest()
            if digest != entry["sha256"] or type(entry["rows"]) is not int or entry["rows"] < 0:
                raise ValueError(f"Invalid manifest or checksum: {file}")
            tables.append(dict(name=name, file=str(file.resolve()), rows=entry["rows"], sha256=digest))
        if seen != names:
            raise ValueError(f"Incomplete dataset: {directory}")
    tables.sort(key=lambda row: row["name"])
    identity = json.dumps([(t["name"], t["sha256"], t["rows"]) for t in tables])
    version = hashlib.sha256(identity.encode()).hexdigest()[:16]
    database = f"cool_sydney_{version}"
    destination = f"/home/zetaris/customer-data/shared/cool-sydney-registration/{version}"
    for table in tables:
        table["container_path"] = f"{destination}/{table['name']}.parquet"
    return dict(database=database, destination=destination, gis_version=gis, cbd_version=cbd, tables=tables)


def write_plan(p, output):
    output.mkdir(parents=True, exist_ok=True)
    sql = [f"CREATE LIGHTNING DATABASE {p['database']};"]
    for t in p["tables"]:
        sql.append(f'CREATE LIGHTNING FILESTORE TABLE {t["name"]} FROM {p["database"]} FORMAT PARQUET OPTIONS (path "{t["container_path"]}");')
    sql += [f"SELECT COUNT(*) AS row_count FROM {p['database']}.{t['name']};" for t in p["tables"]]
    (output / "register.sql").write_text("\n\n".join(sql) + "\n")
    (output / "plan.json").write_text(json.dumps(p, indent=2) + "\n")
    (output / "tables.tsv").write_text("".join(f"{t['name']}\t{t['rows']}\t{t['container_path']}\t{t['sha256']}\n" for t in p["tables"]))


def run(*args, timeout=120):
    return subprocess.run(args, check=True, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout).stdout


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--prepare-only", action="store_true")
    ap.add_argument("--platform", type=Path, help="Directory containing the installed zetaris-platform/jdbc")
    ap.add_argument("--container", default="zetaris-driver-1")
    args = ap.parse_args()
    p = plan(REPO / "data/cool-sydney/processed")
    output = REPO / "data/cool-sydney/zetaris-registration" / p["database"]
    write_plan(p, output)
    print(f"Plan: {p['database']} / {len(p['tables'])} tables\nSQL: {output / 'register.sql'}", flush=True)
    if args.prepare_only:
        print("Prepared only. Nothing has been registered in Zetaris.")
        return
    # Inspect only state: a full docker inspect contains administrator credentials.
    state = json.loads(run("docker", "inspect", "--format", "{{json .State}}", args.container))
    if state.get("Status") != "running" or state.get("Health", {}).get("Status") != "healthy":
        raise RuntimeError("Zetaris driver is not healthy. Start it and retry; no data was changed.")
    platform = args.platform
    if platform is None:
        platform = next((parent / "zetaris-platform" for parent in [REPO, *REPO.parents]
                         if (parent / "zetaris-platform/jdbc").is_dir()), None)
    jars = sorted((platform / "jdbc").glob("ndp-jdbc-driver-*-driver.jar")) if platform else []
    if len(jars) != 1:
        raise RuntimeError("Specify --platform with exactly one shipped JDBC driver jar in jdbc/.")
    # Compile standard JDBC code locally. Credentials are read only inside the container.
    with tempfile.TemporaryDirectory(prefix="cool-zetaris-") as temp:
        stage = Path(temp)
        run("javac", "-source", "8", "-target", "8", "-d", temp,
            str(REPO / "scripts/zetaris/RegisterParquet.java"))
        shutil.copy2(jars[0], stage / "jdbc.jar")
        shutil.copy2(output / "tables.tsv", stage / "tables.tsv")
        for table in p["tables"]:
            shutil.copy2(table["file"], stage / (table["name"] + ".parquet"))
        # Content-addressed directory is dedicated to this registration. Existing,
        # identical files can be recopied on retry; no volumes or tables are deleted.
        for file in stage.iterdir():
            file.chmod(0o644)
        run("docker", "exec", args.container, "mkdir", "-p", p["destination"])
        run("docker", "cp", temp + "/.", f"{args.container}:{p['destination']}")
    print("Files copied. Registering tables and checking SQL row counts...", flush=True)
    result = run("docker", "exec", args.container, "java", "-Xmx256m", "-cp",
                 p["destination"] + ":" + p["destination"] + "/jdbc.jar", "RegisterParquet",
                 p["database"], p["destination"] + "/tables.tsv", timeout=1200)
    print(result, end="")
    marker = f"VERIFIED {p['database']} 12"
    if marker not in result.splitlines():
        raise RuntimeError("JDBC runner did not confirm all 12 tables")
    (output / "verified.json").write_text(json.dumps({"database": p["database"], "tables": 12, "sql_row_counts_verified": True}, indent=2) + "\n")
    print("Registration verified. Refresh Virtual File Sources in Zetaris.")
    print("UI Data Mart creation and dashboard query migration are separate steps.")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as error:
        print((error.stdout or "") + (error.stderr or ""), file=sys.stderr)
        print("Registration did not complete. Fix the error above and rerun the same command.", file=sys.stderr)
        sys.exit(1)
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.TimeoutExpired) as error:
        print(f"Registration did not complete: {error}", file=sys.stderr)
        sys.exit(1)
