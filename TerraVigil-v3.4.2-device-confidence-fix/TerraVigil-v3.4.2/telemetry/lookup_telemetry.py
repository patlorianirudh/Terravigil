#!/usr/bin/env python3
"""Timezone-aware, bounded CSV lookup. No prompts; also imported by the bridge."""
import argparse
import bisect
import csv
import io
import json
import math
from collections import Counter
from datetime import datetime, timezone, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo


def parse_timestamp(value, naive_timezone=None):
    if isinstance(value, bool) or value is None:
        raise ValueError("Missing or invalid timestamp")
    if isinstance(value, (int, float)) or (isinstance(value, str) and value.replace('.', '', 1).isdigit()):
        number = float(value)
        if not math.isfinite(number):
            raise ValueError("Invalid epoch timestamp")
        # Firebase server timestamps use milliseconds. Ordinary epoch seconds also work.
        return datetime.fromtimestamp(number / 1000 if abs(number) >= 1e11 else number, timezone.utc)
    text = str(value).strip()
    parsed = None
    try:
        if 'T' not in text and ' ' not in text:
            raise ValueError("A capture date and time are required")
        parsed = datetime.fromisoformat(text.replace('Z', '+00:00'))
    except ValueError:
        for fmt in ('%d-%m-%Y %H:%M:%S', '%d/%m/%Y %H:%M:%S'):
            try:
                parsed = datetime.strptime(text, fmt)
                break
            except ValueError:
                pass
    if parsed is None:
        raise ValueError("Unrecognized timestamp")
    if parsed.tzinfo is None:
        if not naive_timezone:
            raise ValueError("Timestamp has no offset; configure its source timezone")
        zone = ZoneInfo(naive_timezone)
        first, second = parsed.replace(tzinfo=zone, fold=0), parsed.replace(tzinfo=zone, fold=1)
        if first.utcoffset() != second.utcoffset():
            raise ValueError("Ambiguous or nonexistent local time; supply an explicit UTC offset")
        parsed = first
    return parsed.astimezone(timezone.utc)


def iso(value):
    return value.isoformat(timespec='microseconds').replace('+00:00', 'Z')


def numeric(value):
    try:
        if value is None or isinstance(value, bool) or str(value).strip() == '':
            return None
        number = float(value)
        return number if math.isfinite(number) else None
    except (ValueError, TypeError):
        return None


class TelemetryIndex:
    def __init__(self, path, naive_timezone=None):
        self.path = Path(path)
        self.timezone = naive_timezone
        self.signature = None
        self.rows, self.times = [], []
        self.record_times = []
        self.summary = {'state': 'missing', 'rows': 0, 'valid_rows': 0, 'rejected_rows': 0}

    def reload(self):
        try:
            stat = self.path.stat()
        except FileNotFoundError:
            self.rows, self.times, self.signature = [], [], None
            self.record_times = []
            self.summary = {'state': 'missing', 'rows': 0, 'valid_rows': 0, 'rejected_rows': 0}
            return True
        signature = (stat.st_mtime_ns, stat.st_size)
        if self.signature == signature:
            return False
        # A concurrent writer may be halfway through a row. Only consume complete lines.
        raw = self.path.read_bytes()
        end = raw.rfind(b'\n')
        complete = raw[:end + 1] if end >= 0 else b''
        reader = csv.DictReader(io.StringIO(complete.decode('utf-8-sig')))
        headers = {str(h).strip().lower(): h for h in (reader.fieldnames or [])}
        def column(*names):
            return next((headers[n] for n in names if n in headers), None)
        timestamp = column('timestamp_utc', 'timestamp_local', 'timestamp', 'time')
        latitude, longitude = column('latitude', 'lat'), column('longitude', 'lon', 'lng')
        if not timestamp or not latitude or not longitude:
            self.rows, self.times, self.signature = [], [], signature
            self.record_times = []
            self.summary = {'state': 'invalid_header', 'rows': 0, 'valid_rows': 0, 'rejected_rows': 0}
            return True
        valid, total, rejected = [], 0, 0
        reasons, record_times = Counter(), set()
        short_rows = 0
        for line, row in enumerate(reader, 2):
            total += 1
            try:
                t = parse_timestamp(row.get(timestamp), self.timezone)
                record_times.add(t.timestamp())
                if any(value is None for key, value in row.items() if key is not None):
                    short_rows += 1
                if None in row:
                    reasons['extra_columns'] += 1
                    raise ValueError('CSV row contains more columns than its header')
                lat, lon = numeric(row.get(latitude)), numeric(row.get(longitude))
                fix = numeric(row.get('gps_fix_type', row.get('fix_type')))
                if lat is None or lon is None:
                    reasons['missing_coordinates'] += 1
                    raise ValueError('Missing GPS')
                if abs(lat) > 90 or abs(lon) > 180:
                    reasons['invalid_coordinates'] += 1
                    raise ValueError('Invalid GPS')
                if lat == 0 and lon == 0:
                    reasons['zero_coordinates'] += 1
                    raise ValueError('Zero coordinate from the flight controller')
                if fix is not None and fix < 3:
                    reasons['no_3d_fix'] += 1
                    raise ValueError('No 3D GPS fix')
                valid.append({'timestamp': iso(t), 'epoch': t.timestamp(), 'latitude': lat, 'longitude': lon,
                              'line': line, 'raw': {k: v for k, v in row.items() if k is not None}})
            except (ValueError, TypeError, OverflowError):
                rejected += 1
        valid.sort(key=lambda r: r['epoch'])
        self.rows, self.times, self.signature = valid, [r['epoch'] for r in valid], signature
        self.record_times = sorted(record_times)
        reasons['invalid_timestamp'] = rejected - sum(reasons.values())
        self.summary = {'state': 'ready' if valid else 'empty', 'rows': total, 'valid_rows': len(valid),
                        'rejected_rows': rejected, 'first_timestamp': valid[0]['timestamp'] if valid else None,
                        'last_timestamp': valid[-1]['timestamp'] if valid else None,
                        'first_record_timestamp': iso(datetime.fromtimestamp(self.record_times[0], timezone.utc)) if self.record_times else None,
                        'last_record_timestamp': iso(datetime.fromtimestamp(self.record_times[-1], timezone.utc)) if self.record_times else None,
                        'short_rows': short_rows, 'rejection_reasons': dict(reasons),
                        'timestamp_column': timestamp}
        return True

    def lookup(self, value, max_gap=2.0, detection_timezone=None, clock_offset=0.0):
        if not math.isfinite(max_gap) or max_gap < 0 or not math.isfinite(clock_offset):
            raise ValueError('Invalid matching configuration')
        try:
            original = parse_timestamp(value, detection_timezone)
        except (ValueError, TypeError, OverflowError) as error:
            return {'status': 'invalid_timestamp', 'reason': str(error), 'matched': False}
        target = original + timedelta(seconds=clock_offset)
        base = {'capture_timestamp': iso(original), 'lookup_timestamp': iso(target),
                'clock_offset_seconds': clock_offset, 'max_gap_seconds': max_gap, 'matched': False}
        if self.record_times:
            at = bisect.bisect_left(self.record_times, target.timestamp())
            nearest = min((self.record_times[i] for i in (at-1, at) if 0 <= i < len(self.record_times)),
                          key=lambda epoch: (abs(epoch - target.timestamp()), epoch))
            base.update(nearest_record_timestamp=iso(datetime.fromtimestamp(nearest, timezone.utc)),
                        nearest_record_gap_seconds=round(abs(nearest - target.timestamp()), 6))
        if not self.rows:
            reasons = self.summary.get('rejection_reasons', {})
            reason = ('CSV is missing; waiting for the telemetry logger.' if self.summary['state'] == 'missing' else
                      'CSV needs timestamp, latitude and longitude columns.' if self.summary['state'] == 'invalid_header' else
                      f"No valid GPS positions: {reasons.get('zero_coordinates', 0)} rows contain (0, 0); "
                      f"{reasons.get('missing_coordinates', 0)} have missing coordinates. Waiting for usable GPS.")
            return {**base, 'status': 'waiting_for_telemetry', 'reason': reason}
        index = bisect.bisect_left(self.times, target.timestamp())
        candidates = [i for i in (index - 1, index) if 0 <= i < len(self.rows)]
        row = min((self.rows[i] for i in candidates), key=lambda r: (abs(r['epoch'] - target.timestamp()), r['epoch']))
        gap = abs(row['epoch'] - target.timestamp())
        base.update(telemetry_timestamp=row['timestamp'], gap_seconds=round(gap, 6))
        if gap > max_gap + 1e-6:
            return {**base, 'status': 'outside_tolerance', 'reason': 'Nearest GPS sample exceeds the allowed time gap.'}
        return {**base, 'matched': True, 'status': 'matched', 'method': 'exact' if gap <= 1e-6 else 'nearest',
                'latitude': row['latitude'], 'longitude': row['longitude'], 'csv_line': row['line'],
                'telemetry': row['raw']}


def main():
    from config import load_environment, setting_path
    import os
    load_environment()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('timestamp')
    parser.add_argument('--csv', default=str(setting_path('TELEMETRY_CSV_PATH', 'telemetry/DroneTelemetry/telemetry.csv')))
    parser.add_argument('--timezone', default=os.getenv('FIREBASE_TIMESTAMP_TIMEZONE', 'Asia/Kolkata'), help='Timezone for detection timestamps without an explicit UTC offset')
    parser.add_argument('--telemetry-timezone', default=os.getenv('TELEMETRY_TIMESTAMP_TIMEZONE', 'Asia/Kolkata'))
    parser.add_argument('--max-gap', type=float, default=float(os.getenv('TELEMETRY_MAX_GAP_SECONDS', '2')))
    parser.add_argument('--clock-offset', type=float, default=float(os.getenv('DETECTION_CLOCK_OFFSET_SECONDS', '0')))
    args = parser.parse_args()
    index = TelemetryIndex(args.csv, args.telemetry_timezone)
    index.reload()
    result = index.lookup(args.timestamp, args.max_gap, args.timezone, args.clock_offset)
    print(json.dumps(result, indent=2, allow_nan=False))
    return 0 if result['matched'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
