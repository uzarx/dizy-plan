#!/usr/bin/env python3
"""Dizy Plan — loopback-only CAD editor. Original CAD records survive editing."""
from pathlib import Path
import sys, os

ROOT = Path(__file__).resolve().parent
os.environ.setdefault("XDG_CACHE_HOME", str(ROOT / "data" / "cache"))
import base64, io, json, math, mimetypes, shutil, subprocess, tempfile, threading, time, zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse
import ezdxf
from ezdxf import path as cadpath
from ezdxf.math import Matrix44
from ezdxf.disassemble import recursive_decompose

APP_ID = "dizy-plan"
VERSION = "0.1.0"
CONVERT_LOCK = threading.Lock()
# Only a synthetic public example is bundled. User plans are opened via upload.
PLANS = [("demo", "Demo · ikki xonali kvartira", "examples/demo-plan.dxf")]


def converter():
    """Find a separately installed ODA converter, without bundling its binaries."""
    candidates = [
        os.environ.get("ODA_CONVERTER", ""),
        shutil.which("ODAFileConverter") or "",
        shutil.which("ODAFileConverter.exe") or "",
    ]
    if sys.platform == "darwin":
        for folder in (Path("/Applications"), Path.home() / "Applications"):
            if folder.exists():
                candidates.extend(
                    str(p)
                    for p in folder.glob(
                        "ODAFileConverter*.app/Contents/MacOS/ODAFileConverter"
                    )
                )
    elif os.name == "nt":
        for key in ("ProgramFiles", "ProgramFiles(x86)"):
            folder = Path(os.environ.get(key, "C:/Program Files"))
            if folder.exists():
                candidates.extend(
                    str(p)
                    for p in folder.glob("ODA/ODAFileConverter*/ODAFileConverter.exe")
                )
    return next((p for p in candidates if p and Path(p).is_file()), None)


def convert(data, source_ext, target_ext):
    exe = converter()
    if not exe:
        raise ValueError(
            "DWG konverter topilmadi. DXF fayl oching yoki ODA File Converter o‘rnating."
        )
    with CONVERT_LOCK, tempfile.TemporaryDirectory(prefix="dizy-cad-") as tmp:
        src, out = Path(tmp) / "in", Path(tmp) / "out"
        src.mkdir()
        out.mkdir()
        (src / f"plan.{source_ext}").write_bytes(data)
        result = subprocess.run(
            [
                exe,
                str(src),
                str(out),
                "ACAD2018",
                target_ext.upper(),
                "0",
                "1",
                f"*.{source_ext}",
            ],
            capture_output=True,
            timeout=90,
        )
        files = [p for p in out.iterdir() if p.suffix.lower() == "." + target_ext]
        if not files:
            raise ValueError(
                "DWG konvertatsiya amalga oshmadi. Faylni tekshiring. "
                + result.stderr.decode(errors="replace")[-300:]
            )
        return files[0].read_bytes()


def read_doc(data):
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp) / "plan.dxf"
        p.write_bytes(data)
        return ezdxf.readfile(p)


def doc_bytes(doc):
    stream = io.StringIO()
    doc.write(stream)
    return stream.getvalue().encode(doc.output_encoding, errors="dxfreplace")


def xy(p):
    return [round(float(p[0]), 4), round(float(p[1]), 4)]


def primitives(entity):
    result = []
    for e in recursive_decompose([entity]):
        t = e.dxftype()
        try:
            if t in ("TEXT", "MTEXT", "ATTRIB", "ATTDEF"):
                text = e.plain_text() if hasattr(e, "plain_text") else e.dxf.text
                height = e.dxf.char_height if t == "MTEXT" else e.dxf.height
                rotation = (
                    e.get_rotation() if t == "MTEXT" else e.dxf.get("rotation", 0)
                )
                pos = e.dxf.insert
                if t != "MTEXT" and (e.dxf.get("halign", 0) or e.dxf.get("valign", 0)):
                    pos = e.dxf.get("align_point", pos)
                result.append(
                    {
                        "kind": "text",
                        "p": xy(pos),
                        "text": text,
                        "height": height,
                        "rotation": rotation,
                        "align": (
                            "center"
                            if t != "MTEXT" and e.dxf.get("halign", 0) in (1, 4)
                            else "left"
                        ),
                        "top": t == "MTEXT",
                    }
                )
            elif t == "HATCH":
                for p in cadpath.from_hatch(e):
                    pts = [xy(v) for v in p.flattening(5)]
                    if pts:
                        result.append(
                            {
                                "kind": "path",
                                "points": pts,
                                "closed": True,
                                "fill": True,
                            }
                        )
            elif t in ("SOLID", "TRACE", "3DFACE"):
                pts = (
                    [xy(v) for v in e.wcs_vertices()]
                    if hasattr(e, "wcs_vertices")
                    else [xy(v) for v in e.vertices()]
                )
                result.append(
                    {"kind": "path", "points": pts, "closed": True, "fill": True}
                )
            else:
                p = cadpath.make_path(e)
                pts = [xy(v) for v in p.flattening(3)]
                if pts:
                    result.append(
                        {"kind": "path", "points": pts, "closed": p.is_closed}
                    )
        except (TypeError, AttributeError, ValueError, NotImplementedError):
            continue
    return result


def scene(data, name):
    doc = read_doc(data)
    entities = []
    unsupported = []
    for e in doc.modelspace():
        shapes = primitives(e)
        if not shapes:
            unsupported.append(e.dxftype())
            continue
        points = []
        for s in shapes:
            if s["kind"] == "path":
                points.extend(s["points"])
            else:
                x, y = s["p"]
                h = s["height"]
                w = min(100, max(map(len, s["text"].splitlines() or [""]))) * h * 0.65
                points.extend([[x, y - h], [x + w, y + h]])
        if not points:
            continue
        bounds = [
            min(p[0] for p in points),
            min(p[1] for p in points),
            max(p[0] for p in points),
            max(p[1] for p in points),
        ]
        entities.append(
            {
                "id": e.dxf.handle,
                "type": e.dxftype(),
                "layer": e.dxf.layer,
                "name": e.dxf.name if e.dxftype() == "INSERT" else e.dxftype(),
                "bounds": bounds,
                "shapes": shapes,
            }
        )
    units = {0: "birlik", 1: "inch", 2: "ft", 4: "mm", 5: "cm", 6: "m"}
    return {
        "version": 1,
        "name": name,
        "source": base64.b64encode(data).decode(),
        "entities": entities,
        "layers": [
            {"name": l.dxf.name, "visible": not l.is_off() and not l.is_frozen()}
            for l in doc.layers
        ],
        "units": units.get(doc.units, f"unit {doc.units}"),
        "unitCode": doc.units,
        "warnings": (
            [
                f"{len(unsupported)} ta obyekt ekranda ko‘rsatilmaydi, lekin eksportda saqlanadi."
            ]
            if unsupported
            else []
        ),
        "edits": {},
        "additions": [],
        "notes": [],
        "brief": "",
    }


def number(n):
    n = float(n)
    if not math.isfinite(n) or abs(n) > 1e10:
        raise ValueError("Koordinata noto‘g‘ri.")
    return n


def export_doc(project):
    doc = read_doc(base64.b64decode(project["source"], validate=True))
    msp = doc.modelspace()
    handles = {e.dxf.handle: e for e in msp}
    for key, edit in project.get("edits", {}).items():
        e = handles.get(key)
        if e is None:
            raise ValueError("Asl obyekt topilmadi: " + key)
        if edit.get("deleted"):
            msp.delete_entity(e)
            continue
        dx, dy = number(edit.get("dx", 0)), number(edit.get("dy", 0))
        angle = math.radians(number(edit.get("rotation", 0)))
        cx, cy = map(number, edit.get("center", [0, 0]))
        matrix = Matrix44.chain(
            Matrix44.translate(-cx, -cy, 0),
            Matrix44.z_rotate(angle),
            Matrix44.translate(cx + dx, cy + dy, 0),
        )
        try:
            e.transform(matrix)
        except (AttributeError, NotImplementedError) as exc:
            raise ValueError(f"{e.dxftype()} obyektini o‘zgartirib bo‘lmadi.") from exc
    for layer, color in [("DIZY-EDIT", 3), ("DIZY-NOTES", 30)]:
        if layer not in doc.layers:
            doc.layers.new(layer, dxfattribs={"color": color})
    for a in project.get("additions", []):
        if a.get("deleted"):
            continue
        pts = [tuple(map(number, p)) for p in a["points"]]
        if a["type"] == "line" and len(pts) == 2:
            msp.add_line(pts[0], pts[1], dxfattribs={"layer": "DIZY-EDIT"})
        elif a["type"] == "rect" and len(pts) == 2:
            (x, y), (x2, y2) = pts
            msp.add_lwpolyline(
                [(x, y), (x2, y), (x2, y2), (x, y2)],
                close=True,
                dxfattribs={"layer": "DIZY-EDIT"},
            )
        else:
            raise ValueError("Chizilgan shakl noto‘g‘ri.")
    # Notes are visible in CAD too; full instructions also live in the handoff.
    for i, n in enumerate(project.get("notes", []), 1):
        x, y = map(number, n["p"])
        h = number(project.get("noteHeight", 150))
        msp.add_circle((x, y), h * 0.8, dxfattribs={"layer": "DIZY-NOTES"})
        msp.add_mtext(
            f"{i}. {str(n['text'])}",
            dxfattribs={
                "insert": (x + h, y + h),
                "char_height": h * 0.65,
                "width": h * 20,
                "layer": "DIZY-NOTES",
            },
        )
    return doc


def instructions(project):
    lines = [
        "# " + project.get("name", "Plan"),
        "",
        "## Vazifa",
        project.get("brief", "") or "Quyidagi izohlar bo‘yicha planni yangilang.",
        "",
        "## Plandagi izohlar",
    ]
    for i, n in enumerate(project.get("notes", []), 1):
        lines.append(f"{i}. ({n['p'][0]:.1f}, {n['p'][1]:.1f}): {n['text']}")
    lines += [
        "",
        "## CAD o‘zgarishlari",
        "Koordinata birligi: " + project.get("units", "mm"),
    ]
    for handle, e in project.get("edits", {}).items():
        lines.append(f"- Handle {handle}: " + json.dumps(e, ensure_ascii=False))
    lines.append(f"- Yangi shakllar: {len(project.get('additions',[]))}")
    return "\n".join(lines) + "\n"


class Handler(BaseHTTPRequestHandler):
    def send(self, data, content="application/json", status=200, filename=None):
        if not isinstance(data, bytes):
            data = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", content)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if filename:
            self.send_header(
                "Content-Disposition", f'attachment; filename="{filename}"'
            )
        self.end_headers()
        self.wfile.write(data)

    def allowed(self):
        host = self.headers.get("Host", "")
        return host in (
            f"127.0.0.1:{self.server.server_port}",
            f"localhost:{self.server.server_port}",
        )

    def do_GET(self):
        if not self.allowed():
            return self.send({"error": "Local access only"}, status=403)
        url = urlparse(self.path).path
        if url == "/api/info":
            return self.send(
                {
                    "app": APP_ID,
                    "version": VERSION,
                    "dwg": bool(converter()),
                    "plans": [
                        {"id": i, "name": n}
                        for i, n, p in PLANS
                        if (ROOT / p).is_file()
                    ],
                }
            )
        paths = {"/": "index.html", "/app.js": "app.js", "/style.css": "style.css"}
        if url not in paths:
            return self.send({"error": "Not found"}, status=404)
        p = ROOT / "static" / paths[url]
        self.send(p.read_bytes(), mimetypes.guess_type(p.name)[0] or "text/plain")

    def do_POST(self):
        if not self.allowed():
            return self.send({"error": "Local access only"}, status=403)
        origin = self.headers.get("Origin")
        if origin and origin not in (
            f"http://127.0.0.1:{self.server.server_port}",
            f"http://localhost:{self.server.server_port}",
        ):
            return self.send({"error": "Origin rejected"}, status=403)
        try:
            size = int(self.headers.get("Content-Length", 0))
            if not 0 < size <= 40 * 1024 * 1024:
                raise ValueError("Fayl chegarasi: 40 MB.")
            body = self.rfile.read(size)
            url = urlparse(self.path).path
            if url == "/api/import":
                from urllib.parse import unquote

                name = Path(unquote(self.headers.get("X-Filename", "plan.dxf"))).name
                if name.lower().endswith(".dwg"):
                    body = convert(body, "dwg", "dxf")
                elif not name.lower().endswith(".dxf"):
                    raise ValueError("DWG yoki DXF tanlang.")
                return self.send(scene(body, name))
            payload = json.loads(body)
            if url == "/api/load":
                p = next((ROOT / p for i, n, p in PLANS if i == payload["id"]), None)
                if p is None:
                    raise ValueError("Plan topilmadi.")
                return self.send(scene(p.read_bytes(), p.stem))
            if url == "/api/export":
                project = payload["project"]
                fmt = payload["format"]
                dxf = doc_bytes(export_doc(project))
                if fmt == "dxf":
                    return self.send(dxf, "application/dxf", filename="plan-edited.dxf")
                if fmt == "dwg":
                    return self.send(
                        convert(dxf, "dxf", "dwg"),
                        "application/acad",
                        filename="plan-edited.dwg",
                    )
                if fmt != "zip":
                    raise ValueError("Format noto‘g‘ri.")
                out = io.BytesIO()
                with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
                    z.writestr("plan-edited.dxf", dxf)
                    z.writestr(
                        "project.dizy.json", json.dumps(project, ensure_ascii=False)
                    )
                    z.writestr("VAZIFA.md", instructions(project))
                    if payload.get("preview"):
                        z.writestr("preview.svg", payload["preview"])
                folder = ROOT / "data" / "exports"
                folder.mkdir(parents=True, exist_ok=True)
                name = (
                    time.strftime("dizy-vazifa-%Y%m%d-%H%M%S")
                    + f"-{time.time_ns()%1000000:06d}.zip"
                )
                (folder / name).write_bytes(out.getvalue())
                return self.send(out.getvalue(), "application/zip", filename=name)
            self.send({"error": "Not found"}, status=404)
        except Exception as exc:
            self.send({"error": str(exc)}, status=400)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8766)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"Dizy Plan: http://127.0.0.1:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
