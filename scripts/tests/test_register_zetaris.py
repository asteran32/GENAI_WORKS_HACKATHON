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
            directory.joinpath("manifest.json").write_text(json.dumps({"files": files, "components": {"buildings": self.gis}}))

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
