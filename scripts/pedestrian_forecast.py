#!/usr/bin/env python3
"""Auditable calendar forecasting for four automatic counters; no LLM-generated counts."""
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import hashlib
import json
import math
from pathlib import Path
from fetch_pedestrian_history import SITES, SOURCE, atomic_json

ZONE = ZoneInfo('Australia/Sydney')
VERSION = 'calendar-shrinkage-v1'
LIMITATIONS = [
    'Four sensor locations only; passages/hour, not unique persons or city-wide demand',
    'Calendar model excludes weather, heatwave response, special events and explicit public holidays',
    'December 2025 has no observed counter targets; actual accuracy cannot be measured for that date',
    '90% intervals are empirical historical error bands, not guaranteed coverage after a distribution change',
    'Source Date is interpreted as local wall clock, corroborated by Hour; DST transition days excluded',
    'Pre-2022 COVID period, known A004 undercounts and suspected all-zero whole days excluded from fitting',
]


def integer(value):
    if isinstance(value, bool) or value is None or value == '': raise ValueError('Missing integer')
    number=float(value)
    if not math.isfinite(number) or int(number)!=number: raise ValueError('Invalid integer')
    return int(number)


def normalize(features):
    by_key={};conflicts=set();issues=Counter();source_ids=set()
    for feature in features:
        a=feature.get('attributes',{})
        try:
            site=a['Location_code'];oid=integer(a['ObjectId']);value=integer(a['TotalCount']);hour=integer(a['Hour'])
            stamp=datetime.fromtimestamp(integer(a['Date'])/1000,timezone.utc)
            if site not in SITES or value<0 or not 0<=hour<24 or stamp.hour!=hour or stamp.minute or stamp.second: raise ValueError('Invalid source row')
            if oid in source_ids: issues['duplicate_source_id']+=1;continue
            source_ids.add(oid)
            day=stamp.date();key=(site,day.isoformat(),hour)
            instant=datetime(day.year,day.month,day.day,hour,tzinfo=ZONE)
            tomorrow=day+timedelta(days=1)
            duration=(datetime.combine(tomorrow,datetime.min.time(),ZONE).astimezone(timezone.utc)-datetime.combine(day,datetime.min.time(),ZONE).astimezone(timezone.utc)).total_seconds()
            quality='reported'
            if duration!=86400:quality='dst-transition'
            if site=='A004' and '2022-07-03'<=day.isoformat()<='2022-11-11':quality='known-undercount'
            row={'site_id':site,'local_date':day.isoformat(),'hour':hour,'weekday':day.weekday(),'month':day.month,'day':day.day,
                 'instant_utc':instant.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z'),
                 'passages':value,'source_object_id':oid,'quality':quality,'evidence_type':'observed'}
            if key in by_key:conflicts.add(key);issues['duplicate_site_hour']+=1
            else:by_key[key]=row
        except (ValueError,KeyError,OverflowError,OSError):issues['invalid_source_row']+=1
    for key in conflicts:by_key[key]['quality']='duplicate-site-hour'
    days=defaultdict(list)
    for row in by_key.values():days[(row['site_id'],row['local_date'])].append(row)
    for values in days.values():
        if len(values)==24 and all(r['passages']==0 for r in values):
            for row in values:
                if row['quality']=='reported':row['quality']='suspected-all-zero-day'
    rows=sorted(by_key.values(),key=lambda r:(r['local_date'],r['hour'],r['site_id']))
    issues.update({q:count for q,count in Counter(r['quality'] for r in rows).items() if q!='reported'})
    return rows,dict(issues)


def load_history(root):
    directory=root/'raw/pedestrian-history';file=directory/'manifest.json'
    if not file.exists():raise ValueError('Run python3 scripts/fetch_pedestrian_history.py first; one day is insufficient.')
    manifest=json.loads(file.read_text())
    if manifest.get('status')!='complete' or manifest.get('end')<'2025-06-30' or manifest.get('start')>'2022-01-01':raise ValueError('Need complete requested history through June 2025, including 2022–2024.')
    features=[]
    for entry in manifest['files']:
        raw=(directory/entry['name']).read_bytes()
        if hashlib.sha256(raw).hexdigest()!=entry['sha256']:raise ValueError('History checksum mismatch: '+entry['name'])
        envelope=json.loads(raw)
        if len(envelope['data']['features'])!=entry['rows']:raise ValueError('History count mismatch')
        features.extend(envelope['data']['features'])
    if len(features)!=manifest['rows']:raise ValueError('History incomplete')
    rows,issues=normalize(features)
    digest=hashlib.sha256(json.dumps(manifest['files'],sort_keys=True).encode()).hexdigest()
    return rows,{'source':SOURCE,'source_hash':digest,'requested_start':manifest['start'],'requested_end':manifest['end'],
                 'source_rows':len(features),'normalized_rows':len(rows),'quality_exclusions':issues}


def key(*parts):return '|'.join(map(str,parts))
def phase(row):return 0 if row['month']!=12 else 1 if row['day']<15 else 2 if row['day']<24 else 3 if row['day']<27 else 4

def add(groups,k,value,weight):
    old=groups.setdefault(k,[0.0,0.0]);old[0]+=value*weight;old[1]+=weight

def mean(groups,k,fallback=0,prior=0):
    total,n=groups.get(k,(0,0));return (total+prior*fallback)/(n+prior) if n+prior else fallback


def fit(rows, cutoff, kind='seasonal', require_coverage=True):
    end=date.fromisoformat(cutoff);start=max(date(2022,1,1),end-timedelta(days=730))
    train=[r for r in rows if start.isoformat()<=r['local_date']<=cutoff and r['quality']=='reported']
    model={'version':VERSION,'kind':kind,'training_start':start.isoformat(),'training_cutoff':cutoff,'base':{},'month':{},'phase':{},'recent':{},'site':{},'level':{},'coverage':{}}
    recent=(end-timedelta(days=55)).isoformat()
    for site in SITES:
        subset=[r for r in train if r['site_id']==site];days={r['local_date'] for r in subset};recent_days={d for d in days if d>=recent}
        covered=Counter(r['month'] for r in subset)
        model['coverage'][site]={'rows':len(subset),'days':len(days),'recent_days':len(recent_days),'last_observed_date':max(days) if days else None,'months_present':sorted(covered)}
        if require_coverage and (len(days)<365 or len(recent_days)<28 or covered[12]<24*14):
            raise ValueError(f'Insufficient training coverage for {site} at {cutoff}: {model["coverage"][site]}')
    for row in train:
        age=(end-date.fromisoformat(row['local_date'])).days;weight=2**(-age/365)
        s,w,h=row['site_id'],row['weekday'],row['hour'];y=row['passages']
        add(model['site'],s,y,weight);add(model['base'],key(s,w,h),y,weight)
        add(model['month'],key(s,row['month'],w,h),y,weight)
        if row['month']==12:add(model['phase'],key(s,phase(row),w,h),y,weight)
        if row['local_date']>=recent:add(model['recent'],key(s,w,h),y,1)
    # Correct current level after accounting for the recent month's seasonal pattern.
    ratio=defaultdict(lambda:[0,0])
    for row in train:
        if row['local_date']>=recent:
            ratio[row['site_id']][0]+=row['passages'];ratio[row['site_id']][1]+=seasonal_value(model,row)
    model['level']={s:max(.5,min(2,a/b)) if b else 1 for s,(a,b) in ratio.items()}
    return model


def seasonal_value(model,row):
    s,w,h=row['site_id'],row['weekday'],row['hour']
    base=mean(model['base'],key(s,w,h),mean(model['site'],s))
    month=mean(model['month'],key(s,row['month'],w,h),base,4)
    return mean(model['phase'],key(s,phase(row),w,h),month,4) if row['month']==12 else month


def predict(model,row):
    s=row['site_id']
    if s not in model['coverage'] or not model['coverage'][s]['rows']:raise ValueError('Unknown or untrained site')
    if model['kind']=='baseline':
        result=mean(model['recent'],key(s,row['weekday'],row['hour']),mean(model['base'],key(s,row['weekday'],row['hour']),mean(model['site'],s)))
    else:result=seasonal_value(model,row)*model['level'].get(s,1)
    return max(0,result)


def metrics(pairs):
    if not pairs:return {'rows':0,'mae':None,'wape':None,'rmse':None}
    errors=[abs(y-p) for y,p in pairs];total=sum(y for y,p in pairs)
    return {'rows':len(pairs),'mae':sum(errors)/len(errors),'wape':sum(errors)/total if total else None,'rmse':math.sqrt(sum(e*e for e in errors)/len(errors))}


def holdout(rows,start,end):
    result=[r for r in rows if start<=r['local_date']<=end and r['quality']=='reported']
    expected_days=(date.fromisoformat(end)-date.fromisoformat(start)).days+1
    for site in SITES:
        subset=[r for r in result if r['site_id']==site]
        if len(subset)<expected_days*24*.7:raise ValueError(f'Insufficient holdout coverage: {site} {start}–{end}')
    return result


def quantile90(values):
    ordered=sorted(values);index=min(len(ordered)-1,math.ceil((len(ordered)+1)*.9)-1)
    if not ordered:raise ValueError('Missing calibration residuals')
    return ordered[index]


def bounds(point,q):
    width=q*math.sqrt(point+1);return max(0,point-width),point+width


def train_evaluate(rows):
    # Freeze model selection on early Dec 2023; calibrate on a separate later block.
    selection=holdout(rows,'2023-12-01','2023-12-14');calibration=holdout(rows,'2023-12-15','2023-12-31')
    candidates={kind:fit(rows,'2023-06-30',kind) for kind in ('baseline','seasonal')}
    scores={kind:metrics([(r['passages'],predict(model,r)) for r in selection]) for kind,model in candidates.items()}
    selected=min(scores,key=lambda k:scores[k]['mae'])
    residuals=defaultdict(list)
    for row in calibration:
        p=predict(candidates[selected],row);residuals[row['site_id']].append(abs(row['passages']-p)/math.sqrt(p+1))
    q={s:quantile90(residuals[s]) for s in SITES}
    # Untouched six-month-ahead test, never used to choose model or interval width.
    test=holdout(rows,'2024-12-01','2024-12-31');test_model=fit(rows,'2024-06-30',selected);baseline=fit(rows,'2024-06-30','baseline')
    predictions=[]
    for row in test:
        point=predict(test_model,row);lo,hi=bounds(point,q[row['site_id']]);predictions.append(dict(site_id=row['site_id'],instant_utc=row['instant_utc'],actual=row['passages'],prediction=point,lower90=lo,upper90=hi,baseline=predict(baseline,row)))
    overall=metrics([(r['actual'],r['prediction']) for r in predictions]);overall['interval_coverage90']=sum(r['lower90']<=r['actual']<=r['upper90'] for r in predictions)/len(predictions)
    overall['mean_interval_width']=sum(r['upper90']-r['lower90'] for r in predictions)/len(predictions)
    by_site={s:metrics([(r['actual'],r['prediction']) for r in predictions if r['site_id']==s]) for s in SITES}
    report={'selected_model':selected,'selection':{'cutoff':'2023-06-30','start':'2023-12-01','end':'2023-12-14','scores':scores},
            'calibration':{'start':'2023-12-15','end':'2023-12-31','nominal_coverage':.9,'scaled_absolute_error_q90':q},
            'test':{'cutoff':'2024-06-30','start':'2024-12-01','end':'2024-12-31','selected':overall,'baseline':metrics([(r['actual'],r['baseline']) for r in predictions]),'by_site':by_site}}
    final=fit(rows,'2025-06-30',selected)
    return final,q,report,predictions


def publish(root,target='2025-12-19'):
    import pyarrow as pa
    import pyarrow.parquet as pq
    day=date.fromisoformat(target)
    if not date(2025,12,1)<=day<=date(2025,12,31):raise ValueError('This version is validated for December 2025 forecasts only')
    rows,history=load_history(root)
    print(f"Loaded {len(rows)} unique site-hours; fitting and backtesting...",flush=True)
    model,q,report,backtest=train_evaluate(rows)
    identity={'model':model,'calibration':q,'source_hash':history['source_hash'],'target':target,'code_hash':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    model_id='ped-'+hashlib.sha256(json.dumps(identity,sort_keys=True).encode()).hexdigest()[:16]
    folder=root/'processed/pedestrian-forecasts'/model_id;folder.mkdir(parents=True,exist_ok=True)
    forecasts=[]
    for site in SITES:
        for hour in range(24):
            row={'site_id':site,'weekday':day.weekday(),'hour':hour,'month':day.month,'day':day.day}
            point=predict(model,row);lo,hi=bounds(point,q[site])
            instant=datetime(day.year,day.month,day.day,hour,tzinfo=ZONE).astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
            forecasts.append({'site_id':site,'instant_utc':instant,'local_date':target,'hour':hour,'predicted_passages':round(point,1),'lower90':round(lo,1),'upper90':round(hi,1),
                              'evidence_type':'forecast','model_id':model_id,'training_cutoff':'2025-06-30','forecast_horizon_days':(day-date(2025,6,30)).days})
    files=[]
    for name,values in [('pedestrian_history',rows),('pedestrian_forecasts',forecasts),('forecast_backtest',backtest)]:
        file=folder/(name+'.parquet');pq.write_table(pa.Table.from_pylist(values),file,compression='snappy')
        if pq.read_table(file).to_pylist()!=values:raise ValueError('Parquet round trip failed: '+name)
        files.append({'name':name+'.parquet','rows':len(values),'sha256':hashlib.sha256(file.read_bytes()).hexdigest()})
    atomic_json(folder/'model.json',identity)
    report.update(model_id=model_id,target_date=target,history=history,final_training_coverage=model['coverage'],limitations=LIMITATIONS)
    atomic_json(folder/'evaluation.json',report)
    manifest={'model_id':model_id,'date':target,'training_cutoff':'2025-06-30','files':files,'validation':'historical-holdout-evaluated',
              'test_mae':report['test']['selected']['mae'],'test_wape':report['test']['selected']['wape'],'interval_coverage90':report['test']['selected']['interval_coverage90'],
              'limitations':LIMITATIONS,'evidence_type':'forecast','created_at_utc':datetime.now(timezone.utc).isoformat()}
    atomic_json(folder/'manifest.json',manifest)
    atomic_json(folder.parent/(target+'.json'),{'model_id':model_id,'date':target})
    atomic_json(folder.parent/'current.json',{'model_id':model_id,'date':target})
    return manifest,report
