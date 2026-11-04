import csv
import math
import os
from datetime import datetime
from pymavlink import mavutil

# This script LISTENS for Mission Planner's outbound TCP MAVLink stream.
HOST = "127.0.0.1"
PORT = 5760

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "DroneTelemetry")
os.makedirs(OUTPUT_DIR, exist_ok=True)
CSV_FILE = os.path.join(OUTPUT_DIR, "telemetry.csv")

metrics = {
    "latitude": None,
    "longitude": None,
    "altitude_m": None,
    "relative_altitude_m": None,
    "ground_speed_m_s": None,
    "roll_deg": None,
    "pitch_deg": None,
    "yaw_deg": None,
    "battery_voltage_v": None,
    "battery_remaining_percent": None,
    "flight_mode": None,
    "armed": None,
}

def main():
    endpoint = f"tcpin:{HOST}:{PORT}"
    print(f"Starting TCP listener at {HOST}:{PORT} ...")
    print("Now configure Mission Planner SerialOutput - Mavlink as:")
    print("  Type: TCP | Direction: Outbound | Host/Baud: 127.0.0.1:5760")
    print("Start/Go the Mission Planner output after this listener is running.")
    print("Waiting for Mission Planner to connect... (Ctrl+C to stop)")

    master = mavutil.mavlink_connection(endpoint, dialect="ardupilotmega")
    try:
        master.wait_heartbeat()  # wait until a heartbeat arrives
        print(f"\nMAVLink heartbeat received (system {master.target_system}).")
        print(f"Writing live metrics to: {CSV_FILE}")

        file_exists = os.path.exists(CSV_FILE) and os.path.getsize(CSV_FILE) > 0
        with open(CSV_FILE, "a", newline="", buffering=1, encoding="utf-8") as f:
            writer = csv.writer(f)
            if not file_exists:
                writer.writerow(["timestamp_local", *metrics.keys()])

            while True:
                msg = master.recv_match(blocking=True, timeout=2)
                if msg is None:
                    continue

                kind = msg.get_type()
                if kind == "GLOBAL_POSITION_INT":
                    metrics["latitude"] = msg.lat / 1e7
                    metrics["longitude"] = msg.lon / 1e7
                    metrics["altitude_m"] = msg.alt / 1000.0
                    metrics["relative_altitude_m"] = msg.relative_alt / 1000.0
                elif kind == "VFR_HUD":
                    metrics["ground_speed_m_s"] = msg.groundspeed
                elif kind == "ATTITUDE":
                    metrics["roll_deg"] = math.degrees(msg.roll)
                    metrics["pitch_deg"] = math.degrees(msg.pitch)
                    metrics["yaw_deg"] = math.degrees(msg.yaw)
                elif kind == "SYS_STATUS":
                    if msg.voltage_battery != 65535:
                        metrics["battery_voltage_v"] = msg.voltage_battery / 1000.0
                    if msg.battery_remaining >= 0:
                        metrics["battery_remaining_percent"] = msg.battery_remaining
                elif kind == "BATTERY_STATUS":
                    if msg.battery_remaining >= 0:
                        metrics["battery_remaining_percent"] = msg.battery_remaining
                    if msg.voltages:
                        total_mv = sum(v for v in msg.voltages if v != 65535)
                        if total_mv:
                            metrics["battery_voltage_v"] = total_mv / 1000.0
                elif kind == "HEARTBEAT" and msg.type != mavutil.mavlink.MAV_TYPE_GCS:
                    metrics["flight_mode"] = mavutil.mode_string_v10(msg)
                    metrics["armed"] = bool(
                        msg.base_mode & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED
                    )

                timestamp = datetime.now().astimezone().isoformat(timespec="milliseconds")
                writer.writerow([timestamp, *metrics.values()])
                f.flush()

                print(
                    f"\r{timestamp} | "
                    f"Lat: {metrics['latitude']} | Lon: {metrics['longitude']} | "
                    f"Alt: {metrics['relative_altitude_m']} m | "
                    f"Speed: {metrics['ground_speed_m_s']} m/s | "
                    f"Battery: {metrics['battery_voltage_v']} V | "
                    f"Mode: {metrics['flight_mode']}   ",
                    end="",
                    flush=True,
                )

    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        master.close()
        print(f"\nCSV saved at: {CSV_FILE}")

if __name__ == "__main__":
    main()
