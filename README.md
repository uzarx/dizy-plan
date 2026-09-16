# Dizy Plan

A small, local 2D floor-plan editor for your browser. Move furniture, draw simple shapes, attach notes, and export a package to discuss your next changes with an AI assistant or a designer.

**Early release · Uzbek interface · Python 3.10+ · No account or cloud service required**

## Quick start

Download this repository using **Code → Download ZIP**, extract it, and install [Python 3.10 or newer](https://www.python.org/downloads/) if needed.

- **Windows:** double-click `start.bat` (install Python with its launcher enabled).
- **macOS:** run `sh start.sh` in Terminal. For double-click launch, first run `chmod +x "Dizy Plan.command"`, then open that file.
- **Linux:** run `sh start.sh` in a terminal.

The first start creates `.venv` and installs Python dependencies from PyPI, requiring internet. Subsequent starts work offline. The editor opens at **http://127.0.0.1:8766** with a fictional demo apartment. Open your own DXF with **Fayl ochish**.

If you prefer manual setup:

```sh
python3 -m venv .venv
# macOS / Linux
. .venv/bin/activate
# Windows PowerShell: .venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python launch.py
```

If another app uses that port, run `python launch.py --port 8770`. For a foreground server that stops with Ctrl+C, run `python server.py --port 8766` and open the address yourself.

### DWG support

**DXF works immediately. DWG import/export requires a separately installed [ODA File Converter](https://www.opendesign.com/guestfiles/oda_file_converter).** Dizy Plan does not include or license ODA's proprietary binaries. Download the appropriate version from ODA and follow its installation and license requirements.

The app detects standard macOS installations, Windows installations under `Program Files/ODA`, and `ODAFileConverter` on PATH. If needed, set its executable explicitly **before starting the server**:

```sh
# macOS example
export ODA_CONVERTER="/Applications/ODAFileConverter.app/Contents/MacOS/ODAFileConverter"
sh start.sh
# Linux: set ODA_CONVERTER to an executable converter or AppImage
```

```powershell
# Windows PowerShell example; adjust the version/folder to your installation
$env:ODA_CONVERTER = 'C:\Program Files\ODA\ODAFileConverter\ODAFileConverter.exe'
.\start.bat
```

ODA may need an active desktop session, particularly on macOS/Linux. Restart an already running server after changing the converter path. DWG is converted locally to/from DXF; files are not uploaded to a conversion service.

## What you can do

- Open DXF and, with ODA installed, DWG.
- Select one CAD object at a time; move, rotate, or delete it. Furniture blocks move as whole objects.
- Apply exact X/Y offsets and rotation to original CAD objects.
- Draw and move lines and rectangles; snap to the grid.
- Measure temporary distances, zoom, pan, and hide layers.
- Undo/redo edits and attach numbered notes to locations.
- Save/reopen a `.dizy.json` project and restore work automatically in the same browser.
- Export DXF, AutoCAD 2018 DWG, SVG, or a task ZIP.

### Send an editing task

1. Open a plan with **Fayl ochish**.
2. Make edits, then select **Izoh** / press **N** and click a location to attach a note.
3. Write the overall request in **Codex uchun umumiy vazifa**.
4. Click **Vazifa paketi** and attach the downloaded ZIP to your conversation.

The ZIP contains `plan-edited.dxf`, `project.dizy.json`, `VAZIFA.md` (instructions and changed handles), and `preview.svg`. A copy is saved under `data/exports/` locally. Sending the package is a separate manual action; the app does not send it anywhere.

The project JSON contains the original CAD document and your edits. Browser autosave is convenient, but use **Loyihani saqlash** for an explicit backup before clearing browser data. Anyone you share a task ZIP/project with can read the included original drawing and notes.

## Shortcuts

| Key | Action |
| --- | --- |
| V | Select and move |
| H or Space + drag | Pan |
| L / R | Line / rectangle: click two points |
| M | Temporary measurement |
| N | Place a note |
| F | Fit to view |
| Scroll | Zoom at the pointer |
| Shift | Constrain to horizontal/vertical |
| Delete / Backspace | Delete selection |
| Ctrl/Cmd + Z | Undo |
| Ctrl/Cmd + Shift + Z | Redo |
| Ctrl/Cmd + S | Download project |
| Esc | Cancel drawing / clear selection |

## Limits and data handling

This is an early 2D model-space editor, not a full CAD application. There is no 3D, trim, block-component editing, multi-selection, constraint solving, or paper-space editing. Existing dimensions do not automatically recalculate after geometry changes. Measurements are temporary and are not exported as new dimensions.

The browser approximates curves, hatches, and fonts for display. Export applies edits to the original CAD entities instead of flattening the entire drawing. Special/proxy objects and external references may not display accurately; undisplayed records are retained. Hidden browser layers are omitted from SVG, but remain in CAD exports with their original layer settings.

Files up to 40 MB can be imported. This is a local desktop tool: it binds only to `127.0.0.1` and checks request host/origin. Do not expose the development server to the public internet. The repository contains a synthetic example only, never personal project plans. Generated projects, exports, logs, credentials, virtual environments, and converter binaries are ignored by Git.

**Validation:** local macOS testing covers editing and real DWG roundtrips with ODA. GitHub CI checks the Python backend and launcher on Windows/macOS/Linux. Actual DWG conversion on each OS depends on the user's ODA installation and is not part of CI.

## Development

```sh
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
python server.py --port 8766
```

Optional browser smoke test (Node.js 20+):

```sh
npm install
npx playwright install chromium
npm test
```

Run the server first, or set `DIZY_URL` for another address. Tests use a temporary browser profile and the synthetic demo. Test artifacts stay in `tests/artifacts/`.

- `server.py`: loopback HTTP API, DXF scene extraction, CAD export, optional ODA bridge.
- `static/`: vanilla HTML/CSS/JavaScript Canvas UI; no frontend build or CDN.
- `launch.py`, `start.*`: local setup and launch helpers.
- `examples/`: fictional demo and its reproducible generator.
- `tests/`: CAD geometry, HTTP isolation, and browser tests.

Contributions and bug reports are welcome. Include your OS, Python version, reproduction steps, and a small drawing you have permission to share. Never attach private customer plans or credentials to a public issue.

## O‘zbekcha

Bu brauzerda ishlaydigan sodda lokal plan editori. ZIP ni yuklab, oching; Python 3.10+ o‘rnating. Windows’da `start.bat`, macOS’da `Dizy Plan.command`, Linux’da `sh start.sh` orqali ishga tushiring. Birinchi ishga tushirishda paketlar internetdan o‘rnatiladi, keyin offline ishlaydi.

DXF darhol ishlaydi. **DWG uchun ODA File Converter alohida o‘rnatiladi.** Faylni ochib, mebelni suring/aylantiring, izoh yozing. **Vazifa paketi** tugmasi bergan ZIP ni Codex yoki dizayneringizga yuboring. **Loyihani saqlash** faylini qayta ochib davom etishingiz mumkin.

## License

Dizy Plan source code and the fictional demo: [MIT](LICENSE). Dependencies retain their own licenses. ODA File Converter is an optional, separately licensed external application; it is not bundled or covered by this license. See [THIRD_PARTY.md](THIRD_PARTY.md).
