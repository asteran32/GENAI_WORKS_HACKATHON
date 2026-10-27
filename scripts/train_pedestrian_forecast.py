#!/usr/bin/env python3
"""Fit, backtest and publish December 2025 hourly pedestrian forecasts."""
import argparse
import json
from pathlib import Path
import sys
from fetch_pedestrian_history import REPO
from pedestrian_forecast import publish
if __name__=='__main__':
    import importlib.util, subprocess
    if importlib.util.find_spec('pyarrow') is None:
        candidates=[parent/'.venv/bin/python' for parent in [REPO,*REPO.parents]]
        interpreter=next((p for p in candidates if p.is_file() and subprocess.run([str(p),'-c','import pyarrow'],capture_output=True).returncode==0),None)
        if interpreter:
            sys.exit(subprocess.call([str(interpreter),__file__,*sys.argv[1:]]))

    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--date',default='2025-12-19');p.add_argument('--sync-zetaris',action='store_true');p.add_argument('--root',type=Path,default=REPO/'data/cool-sydney');args=p.parse_args()
    try:
        if args.sync_zetaris and args.root.resolve() != (REPO/'data/cool-sydney').resolve():
            raise ValueError('Zetaris sync supports the project data root only')
        manifest,report=publish(args.root,args.date)
        print(json.dumps({'manifest':manifest,'evaluation':report['test']},ensure_ascii=False,indent=2),flush=True)
        if args.sync_zetaris:
            result=subprocess.run([sys.executable,str(REPO/'scripts/register_zetaris.py'),'--date',args.date,'--sync'])
            if result.returncode:
                print('Forecast Parquet saved; Zetaris sync failed. Rerun register_zetaris.py --date '+args.date+' --sync.',file=sys.stderr)
                sys.exit(result.returncode)
    except (ValueError,OSError,KeyError,ImportError) as error:
        print('Forecast not published: '+str(error),file=sys.stderr);sys.exit(1)
