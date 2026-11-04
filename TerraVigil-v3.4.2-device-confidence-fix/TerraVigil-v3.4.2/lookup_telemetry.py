#!/usr/bin/env python3
# Compatibility launcher. The application runs this logic automatically.
import runpy
import os
import sys
from pathlib import Path
root = Path(__file__).resolve().parent
venv_python = root / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
if venv_python.exists() and Path(sys.executable).absolute() != venv_python.absolute():
    os.execv(str(venv_python), [str(venv_python), str(Path(__file__).resolve()), *sys.argv[1:]])
folder = Path(__file__).resolve().parent / 'telemetry'
sys.path.insert(0, str(folder))
runpy.run_path(str(folder / 'lookup_telemetry.py'), run_name='__main__')
