"""Fetch evidence asynchronously and keep a timestamped copy; never rename originals."""
import hashlib
import io
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlparse, unquote
from urllib.request import Request, build_opener, HTTPRedirectHandler
from lookup_telemetry import parse_timestamp

MAX_BYTES = 20 * 1024 * 1024


def image_source(record):
    return str(record.get('image_url') or record.get('storage_path') or record.get('image_path') or record.get('image_filename') or record.get('filename') or '')


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Image redirects are not allowed; supply the final HTTPS URL.')


class ImageCache:
    def __init__(self, directory, app=None, allowed_hosts=(), bucket=''):
        self.root = Path(directory).resolve()
        self.cache = self.root / 'received'
        self.app = app
        self.bucket = bucket
        self.hosts = {'firebasestorage.googleapis.com', 'storage.googleapis.com', *allowed_hosts}
        self.pool = ThreadPoolExecutor(max_workers=3, thread_name_prefix='image')
        self.jobs, self.results, self.retry_at = {}, {}, {}

    def close(self):
        self.pool.shutdown(wait=True, cancel_futures=True)

    def local_source(self, source):
        normalized = source.replace('\\', '/')
        # Camera absolute paths refer to another machine. Only look inside image root.
        for candidate in (self.root / normalized.lstrip('/'), self.root / normalized.split('/')[-1]):
            resolved = candidate.resolve()
            if resolved.is_relative_to(self.root) and resolved.is_file():
                return resolved
        return None

    def signature(self, record):
        source = image_source(record)
        stat = None
        if not source.startswith(('https://', 'gs://')):
            local = self.local_source(source)
            if local:
                s = local.stat()
                stat = (s.st_size, s.st_mtime_ns)
        return hashlib.sha256(json.dumps([source, stat, record.get('capture_timestamp', record.get('timestamp'))]).encode()).hexdigest()[:16]

    def resolve(self, event, record):
        source = image_source(record)
        if not source:
            return {'state': 'missing', 'message': 'No image filename or URL was provided.'}
        key = (event['event_id'], self.signature(record))
        saved = self.results.get(key)
        if saved and saved['state'] == 'ready' and (self.root / saved['local_path']).is_file():
            return saved
        job = self.jobs.get(key)
        if job and job.done():
            try:
                saved = job.result()
            except Exception as error:
                saved = {'state': 'waiting', 'message': str(error) if isinstance(error, ValueError) else 'Image unavailable; check transfer, URL, or Storage access. Retrying.'}
            self.results[key] = saved
            self.retry_at[key] = time.monotonic() + 10
            del self.jobs[key]
            return saved
        if not job and time.monotonic() >= self.retry_at.get(key, 0) and len(self.jobs) < 12:
            self.jobs[key] = self.pool.submit(self.materialize, event, record, key[1])
        return saved or {'state': 'pending', 'message': 'Waiting for the image copy.'}

    def materialize(self, event, record, signature=None):
        source = image_source(record)
        signature = signature or self.signature(record)
        stamp = event.get('match', {}).get('capture_timestamp')
        try:
            prefix = parse_timestamp(stamp).strftime('%Y%m%dT%H%M%S%fZ')
        except (ValueError, OverflowError):
            prefix = 'unknown-time'
        stem = f"{prefix}_{event['event_id']}_{signature}"
        self.cache.mkdir(parents=True, exist_ok=True)
        for suffix in ('.jpg', '.png', '.webp'):
            existing = self.cache / (stem + suffix)
            if existing.is_file() and not existing.is_symlink():
                return self.result(existing)
        if source.startswith('gs://') or (record.get('storage_path') and not source.startswith('https://')):
            from firebase_admin import storage
            parsed = urlparse(source)
            bucket = parsed.netloc if source.startswith('gs://') else self.bucket
            name = unquote(parsed.path.lstrip('/')) if source.startswith('gs://') else source
            if not bucket:
                raise ValueError('Configure FIREBASE_STORAGE_BUCKET or send a gs://bucket/object path.')
            blob = storage.bucket(bucket, app=self.app).blob(name)
            blob.reload(timeout=15)
            if not blob.size or blob.size > MAX_BYTES:
                raise ValueError('Image is empty or exceeds 20 MiB.')
            data = blob.download_as_bytes(timeout=15, end=MAX_BYTES, retry=None)
        elif source.startswith('https://'):
            parsed = urlparse(source)
            if parsed.username or parsed.password or parsed.port not in (None, 443) or parsed.hostname not in self.hosts:
                raise ValueError('Image URL host is not enabled. Add its exact hostname to DETECTION_IMAGE_HOSTS.')
            with build_opener(NoRedirect()).open(Request(source, headers={'User-Agent': 'TerraVigil/3.4'}), timeout=15) as response:
                data = response.read(MAX_BYTES + 1)
        elif '://' in source:
            raise ValueError('Use a local filename, HTTPS URL, or gs:// Storage path.')
        else:
            local = self.local_source(source)
            if local is None:
                raise ValueError('Waiting for the camera file in the configured image folder.')
            if local.stat().st_size > MAX_BYTES:
                raise ValueError('Image exceeds 20 MiB.')
            data = local.read_bytes()
        if not data or len(data) > MAX_BYTES:
            raise ValueError('Image is empty or exceeds 20 MiB.')
        from PIL import Image
        try:
            with Image.open(io.BytesIO(data)) as picture:
                suffix = {'JPEG': '.jpg', 'PNG': '.png', 'WEBP': '.webp'}.get(picture.format)
                if not suffix or picture.width * picture.height > 40_000_000:
                    raise ValueError('Use a JPEG, PNG, or WebP up to 40 megapixels.')
                picture.verify()
        except Exception:
            raise ValueError('The image bytes are not a valid supported picture.') from None
        destination = self.cache / (stem + suffix)
        temporary = destination.with_suffix(destination.suffix + '.part')
        temporary.write_bytes(data)
        os.replace(temporary, destination)
        return self.result(destination)

    def result(self, destination):
        return {'state': 'ready', 'filename': destination.name,
                'local_path': destination.relative_to(self.root).as_posix(),
                'message': 'Image copied and renamed; original preserved.'}
