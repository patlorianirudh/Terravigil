#!/usr/bin/env python3
"""Compatibility entry point for the configured Mission Planner logger."""
import os
import sys
from pathlib import Path
root = Path(__file__).resolve().parent
venv_python = root / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
if venv_python.exists() and Path(sys.executable).absolute() != venv_python.absolute():
    os.execv(str(venv_python), [str(venv_python), str(Path(__file__).resolve()), *sys.argv[1:]])
sys.path.insert(0, str(Path(__file__).resolve().parent / 'telemetry'))
from drone_metrics_forwarded import main
if __name__ == '__main__':
    raise SystemExit(main())
