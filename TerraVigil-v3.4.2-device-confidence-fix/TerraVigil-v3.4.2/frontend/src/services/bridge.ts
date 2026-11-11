import { request } from './http';
import { evidenceIdentity } from './missionMappers';
export const bridgeEvidenceId = (mission: string, id: string) =>
  evidenceIdentity('observation', mission, id);

export interface BridgeStatus {
  state: string;
  message: string;
  last_sync: string | null;
  running: boolean;
  test_mode?: boolean;
  mission_id: string;
  counts: { total: number; matched: number; pending: number; invalid: number };
  telemetry?: {
    state: string;
    rows?: number;
    valid_rows: number;
    rejected_rows: number;
    first_timestamp?: string;
    last_timestamp?: string;
    first_record_timestamp?: string;
    last_record_timestamp?: string;
    short_rows?: number;
    rejection_reasons?: Record<string, number>;
  };
  config: null | {
    database_url: string;
    database_path: string;
    credentials_present: boolean;
    csv_present: boolean;
    csv_path: string;
    image_directory: string;
    max_gap_seconds: number;
    clock_offset_seconds: number;
    detection_timezone: string;
    telemetry_timezone: string;
    poll_seconds: number;
  };
}
export interface BridgeEvent {
  event_id: string;
  firebase_id: string;
  mission_id: string;
  class_name?: string | null;
  class_id?: number | string | null;
  device?: 'camera' | 'metal' | string | null;
  confidence?: number | null;
  confidence_score?: number | null;
  confidence_percent?: number | null;
  timestamp_original?: string | number;
  image_path?: string;
  test_record?: boolean;
  image?: { state: string; filename?: string; local_path?: string; message?: string };
  status: string;
  synthetic: boolean;
  match: {
    matched: boolean;
    reason?: string;
    capture_timestamp?: string;
    lookup_timestamp?: string;
    telemetry_timestamp?: string;
    gap_seconds?: number;
    nearest_record_timestamp?: string;
    nearest_record_gap_seconds?: number;
    latitude?: number;
    longitude?: number;
    method?: string;
  };
}
export interface LiveTelemetry {
  state: 'live' | 'waiting' | 'missing' | string;
  message: string | null;
  csv_path: string | null;
  csv_size_bytes?: number | null;
  csv_mtime?: string | null;
  tail_rows?: number | null;
  timestamp?: string | null;
  age_ms?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  latitude_valid?: boolean;
  altitude_m?: number | null;
  relative_altitude_m?: number | null;
  ground_speed_m_s?: number | null;
  roll_deg?: number | null;
  pitch_deg?: number | null;
  yaw_deg?: number | null;
  battery_voltage_v?: number | null;
  battery_remaining_percent?: number | null;
  flight_mode?: string | null;
  armed?: boolean | null;
  gps_fix_type?: number | null;
  satellites?: number | null;
  hdop?: number | null;
  timestamp_source?: string | null;
  received_at_utc?: string | null;
  time_boot_ms?: number | null;
  system_id?: number | null;
  fields?: Record<string, string>;
}

export const bridgeApi = {
  status: () => request<BridgeStatus>('/bridge/status'),
  liveTelemetry: () => request<LiveTelemetry>('/bridge/live-telemetry'),
  events: (missionId?: string) =>
    request<BridgeEvent[]>('/bridge/events', { query: { mission_id: missionId } }),
  restart: () => request<BridgeStatus>('/bridge/restart', { method: 'POST', body: {} }),
};
