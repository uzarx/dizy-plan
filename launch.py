#!/usr/bin/env python3
"""Cross-platform launcher; dependencies must be installed before running."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser

ROOT = Path(__file__).resolve().parent


def probe(url):
    try:
        with urllib.request.urlopen(url + "/api/info", timeout=2) as response:
            return json.load(response).get("app") == "dizy-plan"
    except (ValueError, urllib.error.URLError, OSError):
        return False


def main():
    parser = argparse.ArgumentParser(description="Open Dizy Plan locally")
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    if sys.version_info < (3, 10):
        raise SystemExit("Python 3.10 or newer is required.")
    if importlib.util.find_spec("ezdxf") is None:
        raise SystemExit(
            "Install dependencies first: python -m pip install -r requirements.txt"
        )
    url = f"http://127.0.0.1:{args.port}"
    if not probe(url):
        (ROOT / "data").mkdir(exist_ok=True)
        options = (
            {"start_new_session": True}
            if os.name != "nt"
            else {
                "creationflags": subprocess.CREATE_NEW_PROCESS_GROUP
                | subprocess.DETACHED_PROCESS
            }
        )
        with (ROOT / "data" / "server.log").open("a") as log:
            process = subprocess.Popen(
                [sys.executable, str(ROOT / "server.py"), "--port", str(args.port)],
                cwd=ROOT,
                stdin=subprocess.DEVNULL,
                stdout=log,
                stderr=log,
                **options,
            )
        for _ in range(60):
            if process.poll() is not None:
                raise SystemExit(
                    "Server could not start. Check data/server.log or choose another --port."
                )
            if probe(url):
                (ROOT / "data" / "server.pid").write_text(str(process.pid))
                break
            time.sleep(0.2)
        else:
            process.terminate()
            raise SystemExit("Server did not respond. Check data/server.log.")
    if not args.no_browser:
        webbrowser.open(url)
    print(f"Dizy Plan: {url}\nYou may close this terminal window.")


if __name__ == "__main__":
    main()
