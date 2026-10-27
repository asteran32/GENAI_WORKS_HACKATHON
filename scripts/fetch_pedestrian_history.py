#!/usr/bin/env python3
"""Download monthly ArcGIS pages with resumable raw caches and verified row counts."""
import argparse
import hashlib
import json
import os
import ssl
from pathlib import Path
import sys
import time
from datetime import date, datetime, timedelta, timezone
from urllib.parse import urlencode
from urllib.request import urlopen, Request

REPO = Path(__file__).resolve().parents[1]
SOURCE = 'https://services1.arcgis.com/cNVyNtjGVZybOQWZ/ArcGIS/rest/services/Automatic_Hourly_Pedestrian_Count/FeatureServer/0'
SITES = ('A001', 'A002', 'A003', 'A004')
FIELDS = 'ObjectId,Location_code,Date,Hour,TotalCount'


def atomic_json(file, value):
    tmp = file.with_suffix(file.suffix + '.tmp')
    tmp.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')))
    tmp.replace(file)


def month_windows(start, end):
    cursor = date.fromisoformat(start)
    stop = date.fromisoformat(end) + timedelta(days=1)
    if cursor >= stop:
        raise ValueError('start must be on or before end')
    while cursor < stop:
        next_month = date(cursor.year + (cursor.month == 12), cursor.month % 12 + 1, 1)
        finish = min(next_month, stop)
        yield cursor.isoformat(), finish.isoformat()
        cursor = finish


def tls_context():
    explicit = os.environ.get('SSL_CERT_FILE')
    if explicit:
        return ssl.create_default_context(cafile=explicit)
    context = ssl.create_default_context()
    if not context.get_ca_certs():
        # python.org macOS installations may have no OpenSSL CA bundle until
        # Install Certificates.command runs. Use an existing verified CA store.
        for file in ('/etc/ssl/cert.pem', '/opt/homebrew/etc/openssl@3/cert.pem', '/usr/local/etc/openssl@3/cert.pem'):
            if Path(file).is_file():
                context.load_verify_locations(cafile=file)
                break
    return context


def request_json(params):
    url = SOURCE + '/query?' + urlencode(dict(params, f='json'))
    context = tls_context()
    for attempt in range(3):
        try:
            with urlopen(Request(url, headers={'User-Agent': 'CoolSydney research historical download'}), timeout=45, context=context) as response:
                raw = response.read(16 * 1024 * 1024 + 1)
            if len(raw) > 16 * 1024 * 1024:
                raise ValueError('ArcGIS response exceeds size limit')
            body = json.loads(raw)
            if 'error' in body:
                raise ValueError(f"ArcGIS error: {body['error']}")
            return body
        except (OSError, ValueError):
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def fetch_month(directory, start, stop, request=request_json):
    cache = directory / f'{start}_{stop}.json'
    # Completed caches are immutable for this run; no partial month is promoted.
    if cache.exists():
        envelope = json.loads(cache.read_text())
        data = envelope['data']
        digest = hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()
        if envelope.get('source') != SOURCE or envelope.get('start') != start or envelope.get('stop') != stop or envelope.get('sha256') != digest or len(data['features']) != envelope.get('expected_rows'):
            raise ValueError(f'Invalid cached month: {cache}. Move it aside and retry.')
        return envelope, cache
    where = f"Date >= TIMESTAMP '{start} 00:00:00' AND Date < TIMESTAMP '{stop} 00:00:00' AND Location_code IN ('A001','A002','A003','A004')"
    count = request({'where': where, 'returnCountOnly': 'true'}).get('count')
    if type(count) is not int or count < 0 or count > 20000:
        raise ValueError(f'Invalid source count for month {start}: {count}')
    records, seen = [], set()
    while len(records) < count:
        page = request({'where': where, 'outFields': FIELDS, 'orderByFields': 'ObjectId ASC',
                        'resultOffset': len(records), 'resultRecordCount': 2000, 'returnGeometry': 'false'})
        features = page.get('features')
        if not isinstance(features, list) or not features:
            raise ValueError(f'Incomplete pagination for {start}')
        for feature in features:
            identifier = feature.get('attributes', {}).get('ObjectId')
            if type(identifier) is not int or identifier in seen:
                raise ValueError(f'Duplicate/missing ObjectId in {start}; source may have changed')
            seen.add(identifier)
        records.extend(features)
        if len(records) > count:
            raise ValueError('Source count changed while downloading')
    if request({'where': where, 'returnCountOnly': 'true'}).get('count') != count:
        raise ValueError('Source count changed while downloading; retry this month')
    data = {'features': records}
    envelope = {'source': SOURCE, 'start': start, 'stop': stop, 'where': where, 'expected_rows': count,
                'collected_at_utc': datetime.now(timezone.utc).isoformat(),
                'sha256': hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest(), 'data': data}
    atomic_json(cache, envelope)
    return envelope, cache


def fetch_history(root, start='2020-02-01', end='2025-06-30', request=request_json):
    if start < '2020-02-01' or end > '2025-06-30':
        raise ValueError('This collector is scoped to published February 2020–June 2025 history')
    directory = root / 'raw/pedestrian-history'
    directory.mkdir(parents=True, exist_ok=True)
    files = []
    windows = list(month_windows(start, end))
    for index, (a, b) in enumerate(windows):
        envelope, file = fetch_month(directory, a, b, request)
        files.append({'name': file.name, 'rows': envelope['expected_rows'], 'sha256': hashlib.sha256(file.read_bytes()).hexdigest()})
        print(f"[{index+1}/{len(windows)}] {a}: {envelope['expected_rows']} rows (downloaded or verified cache)", flush=True)
    manifest = {'status': 'complete', 'source': SOURCE, 'start': start, 'end': end, 'sites': list(SITES),
                'rows': sum(f['rows'] for f in files), 'files': files, 'created_at_utc': datetime.now(timezone.utc).isoformat()}
    atomic_json(directory / 'manifest.json', manifest)
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=REPO / 'data/cool-sydney')
    parser.add_argument('--start', default='2020-02-01')
    parser.add_argument('--end', default='2025-06-30')
    args = parser.parse_args()
    try:
        result = fetch_history(args.root, args.start, args.end)
        print(f"COMPLETE {result['rows']} source rows. Raw history ready for training.")
    except (OSError, ValueError, KeyError) as error:
        print(f'History download incomplete: {error}\nCompleted months are cached; rerun the same command.', file=sys.stderr)
        sys.exit(1)
