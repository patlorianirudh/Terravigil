# Supplied model inference

TerraVigil runs the supplied `weights/best.pt` with Ultralytics on CPU by default. It preserves the original checkpoint bytes. The training version recorded in the checkpoint is Ultralytics 8.4.157; `model.json` records the 13 class names and provenance. `weights/SHA256SUMS` records the checksum:

```
02d9b7eac5d7bbd33e0b8168ea892f24da6099b1fc02e9c87c688b928a464f93  best.pt
```

The service checks the size and checksum before loading the trusted bundled PyTorch checkpoint. It does not accept uploaded weights or remote image URLs. Models in PyTorch's checkpoint format can contain executable Python objects; keep this checkpoint and checksum together and install dependencies from their official distributions.

## Install

Use Python 3.10, 3.11 or 3.12. From the project root, use the project setup command or create `.venv` manually.

Windows PowerShell:

```powershell
py -3.12 -m venv .venv
.venv\Scripts\python.exe -m pip install --upgrade pip
.venv\Scripts\python.exe -m pip install torch==2.8.0 torchvision==0.23.0 --index-url https://download.pytorch.org/whl/cpu
.venv\Scripts\python.exe -m pip install -r inference/requirements.txt
.venv\Scripts\python.exe inference/predict.py --check
```

Linux:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install torch==2.8.0 torchvision==0.23.0 --index-url https://download.pytorch.org/whl/cpu
.venv/bin/python -m pip install -r inference/requirements.txt
.venv/bin/python inference/predict.py --check
```

macOS:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r inference/requirements.txt
.venv/bin/python inference/predict.py --check
```

The CPU wheel installation avoids downloading the Linux CUDA runtime. macOS uses the standard PyPI wheels. On minimal Linux hosts, OpenCV may also require the OS packages `libgl1` and `libglib2.0-0`. A successful `--check` means the checksum, model task and class list, compiled torchvision operator, and an actual 64-pixel forward pass all worked. It does not measure detection accuracy.

Node discovers project `.venv` first, then `inference/.venv`, then a system Python. An `INFERENCE_PYTHON` value overrides discovery and must be one executable path, with no arguments or shell syntax. Paths with spaces are supported. Restart the backend after changing this environment setting.

| Setting | Default | Purpose |
| --- | --- | --- |
| `INFERENCE_PYTHON` | automatic | Python executable path |
| `INFERENCE_DEVICE` | `cpu` | `cpu`, `mps` or CUDA index such as `0` |
| `INFERENCE_TIMEOUT_MS` | `120000` | Per-image subprocess deadline |
| `INFERENCE_STATUS_TIMEOUT_MS` | `45000` | Runtime/checkpoint check deadline |

The application can start without these Python packages. Model status then reports an explicit setup error; it never substitutes simulated predictions. Status checks are cached for 60 seconds and simultaneous probes share one process. `router.getCachedStatus()` gives the health endpoint a synchronous snapshot without starting Python.

## API

All routes are mounted under `/api` by the integrated backend.

- `GET /api/inference/status`: `{ready,status,model,runtime,limits,checkedAt,error?,setup}`. `ready` becomes true only after successful model validation or prediction. An unavailable model is a status response with HTTP 200 and `ready:false`.
- `POST /api/inference/predict`: JSON `{imageBase64,filename,missionId?,confidence?,latitude?,longitude?}`. `imageBase64` is canonical base64 or a matching JPEG, PNG or WebP data URL. Confidence defaults to 0.25 and must be from 0.01 through 1.
- `GET /api/inference/files/:filename`: serves the original/annotated image registered to a successfully persisted run. Arbitrary filenames, traversal and symlinks are rejected.

Images are limited to 10 MiB, 20 million pixels and 8192 pixels per dimension. Animated, truncated and unsupported files are rejected. EXIF orientation is applied before inference and annotation. Filenames are metadata only; generated UUID names determine all output paths. One prediction request is processed at a time per backend process; additional requests receive HTTP 429. The subprocess receives an argument array and JSON stdin, never a shell command.

A successful upload returns HTTP 201:

```json
{
  "runId": "generated-id",
  "missionId": "INFERENCE-generated-id",
  "model": {"name":"best.pt","sha256":"...","task":"detect","device":"cpu","classes":[]},
  "predictions": [{"classId":12,"className":"land_mines","confidence":0.91,"bbox":[20,10,80,30],"normalizedCenter":{"x":0.5,"y":0.4}}],
  "image": {"width":100,"height":50},
  "imageUrl": "/api/inference/files/generated-original.png",
  "annotatedImageUrl": "/api/inference/files/generated-annotated.jpg",
  "persistedObservations": 0,
  "observationIds": [],
  "locationSource": null,
  "targetLocationKnown": false
}
```

Bounding boxes are pixel coordinates in the oriented original image; normalized centers are in `[0,1]`. Every predicted class is returned and saved in `inference_runs`, including runs without GPS. Supplying no mission or selecting the synthetic sample creates a new persisted inference mission. The synthetic sample is never changed. An unknown selected mission receives HTTP 404.

GPS must be a finite numeric latitude/longitude pair or omitted entirely. Only `land_mines` predictions with that pair create `UNCONFIRMED` observations. The pair is labeled `user_supplied_image_location`, and `target_location_known` is false: it is not a calculated target location. `metal_detected` and `metal_signal` remain null because no sensor was run. The service does not create confirmed detections, surveyed coverage or clearance claims. Image-only predictions remain accessible to reports and RAG through their run records.

Prediction failures return a typed `{code,message}` error and remove files and database writes from that failed request. Rollback is best-effort if the database itself becomes unavailable during cleanup. A completed run is published only after its files, mission and observations have been written.

## CLI and tests

For a direct local prediction, pipe one JSON object into the script; the JPEG output path must not already exist:

```bash
printf '%s' '{"inputPath":"/absolute/image.jpg","annotatedPath":"/absolute/result.jpg","confidence":0.25,"device":"cpu"}' | .venv/bin/python inference/predict.py
```

Stdout contains exactly one JSON object. Diagnostics go to stderr. Exit 0 means success; nonzero exits return `{ok:false,error:{code,message}}`. The equivalent `--check` command validates readiness without requiring an image.

```bash
.venv/bin/python -m unittest discover -s inference/tests -v
node --test backend/test/inference.test.cjs
```

To opt into a real HTTP-to-Python checkpoint smoke test on Linux/macOS, run:

```bash
INFERENCE_REAL_TEST=1 INFERENCE_PYTHON="$PWD/.venv/bin/python" node --test backend/test/inference.test.cjs
```

In PowerShell, set `$env:INFERENCE_REAL_TEST="1"` and `$env:INFERENCE_PYTHON="$PWD\.venv\Scripts\python.exe"` before the same Node test command. Optional `INFERENCE_TEST_IMAGE` selects an existing local image; otherwise the test uses a small neutral PNG.

The Python suite exercises checksum rejection, image size/format validation, EXIF orientation and output conversion. Node tests exercise HTTP validation, real subprocess transport/timeouts, sample immutability, persistence boundaries and unknown runtime behavior. The checkpoint was also run on CPU against the supplied labeled validation montage during integration. That smoke test verifies loading/inference/annotation; it is not an independent accuracy or field-safety evaluation.

Ultralytics and the supplied checkpoint metadata identify the Ultralytics AGPL-3.0 license. Refer to the upstream package and model provenance for their license terms.
