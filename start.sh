#!/usr/bin/env sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if [ ! -x .venv/bin/python ]; then
  echo 'First-time setup (internet required). Creating .venv...'
  python3 -m venv .venv
fi
if ! .venv/bin/python -c 'import ezdxf; assert ezdxf.__version__ == "1.4.2"' >/dev/null 2>&1; then
  .venv/bin/python -m pip install -r requirements.txt
fi
exec .venv/bin/python launch.py "$@"
