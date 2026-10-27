import importlib.util
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("register_zetaris", Path(__file__).parents[1] / "register_zetaris.py")
registration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(registration)


class RegistrationPlanTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.gis = "ofm-0123456789abcdef"
        self.cbd = "cbd-fedcba9876543210"
        self.root.joinpath("bundles").mkdir()
        self.root.joinpath("current.json").write_text(json.dumps({"version": self.gis}))
        self.root.joinpath("bundles/current.json").write_text(json.dumps({"bundle_version": self.cbd}))
        for directory, names in [(self.root / self.gis, registration.GIS),
                                 (self.root / "bundles" / self.cbd, registration.CBD)]:
            directory.mkdir()
            files = []
            for name in sorted(names):
                content = ("fixture-" + name).encode()
                directory.joinpath(name + ".parquet").write_bytes(content)
                files.append(dict(name=name + ".parquet", rows=1, sha256=hashlib.sha256(content).hexdigest()))
            directory.joinpath("manifest.json").write_text(json.dumps({"files": files, "components": {"buildings": self.gis}, "date":"2025-12-19"}))

    def add_supplement(self, kind):
        version = ('ped-' if kind=='forecast' else 'survey-') + '0123456789abcdef'
        directory = self.root / ('pedestrian-forecasts' if kind=='forecast' else 'walking-surveys')
        folder = directory / version
        folder.mkdir(parents=True)
        pointer = directory / ('2025-12-19.json' if kind=='forecast' else 'current.json')
        pointer.write_text(json.dumps({'model_id':version} if kind=='forecast' else {'version':version}))
        names = ['pedestrian_forecasts','pedestrian_history','forecast_backtest'] if kind=='forecast' else ['walking_counts_0','walking_sites_1']
        entries=[]
        for name in names:
            data=name.encode();(folder/(name+'.parquet')).write_bytes(data)
            entries.append({'name':name+'.parquet','rows':5,'sha256':hashlib.sha256(data).hexdigest(),'source_fields':[],'source_url':'https://example.com/survey'})
        (folder/'manifest.json').write_text(json.dumps({'date':'2025-12-19','version':version,'files':entries}))
        return folder

    def test_sync_discovers_all_saved_datasets_and_changes_database(self):
        initial=registration.plan(self.root,sync=True)
        self.assertEqual(len(initial['tables']),12)
        self.assertEqual(len(initial['skipped']),2)
        self.add_supplement('forecast');self.add_supplement('survey')
        p=registration.plan(self.root,sync=True)
        self.assertEqual(len(p['tables']),17)
        self.assertNotEqual(p['database'],initial['database'])
        self.assertEqual(p['skipped'],[])
        self.assertIn('survey_walking_counts_0',{t['name'] for t in p['tables']})
        self.assertEqual(p,registration.plan(self.root,sync=True))

    def test_sync_rejects_damaged_supplement_and_unsafe_survey_filename(self):
        folder=self.add_supplement('survey')
        manifest=json.loads((folder/'manifest.json').read_text())
        manifest['files'][0]['name']='../../escape.parquet'
        (folder/'manifest.json').write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError,'Unsafe'):registration.plan(self.root,sync=True)

    def test_catalog_activation_validates_database_and_is_explicit(self):
        candidate=self.root/'candidate.json';active=self.root/'active.json'
        candidate.write_text(json.dumps({'database':'new'}));active.write_text(json.dumps({'database':'old'}))
        with self.assertRaises(ValueError):registration.activate_catalog(candidate,active,'wrong')
        self.assertEqual(json.loads(active.read_text())['database'],'old')
        registration.activate_catalog(candidate,active,'new')
        self.assertEqual(json.loads(active.read_text())['database'],'new')

    def test_complete_plan_and_sql(self):
        plan = registration.plan(self.root)
        self.assertEqual(len(plan["tables"]), 12)
        self.assertEqual(plan, registration.plan(self.root))
        registration.write_plan(plan, self.root / "output")
        sql = self.root.joinpath("output/register.sql").read_text()
        self.assertEqual(sql.count("CREATE LIGHTNING FILESTORE TABLE"), 12)
        self.assertEqual(sql.count("SELECT COUNT(*)"), 12)
        self.assertNotIn("DROP ", sql)
        self.assertNotIn("/Users/", sql)

    def test_explicit_date_pins_retained_bundle_without_changing_current(self):
        manifest = self.root / 'bundles' / self.cbd / 'manifest.json'
        value = json.loads(manifest.read_text())
        value['date'] = '2025-12-19'
        manifest.write_text(json.dumps(value))
        self.root.joinpath('bundles/current.json').write_text(json.dumps({'bundle_version':'cbd-aaaaaaaaaaaaaaaa'}))
        result = registration.plan(self.root, '2025-12-19')
        self.assertEqual(result['cbd_version'], self.cbd)
        self.assertEqual(json.loads(self.root.joinpath('bundles/current.json').read_text())['bundle_version'], 'cbd-aaaaaaaaaaaaaaaa')
        with self.assertRaisesRegex(ValueError, 'No downloaded bundle'):
            registration.plan(self.root, '2025-12-18')
        with self.assertRaises(ValueError):
            registration.plan(self.root, '2025-02-30')

    def test_rejects_modified_file(self):
        self.root.joinpath(self.gis, "building.parquet").write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "checksum"):
            registration.plan(self.root)

    def test_rejects_mixed_dataset_versions(self):
        path = self.root / "bundles" / self.cbd / "manifest.json"
        value = json.loads(path.read_text())
        value["components"]["buildings"] = "ofm-aaaaaaaaaaaaaaaa"
        path.write_text(json.dumps(value))
        with self.assertRaisesRegex(ValueError, "versions"):
            registration.plan(self.root)

    def test_rejects_missing_table_and_unsafe_path(self):
        path = self.root / self.gis / "manifest.json"
        value = json.loads(path.read_text())
        value["files"].pop()
        path.write_text(json.dumps(value))
        with self.assertRaisesRegex(ValueError, "Incomplete"):
            registration.plan(self.root)
        value["files"][0]["name"] = "../../other.parquet"
        path.write_text(json.dumps(value))
        with self.assertRaisesRegex(ValueError, "Unexpected"):
            registration.plan(self.root)


if __name__ == "__main__":
    unittest.main()
