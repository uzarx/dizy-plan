import base64
from collections import Counter
import io
import json
from pathlib import Path
import sys
import threading
import unittest
import urllib.error
import urllib.request
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server
import launch


class CADTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = (server.ROOT / "examples/demo-plan.dxf").read_bytes()

    def test_demo_and_noop_preserve_cad_records(self):
        p = server.scene(self.data, "demo")
        self.assertGreater(len(p["entities"]), 10)
        self.assertFalse(p["warnings"])
        a = server.read_doc(self.data)
        b = server.export_doc(p)
        self.assertEqual(
            {e.dxf.handle for e in a.modelspace()},
            {e.dxf.handle for e in b.modelspace()},
        )
        self.assertEqual(
            {block.name for block in a.blocks}, {block.name for block in b.blocks}
        )

    def test_transform_delete_draw_note_roundtrip(self):
        p = server.scene(self.data, "demo")
        original = server.read_doc(self.data)
        block = next(iter(original.modelspace().query("INSERT")))
        line = next(iter(original.modelspace().query("LINE")))
        old = block.dxf.insert
        p["edits"] = {
            block.dxf.handle: {
                "dx": 300,
                "dy": -100,
                "rotation": 90,
                "center": [1000, 2000],
            },
            line.dxf.handle: {"deleted": True},
        }
        p["additions"] = [
            {"type": "rect", "points": [[100, 200], [500, 600]]},
            {"type": "line", "points": [[1, 2], [300, 400]]},
        ]
        p["notes"] = [{"p": [700, 800], "text": "Move the sofa."}]
        d = server.read_doc(server.doc_bytes(server.export_doc(p)))
        moved = d.entitydb[block.dxf.handle]
        self.assertAlmostEqual(moved.dxf.insert.x, 1000 - (old.y - 2000) + 300)
        self.assertAlmostEqual(moved.dxf.insert.y, 2000 + (old.x - 1000) - 100)
        self.assertAlmostEqual(moved.dxf.rotation % 360, 90)
        self.assertEqual(moved.dxf.name, block.dxf.name)
        self.assertNotIn(line.dxf.handle, {e.dxf.handle for e in d.modelspace()})
        self.assertEqual(len(d.modelspace().query('*[layer=="DIZY-EDIT"]')), 2)
        self.assertEqual(len(d.modelspace().query('*[layer=="DIZY-NOTES"]')), 2)
        self.assertFalse(d.audit().has_errors)
        self.assertEqual(
            self.data, (server.ROOT / "examples/demo-plan.dxf").read_bytes()
        )

    def test_invalid_coordinates_rejected(self):
        p = server.scene(self.data, "demo")
        p["edits"] = {p["entities"][0]["id"]: {"dx": float("nan")}}
        with self.assertRaises(ValueError):
            server.export_doc(p)


class HTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.http = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f"http://127.0.0.1:{cls.http.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        cls.thread.join(timeout=3)

    def request(self, path, data=None, headers=None):
        return urllib.request.urlopen(
            urllib.request.Request(self.url + path, data=data, headers=headers or {}),
            timeout=10,
        )

    def test_identity_demo_and_launcher_probe(self):
        with self.request("/api/info") as response:
            info = json.load(response)
        self.assertEqual(info["app"], "dizy-plan")
        self.assertEqual([p["id"] for p in info["plans"]], ["demo"])
        self.assertTrue(launch.probe(self.url))
        with self.request("/api/load", b'{"id":"demo"}') as response:
            p = json.load(response)
        self.assertTrue(base64.b64decode(p["source"]))

    def test_foreign_origin_and_host_blocked(self):
        for headers in [{"Host": "evil.example"}, {"Origin": "https://evil.example"}]:
            with self.subTest(headers=headers), self.assertRaises(
                urllib.error.HTTPError
            ) as cm:
                self.request("/api/load", b'{"id":"demo"}', headers)
            self.assertEqual(cm.exception.code, 403)

    def test_private_paths_and_unknown_ids_unavailable(self):
        with self.assertRaises(urllib.error.HTTPError) as cm:
            self.request("/server.py")
        self.assertEqual(cm.exception.code, 404)
        with self.assertRaises(urllib.error.HTTPError) as cm:
            self.request("/api/load", b'{"id":"../../private.dxf"}')
        self.assertEqual(cm.exception.code, 400)

    def test_import_and_export(self):
        data = (server.ROOT / "examples/demo-plan.dxf").read_bytes()
        with self.request("/api/import", data, {"X-Filename": "demo.dxf"}) as response:
            p = json.load(response)
        with self.request(
            "/api/export", json.dumps({"project": p, "format": "dxf"}).encode()
        ) as response:
            doc = server.read_doc(response.read())
        self.assertFalse(doc.audit().has_errors)


if __name__ == "__main__":
    unittest.main(verbosity=2)
