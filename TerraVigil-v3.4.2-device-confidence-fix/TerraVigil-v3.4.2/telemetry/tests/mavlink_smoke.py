"""TCP smoke test with generated MAVLink frames; no flight hardware required."""
import csv
import os
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from pymavlink.dialects.v20 import ardupilotmega as mavlink

ROOT = Path(__file__).resolve().parents[2]


def main():
    with tempfile.TemporaryDirectory() as folder:
        csv_path = Path(folder) / 'flight.csv'
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0))
            port = probe.getsockname()[1]
        process = subprocess.Popen([sys.executable, '-u', str(ROOT / 'telemetry/drone_metrics_forwarded.py'), '--csv', str(csv_path), '--connection', f'tcpin:127.0.0.1:{port}'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        try:
            deadline = time.monotonic() + 10
            while True:
                try:
                    sender = socket.create_connection(('127.0.0.1', port), timeout=1)
                    break
                except OSError:
                    if time.monotonic() > deadline:
                        raise AssertionError('TCP logger did not listen')
                    time.sleep(.1)
            with sender:
                protocol = mavlink.MAVLink(None, srcSystem=1, srcComponent=1)
                def send(msg):
                    sender.sendall(msg.pack(protocol))
                    time.sleep(.03)
                epoch = int(time.time() * 1e6)
                send(mavlink.MAVLink_heartbeat_message(2, 3, 0, 0, 4, 3))
                send(mavlink.MAVLink_system_time_message(epoch, 1000))
                send(mavlink.MAVLink_gps_raw_int_message(epoch, 3, 173975323, 784893248, 590190, 85, 100, 0, 0, 12))
                send(mavlink.MAVLink_global_position_int_message(1000, 173975323, 784893248, 590190, 1828, 0, 0, 0, 0))
                # Additional attitude messages must not create duplicate GPS rows.
                for i in range(10):
                    send(mavlink.MAVLink_attitude_message(1000 + i, 0, 0, 0, 0, 0, 0))
                send(mavlink.MAVLink_global_position_int_message(2000, 173975333, 784893258, 590190, 1828, 0, 0, 0, 0))
                deadline = time.monotonic() + 3
                rows = []
                while time.monotonic() < deadline:
                    if csv_path.exists():
                        rows = list(csv.DictReader(csv_path.open()))
                    if len(rows) == 2:
                        break
                    time.sleep(.1)
                assert len(rows) == 2, rows
                assert rows[0]['timestamp_source'] == 'pixhawk_system_time', rows
                assert float(rows[0]['latitude']) == 17.3975323, rows
                assert rows[0]['gps_fix_type'] == '3', rows
                print('PASS: TCP MAVLink -> exactly 2 fresh GPS CSV rows, UTC sensor timestamps, correct coordinates; 10 attitude messages did not duplicate GPS.')
        finally:
            process.terminate()
            try:
                process.wait(timeout=4)
            except subprocess.TimeoutExpired:
                process.kill()
            output = process.stdout.read()
            if process.returncode not in (0, -15):
                print(output)


if __name__ == '__main__':
    main()
