#!/usr/bin/env python3
"""Discover City of Sydney walking-survey services; preserve raw fields and Parquet."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from fetch_pedestrian_history import REPO, tls_context, atomic_json

BASE = 'https://services1.arcgis.com/cNVyNtjGVZybOQWZ/ArcGIS/rest/services'


def get(url, params=None):
    request = Request(url + '?' + urlencode(dict(params or {}, f='json')), headers={'User-Agent':'CoolSydney walking survey research'})
    with urlopen(request, context=tls_context(), timeout=90) as response:
        raw = response.read(32*1024*1024+1)
    if len(raw)>32*1024*1024:
        raise ValueError('Source page too large')
    result=json.loads(raw)
    if 'error' in result: raise ValueError(str(result['error']))
    return result


def download(root):
    raw=root/'raw/walking-surveys';raw.mkdir(parents=True,exist_ok=True)
    services=get(BASE)
    atomic_json(raw/'service-directory.json',services)
    candidates=[]
    for item in services.get('services',[]):
        key=re.sub('[^a-z]','',item['name'].lower())
        if 'walking' in key and 'count' in key and 'automatic' not in key and item.get('type')=='FeatureServer':
            candidates.append(item)
    if not candidates: raise ValueError('No walking survey FeatureServer found; inspect raw/walking-surveys/service-directory.json')
    entries=[]
    for service in candidates:
        url=BASE+'/'+service['name']+'/FeatureServer'
        info=get(url)
        for layer in info.get('layers',[])+info.get('tables',[]):
            source=url+'/'+str(layer['id']);metadata=get(source)
            slug=re.sub('[^a-z0-9_]+','_',service['name'].lower())+'_'+str(layer['id'])
            cache=raw/(slug+'.json')
            if cache.exists():
                data=json.loads(cache.read_text())
                if data.get('source')!=source or len(data.get('features',[]))!=data.get('expected_rows'): raise ValueError('Invalid cached source '+slug)
            else:
                count=get(source+'/query',{'where':'1=1','returnCountOnly':'true'}).get('count')
                if type(count) is not int or count<0 or count>2000000: raise ValueError('Unexpected source row count')
                oid=metadata.get('objectIdField') or next((f['name'] for f in metadata['fields'] if f['type']=='esriFieldTypeOID'),None)
                if not oid: raise ValueError('Missing object ID field')
                features=[];seen=set()
                while len(features)<count:
                    result=get(source+'/query',{'where':'1=1','outFields':'*','outSR':4326,'returnGeometry':'true','orderByFields':oid+' ASC','resultOffset':len(features),'resultRecordCount':min(2000,metadata.get('maxRecordCount',2000))})
                    page=result.get('features')
                    if not page: raise ValueError('Incomplete source pagination')
                    for row in page:
                        key=row.get('attributes',{}).get(oid)
                        if key is None or key in seen: raise ValueError('Duplicate source ID during pagination')
                        seen.add(key)
                    features.extend(page)
                    print(f'{slug}: {len(features)}/{count}',flush=True)
                if len(features)!=count or get(source+'/query',{'where':'1=1','returnCountOnly':'true'}).get('count')!=count: raise ValueError('Source changed during download; retry')
                data={'source':source,'metadata':metadata,'expected_rows':count,'collected_at_utc':datetime.now(timezone.utc).isoformat(),'features':features}
                atomic_json(cache,data)
            entries.append({'name':slug,'file':cache.name,'rows':data['expected_rows'],'sha256':hashlib.sha256(cache.read_bytes()).hexdigest(),'source':source})
    manifest={'status':'complete','sources':entries,'created_at_utc':datetime.now(timezone.utc).isoformat()}
    atomic_json(raw/'manifest.json',manifest)
    return manifest


def export(root):
    import pyarrow as pa
    import pyarrow.parquet as pq
    raw=root/'raw/walking-surveys';manifest=json.loads((raw/'manifest.json').read_text())
    if manifest.get('status')!='complete': raise ValueError('Incomplete survey download')
    version='survey-'+hashlib.sha256(json.dumps(manifest['sources'],sort_keys=True).encode()).hexdigest()[:16]
    folder=root/'processed/walking-surveys'/version;folder.mkdir(parents=True,exist_ok=True)
    files=[]
    for entry in manifest['sources']:
        cache=raw/entry['file']
        if hashlib.sha256(cache.read_bytes()).hexdigest()!=entry['sha256']: raise ValueError('Raw checksum mismatch')
        data=json.loads(cache.read_text());fields=data['metadata']['fields']
        schema_fields=[]
        for f in fields:
            kind=f['type']
            dtype=pa.int64() if kind in ('esriFieldTypeOID','esriFieldTypeInteger','esriFieldTypeSmallInteger','esriFieldTypeDate') else pa.float64() if kind in ('esriFieldTypeDouble','esriFieldTypeSingle') else pa.string()
            schema_fields.append(pa.field(f['name'],dtype))
        schema_fields += [pa.field('source_geometry_json',pa.string()),pa.field('source_url',pa.string()),pa.field('evidence_type',pa.string())]
        rows=[]
        for feature in data['features']:
            row={f['name']:feature.get('attributes',{}).get(f['name']) for f in fields}
            row.update(source_geometry_json=json.dumps(feature.get('geometry')),source_url=entry['source'],evidence_type='periodic-survey-reported')
            rows.append(row)
        file=folder/(entry['name']+'.parquet');table=pa.Table.from_pylist(rows,schema=pa.schema(schema_fields));pq.write_table(table,file,compression='snappy')
        if pq.read_table(file).num_rows!=entry['rows']:raise ValueError('Parquet round trip mismatch')
        files.append({'name':file.name,'rows':len(rows),'sha256':hashlib.sha256(file.read_bytes()).hexdigest(),'source_url':entry['source'],'source_fields':fields,
                      'date_field_ranges':{f['name']:{'min':min(v),'max':max(v),'encoding':'source epoch milliseconds; timezone interpretation pending'} for f in fields if f['type']=='esriFieldTypeDate' and (v:=[r[f['name']] for r in rows if r[f['name']] is not None])}})
    output={'version':version,'files':files,'limitations':['Survey-day counts are not daily continuous observations','Source numeric values are preserved; do not multiply by six again without checking field meaning','Spatial locations may change between surveys','Future surveys must be excluded when analysing 2025-12-19']}
    atomic_json(folder/'manifest.json',output);atomic_json(folder.parent/'current.json',{'version':version})
    print(json.dumps(output,ensure_ascii=False,indent=2))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--root',type=Path,default=REPO/'data/cool-sydney');parser.add_argument('--export-only',action='store_true');parser.add_argument('--sync-zetaris',action='store_true');parser.add_argument('--analysis-date',default='2025-12-19');args=parser.parse_args()
    try:
        if not args.export_only: download(args.root)
        try:
            import pyarrow
        except ImportError:
            python=next((p/'.venv/bin/python' for p in [REPO,*REPO.parents] if (p/'.venv/bin/python').is_file() and subprocess.run([str(p/'.venv/bin/python'),'-c','import pyarrow'],capture_output=True).returncode==0),None)
            if python is None: raise ValueError('Raw download complete; use project Python with PyArrow and --export-only')
            subprocess.run([str(python),__file__,'--root',str(args.root),'--export-only'],check=True)
        else: export(args.root)
        if args.sync_zetaris:
            if args.root.resolve() != (REPO/'data/cool-sydney').resolve():raise ValueError('Zetaris sync supports the project data root only')
            result=subprocess.run([sys.executable,str(REPO/'scripts/register_zetaris.py'),'--date',args.analysis_date,'--sync'])
            if result.returncode:
                print('Survey Parquet saved; Zetaris sync failed. Rerun registration separately.',file=sys.stderr)
                sys.exit(result.returncode)
    except (OSError,ValueError,KeyError,subprocess.CalledProcessError) as error:
        print('Survey import incomplete: '+str(error),file=sys.stderr);sys.exit(1)
