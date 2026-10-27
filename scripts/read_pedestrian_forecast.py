#!/usr/bin/env python3
import hashlib
import json
from pathlib import Path
import re
import sys
import pyarrow.parquet as pq
root=Path(sys.argv[1]);day=sys.argv[2]
if not re.fullmatch(r'20\d{2}-\d{2}-\d{2}',day):raise ValueError('Invalid date')
base=root/'processed/pedestrian-forecasts';pointer=base/(day+'.json')
if not pointer.exists():
 print(json.dumps({'ready':False,'date':day,'rows':[]}));sys.exit(0)
version=json.loads(pointer.read_text())['model_id']
if not re.fullmatch('ped-[a-f0-9]{16}',version):raise ValueError('Invalid model ID')
folder=base/version;manifest=json.loads((folder/'manifest.json').read_text())
file=folder/'pedestrian_forecasts.parquet';entry=next(f for f in manifest['files'] if f['name']==file.name)
if hashlib.sha256(file.read_bytes()).hexdigest()!=entry['sha256']:raise ValueError('Forecast Parquet hash mismatch')
rows=pq.read_table(file).to_pylist()
if len(rows)!=entry['rows'] or any(r['evidence_type']!='forecast' or r['local_date']!=day or r['model_id']!=version for r in rows):raise ValueError('Forecast provenance mismatch')
print(json.dumps({'ready':True,'date':day,'read_source':'local-parquet','manifest':manifest,'rows':rows}))
