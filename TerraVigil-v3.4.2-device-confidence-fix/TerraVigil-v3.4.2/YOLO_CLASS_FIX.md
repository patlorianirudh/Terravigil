# Fixing unknown YOLO classes

The 3.4.1 update handled missing field names, but still treated the literal text `unknown` as an actual class. This update fixes that bug and adds a way for your Jetson sender to transmit the real YOLO result.

## If Firebase already contains a class ID

Restart the updated ground-station application. With the bundled model catalog, this record:

```json
{"class_name": "unknown", "class_id": 12}
```

now becomes `class_name: "land_mines"` in the dashboard. Placeholder labels no longer hide a usable ID, an alternative class-name field, or a singular nested prediction. Existing Firebase records are reread on restart and updated in the local application without creating duplicate observations. The reader does not modify the original Firebase record.

The bundled catalog uses ID 12 for land_mines. Your deployed model may use another ID, so the sender should send its actual class name as well as its ID.

## Fix the class at the Jetson sender

Your actual Jetson camera/inference sender was not included in the uploaded project. Updating only the laptop application cannot make that separate script publish fields it never sends. Keep its camera capture, YOLO model, detection threshold, event keys and image upload as they are; add the class metadata from its existing result.

Copy these two files next to your Jetson sender script:

```text
telemetry/detection_class.py
telemetry/yolo_metadata.py
```

Import the helper once:

```python
from yolo_metadata import yolo_detection_metadata
```

At the existing Firebase send point, before `set()` or `push()`, add:

```python
# result is the Ultralytics Results object for this captured frame.
# box_index identifies the SAME box that passed your existing detection trigger.
# payload is your existing dict, including the actual capture time and image path.
payload.update(yolo_detection_metadata(result, box_index=box_index))

# Keep your existing Firebase write and event key after this line.
```

The helper reads the selected box's `cls` and `conf` and looks up its name in that result's own `names` mapping. For example, a custom model with `{0: "land_mines"}` produces `class_id: 0` and `class_name: "land_mines"`; it does not incorrectly use the bundled catalog's name for class 0. It adds no new model or camera dependency. Use one stable event key per selected box if a frame has multiple accepted detections.

If using the project's optional Firebase Storage publisher, the equivalent call is:

```python
from publish_detection import publish_yolo_detection

published = publish_yolo_detection(
    image_path,
    capture_timestamp,       # original frame capture time, unchanged
    result,                 # result from your existing YOLO inference
    box_index=box_index,     # box that passed your existing trigger
    record_id=detection_id,  # stable across retries; distinct for each box
    app=firebase_app,        # your existing initialized Firebase Admin app
)
```

This publisher uses the existing `FIREBASE_STORAGE_BUCKET` configuration. The first option is sufficient if your own sender already uploads images and writes metadata; do not replace a working upload pipeline just to add class fields.

New records contain the actual `class_name`, numeric `class_id`, and `confidence`. The updated optional publisher rejects an unresolved placeholder before uploading or writing instead of storing another unknown class. An invalid or missing label in `result.names` needs correction in the model/export metadata; the helper reports that error explicitly.

Reference: [Ultralytics Results and Boxes API](https://docs.ultralytics.com/reference/engine/results/).

## Existing records with no class information

If an old Firebase record contains only an image path, timestamp and `unknown`, with no class ID or usable label anywhere, its model class was never transmitted. This patch does not assign an invented class to it. Resend the same event key with the actual retained YOLO metadata, or recover the prediction from the original image and deployed model. New events use the sender change above.

## Applying this update

Preserve your working `.env`, credentials, mission data, images and telemetry CSV. The additional files changed after 3.4.1 are:

```text
telemetry/detection_class.py
telemetry/publish_detection.py
telemetry/yolo_metadata.py (new)
telemetry/tests/test_detection_class.py
telemetry/tests/test_yolo_publishing.py (new)
backend/test/bridge.test.cjs
START_HERE.md
YOLO_CLASS_FIX.md (new)
PATCH_NOTES_3.4.2.md (new)
```

Copy the runtime files to the ground station, and apply the two-file helper integration on the Jetson if its sender was writing a placeholder. Start the ground station with your existing command, normally `python start_terravigil.py`. The frontend and all previous card/status display changes are retained. Timestamp matching, CSV recording, map coordinates and confirmation logic are unchanged.
