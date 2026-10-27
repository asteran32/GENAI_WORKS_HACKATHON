import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parents[1]))
import json
import tempfile
import unittest
from datetime import datetime, timezone, date, timedelta
from pedestrian_forecast import normalize, fit, predict, metrics, bounds, quantile90
from fetch_pedestrian_history import fetch_month, month_windows, tls_context
import ssl

def feature(oid=1, site='A001', day='2025-01-15', hour=8, value=100):
    stamp=int(datetime.fromisoformat(day+f'T{hour:02}:00:00+00:00').timestamp()*1000)
    return {'attributes':{'ObjectId':oid,'Location_code':site,'Date':stamp,'Hour':hour,'TotalCount':value}}

class ForecastTests(unittest.TestCase):
    def test_null_count_is_not_zero_and_dst_and_undercount_are_flagged(self):
        rows,issues=normalize([feature(value=None),feature(oid=2,value=0),feature(oid=3,day='2025-04-06'),feature(oid=4,site='A004',day='2022-08-01')])
        self.assertEqual(len(rows),3)
        self.assertEqual(issues['invalid_source_row'],1)
        self.assertEqual(set(r['quality'] for r in rows),{'reported','dst-transition','known-undercount'})
        reported=next(r for r in rows if r['quality']=='reported')
        self.assertEqual(reported['passages'],0)
        self.assertEqual(reported['instant_utc'],'2025-01-14T21:00:00.000Z')

    def test_duplicate_hours_not_summed_and_zero_days_flagged(self):
        rows,issues=normalize([feature(),feature(oid=2,value=200)])
        self.assertEqual(len(rows),1);self.assertEqual(rows[0]['quality'],'duplicate-site-hour')
        rows,_=normalize([feature(oid=h+1,hour=h,value=0) for h in range(24)])
        self.assertTrue(all(r['quality']=='suspected-all-zero-day' for r in rows))

    def test_training_has_no_future_target_leakage(self):
        features=[feature(oid=i+1,day=(date(2025,1,1)+timedelta(days=i)).isoformat(),value=100+i%7) for i in range(180)]
        rows,_=normalize(features)
        first=fit(rows,'2025-06-30','baseline',require_coverage=False)
        future,_=normalize([feature(oid=9999,day='2025-12-19',value=9999999)])
        second=fit(rows+future,'2025-06-30','baseline',require_coverage=False)
        self.assertEqual(first,second)
        self.assertLess(predict(first,{'site_id':'A001','weekday':4,'hour':8,'month':12,'day':19}),200)
        with self.assertRaisesRegex(ValueError,'Insufficient training coverage'):fit(rows,'2025-06-30')

    def test_interval_nonnegative_and_metrics_not_mape(self):
        self.assertEqual(metrics([(0,10),(100,90)])['wape'],.2)
        lo,hi=bounds(2,100);self.assertEqual(lo,0);self.assertGreater(hi,2)
        self.assertEqual(quantile90(list(range(10))),9)

    def test_collector_resumes_only_complete_verified_month(self):
        with tempfile.TemporaryDirectory() as temp:
            directory=Path(temp);calls=[]
            def request(params):
                calls.append(params)
                return {'count':1} if 'returnCountOnly' in params else {'features':[feature()]}
            data,file=fetch_month(directory,'2025-01-01','2025-02-01',request)
            self.assertEqual(data['expected_rows'],1)
            again,_=fetch_month(directory,'2025-01-01','2025-02-01',lambda p:self.fail('cache must be used'))
            self.assertEqual(data,again)
            obj=json.loads(file.read_text());obj['data']['features'][0]['attributes']['TotalCount']=999;file.write_text(json.dumps(obj))
            with self.assertRaisesRegex(ValueError,'Invalid cached month'):fetch_month(directory,'2025-01-01','2025-02-01',request)

    def test_collector_rejects_pagination_loss_and_keeps_tls_verification(self):
        with tempfile.TemporaryDirectory() as temp:
            def request(p):return {'count':3} if 'returnCountOnly' in p else {'features':[]}
            with self.assertRaisesRegex(ValueError,'Incomplete pagination'):fetch_month(Path(temp),'2025-01-01','2025-02-01',request)
            self.assertFalse(list(Path(temp).glob('*.json')))
        context=tls_context();self.assertEqual(context.verify_mode,ssl.CERT_REQUIRED);self.assertTrue(context.check_hostname)
        self.assertEqual(len(list(month_windows('2020-02-01','2025-06-30'))),65)

if __name__=='__main__':unittest.main()
