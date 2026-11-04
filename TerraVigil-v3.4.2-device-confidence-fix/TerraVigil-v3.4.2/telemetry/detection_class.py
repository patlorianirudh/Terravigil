"""Normalize explicit detector labels without inferring a class from an image."""
import json
import math
from functools import lru_cache
from pathlib import Path


_MISSING_NAMES = frozenset({
    'unknown', 'unknown class', 'unknown_class', 'unknown-class',
    'unclassified', 'none', 'null', 'n/a', 'not supplied',
    'class not supplied', 'class_not_supplied',
})


def normalize_class_id(value):
    """Return a nonnegative integral class ID, or None for invalid input."""
    # bool is an int in Python, but is never a detector class ID.
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value >= 0 else None
    if isinstance(value, float):
        return int(value) if math.isfinite(value) and value >= 0 and value.is_integer() else None
    if isinstance(value, str):
        value = value.strip()
        if value.isascii() and value.isdecimal():
            try:
                return int(value)
            except ValueError:
                pass
    return None


def normalize_class_name(value):
    """Return an explicit detector name; missing-label placeholders are not names."""
    if not isinstance(value, str):
        return None
    name = value.strip()
    if not name or ' '.join(name.split()).casefold() in _MISSING_NAMES:
        return None
    return name[:200]


@lru_cache(maxsize=1)
def _model_classes():
    """Use the catalog shipped with this checkpoint, not an assumed single class."""
    try:
        manifest = Path(__file__).resolve().parents[1] / 'inference' / 'model.json'
        classes = json.loads(manifest.read_text(encoding='utf8'))['classes']
        return {normalize_class_id(item.get('id')): normalize_class_name(item.get('name'))
                for item in classes if isinstance(item, dict)
                and normalize_class_id(item.get('id')) is not None and normalize_class_name(item.get('name'))}
    except (OSError, ValueError, KeyError, TypeError):
        # A missing catalog must not prevent timestamp/GPS matching.
        return {}


def detection_class(record):
    """Return (name, id), preferring top-level explicit metadata.

    Singular nested detector objects are supported. Prediction lists are not:
    choosing one object from a multi-object frame would discard evidence.
    """
    sources = [record] + [record[key] for key in ('detection', 'prediction')
                          if isinstance(record.get(key), dict)]
    for source in sources:
        name = next((normalize_class_name(source.get(key)) for key in
                     ('class_name', 'className', 'label', 'name')
                     if normalize_class_name(source.get(key)) is not None), None)
        class_id = next((normalize_class_id(source.get(key)) for key in
                         ('class_id', 'classId', 'cls', 'class')
                         if normalize_class_id(source.get(key)) is not None), None)
        # The generic "class" field can contain either a name or a numeric ID.
        generic = normalize_class_name(source.get('class'))
        if name is None and generic is not None:
            try:
                float(generic)
            except ValueError:
                name = generic
        if name is not None or class_id is not None:
            return name or _model_classes().get(class_id), class_id
    return None, None
