"""Shared project-relative configuration for Python entry points."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_environment():
    # This parser also works before the virtual environment/dependencies exist.
    path = ROOT / 'backend/.env'
    if path.exists():
        for line in path.read_text(encoding='utf-8-sig').splitlines():
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, value = line.split('=', 1)
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            os.environ.setdefault(key.strip(), value)


def setting_path(key, default):
    value = Path(os.getenv(key) or default).expanduser()
    return value if value.is_absolute() else ROOT / value
