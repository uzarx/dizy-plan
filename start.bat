@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
    echo First-time setup. Internet is required.
    py -3 -m venv .venv
    if errorlevel 1 goto error
)
.venv\Scripts\python.exe -c "import ezdxf; assert ezdxf.__version__ == '1.4.2'" >nul 2>&1
if errorlevel 1 (
    .venv\Scripts\python.exe -m pip install -r requirements.txt
    if errorlevel 1 goto error
)
.venv\Scripts\python.exe launch.py %*
if errorlevel 1 goto error
exit /b 0
:error
echo Setup failed. Install Python 3.10+ and check the message above.
pause
exit /b 1
