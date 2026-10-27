#!/usr/bin/env python3
"""Prepare the published WSU Stream 1 CSV for point-only CBD map observations."""

import csv
import hashlib
import json
import math
import os
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "data" / "cool-sydney"
RAW_NAME = "Stream1_Temperature_Sydney_20231209_20240306.csv"
SOURCE = "https://research-data.westernsydney.edu.au/published/9bc62c10d22a11efab80570ec596f9e9/"
AREA = {"west": 151.188, "south": -33.885, "east": 151.228, "north": -33.848}
START, END = "2023-12-09", "2024-03-06"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def prepare(source):
    raw = source.read_bytes()
    rows = list(csv.reader(raw.decode("utf-8-sig").splitlines()))
    if len(rows) < 100 or rows[0][1] != "Logger ID" or rows[15][:2] != ["Date", "Time"]:
        raise ValueError("WSU Stream 1 기온 CSV 형식이 아닙니다.")
    width = len(rows[0])
    if any(len(row) != width for row in rows):
        raise ValueError("원본 CSV 열 수가 일치하지 않습니다.")
    if [rows[i][1] for i in [1, 2, 3, 4]] != ["Street", "Suburb", "Latitude", "Longitude"]:
        raise ValueError("기온 센서 위치 메타데이터가 없습니다.")

    sites = []
    columns = {}
    for col in range(2, width):
        sensor_id = rows[0][col].strip()
        if not sensor_id:
            continue
        try:
            lat, lon = float(rows[3][col]), float(rows[4][col])
        except ValueError:
            continue
        if not (math.isfinite(lat) and math.isfinite(lon) and AREA["south"] <= lat <= AREA["north"] and AREA["west"] <= lon <= AREA["east"]):
            continue
        note = rows[7][col].strip()
        if "ground" in note.lower() or "exclude" in note.lower():
            continue
        if sensor_id in columns:
            raise ValueError(f"중복 기온 센서 ID: {sensor_id}")
        columns[sensor_id] = col
        sites.append({"id": sensor_id, "street": rows[1][col].strip(), "suburb": rows[2][col].strip(), "lat": lat, "lon": lon, "notes": note or None})
    if not 5 <= len(sites) <= 100:
        raise ValueError("CBD 범위의 기온 센서 수가 예상 범위를 벗어났습니다.")

    totals = defaultdict(lambda: [0.0, 0])
    instants = set()
    raw_values = 0
    for row in rows[16:]:
        if not row[0] and not row[1]:
            continue
        try:
            date = datetime.strptime(row[0], "%d/%m/%Y").strftime("%Y-%m-%d")
            hour, minute = map(int, row[1].split(":"))
        except (ValueError, IndexError) as exc:
            raise ValueError(f"잘못된 기온 측정 시각: {row[:2]}") from exc
        if not (START <= date <= END and 0 <= hour < 24 and minute in range(0, 60, 10)):
            raise ValueError(f"자료 기간 밖 또는 10분 격자가 아닌 시각: {row[:2]}")
        instant = (date, hour, minute)
        if instant in instants:
            raise ValueError(f"중복 기온 측정 시각: {row[:2]}")
        instants.add(instant)
        for site in sites:
            value = row[columns[site["id"]]].strip()
            if not value:
                continue
            try:
                temperature = float(value)
            except ValueError:
                continue
            if not math.isfinite(temperature) or not -10 <= temperature <= 60:
                continue
            slot = totals[(date, hour, site["id"])]
            slot[0] += temperature
            slot[1] += 1
            raw_values += 1
    if len(instants) < 10000 or raw_values < 10000:
        raise ValueError("기온 CSV가 불완전합니다.")

    series = {}
    hourly_rows = 0
    for (date, hour, sensor_id), (sum_temperature, samples) in sorted(totals.items()):
        if samples < 4:  # A partial hour is missing, never silently filled.
            continue
        series.setdefault(date, [[] for _ in range(24)])[hour].append([sensor_id, round(sum_temperature / samples, 2), samples])
        hourly_rows += 1
    version = "micro-" + digest((digest(raw) + ":hourly-mean-min4-v1:CBD").encode())[:16]
    payload = {"sites": sites, "series": series}
    content = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
    manifest = {
        "version": version, "source": SOURCE, "source_file": RAW_NAME,
        "input_csv_sha256": digest(raw), "processed_sha256": digest(content),
        "license": "CC BY 4.0 · Pfautsch, Wujeska-Klause, Walters (2025), Western Sydney University · doi:10.26183/ms0d-4p25",
        "start_date": min(series), "end_date": max(series), "time_zone": "Australia/Sydney (AEDT, UTC+11 throughout source period)",
        "method": "point observations; hourly mean of at least four valid 10-minute air-temperature samples",
        "site_count": len(sites), "source_instants": len(instants), "valid_source_values": raw_values, "hourly_rows": hourly_rows,
        "limitations": ["Sensors were mounted on trees, usually 2.5–3.0 m above ground; these are not road-surface temperatures.", "Measurements are sparse sites, not temperatures for every street segment.", "The historical observation date remains separate from the simulator scenario date."],
    }
    provenance = source.with_suffix(".provenance.json")
    if provenance.is_file():
        manifest["retrieval"] = json.loads(provenance.read_text(encoding="utf-8"))
    return manifest, content


def main():
    source = Path(sys.argv[1]).expanduser().resolve() if len(sys.argv) > 1 else ROOT / "raw" / "microclimate" / RAW_NAME
    if not source.is_file():
        raise SystemExit(f"원본 CSV가 없습니다: {source}\n공식 자료: {SOURCE}")
    manifest, content = prepare(source)
    bundles = ROOT / "processed" / "microclimate"
    bundle = bundles / manifest["version"]
    bundle.mkdir(parents=True, exist_ok=True)
    (bundle / "hourly.json").write_bytes(content)
    (bundle / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    pointer = bundles / "current.json"
    temporary = bundles / f".current.{os.getpid()}.tmp"
    temporary.write_text(json.dumps({"version": manifest["version"]}), encoding="utf-8")
    temporary.replace(pointer)
    print(json.dumps(manifest, ensure_ascii=False))


if __name__ == "__main__":
    main()
