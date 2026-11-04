"""Extract class metadata from an actual Ultralytics detection result.

No model is loaded and no network requests are made here. This module can also
be used by an existing Jetson Firebase sender without changing its upload path.
"""
import math
from collections.abc import Mapping

from detection_class import normalize_class_id, normalize_class_name


def _scalar(value):
    # Tensor/NumPy scalar .item() also handles values on a CUDA device.
    return value.item() if callable(getattr(value, 'item', None)) else value


def yolo_detection_metadata(result, *, box_index):
    """Return the real name, ID and confidence for one explicitly selected box.

    Use result.names from the model that performed inference: a custom model's
    class 0 may be land_mines even though the bundled model's class 0 is not.
    The caller preserves its capture timestamp, image reference and event key.
    """
    if type(box_index) is not int or box_index < 0:
        raise ValueError('box_index must be a non-negative integer for one YOLO detection.')
    boxes = getattr(result, 'boxes', None)
    if boxes is None:
        raise ValueError('The YOLO result has no detection boxes.')
    try:
        raw_id = _scalar(boxes.cls[box_index])
        confidence = _scalar(boxes.conf[box_index])
    except (AttributeError, IndexError, KeyError, TypeError, ValueError, RuntimeError):
        raise ValueError('Select an existing YOLO detection box with scalar class/confidence values.') from None
    class_id = normalize_class_id(raw_id)
    if class_id is None:
        raise ValueError('YOLO returned an invalid class ID.')
    names = getattr(result, 'names', None)
    if isinstance(names, Mapping):
        raw_name = names.get(class_id, names.get(str(class_id)))
    elif isinstance(names, (list, tuple)) and class_id < len(names):
        raw_name = names[class_id]
    else:
        raw_name = None
    class_name = normalize_class_name(raw_name)
    if class_name is None:
        raise ValueError(f'YOLO result.names has no real label for class {class_id}. Check the model class names before publishing.')
    if type(confidence) not in (int, float) or not math.isfinite(confidence) or not 0 <= confidence <= 1:
        raise ValueError('YOLO confidence must be a finite number from 0 to 1.')
    return {'class_name': class_name, 'class_id': class_id, 'confidence': float(confidence)}
