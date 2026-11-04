/**
 * Realtime transport — PRD §19.2 (telemetry, detections, alerts, coverage).
 *
 * A real socket.io client. It connects lazily on the first subscription and
 * disconnects when the last one goes away, so routes that show no live data
 * hold no socket open. Nothing is simulated here: with no backend reachable,
 * `connectionState` reports that and no events arrive.
 */

import { io, type Socket } from 'socket.io-client';

import { config } from '../config';
import { getAuthToken } from './http';
import type { Unsubscribe } from './errors';
import type { CoverageSummary, Detection, SystemEventAlert, TrackPoint } from '../domain/types';
import type { CoverageSummaryDto, DetectionDto, SystemEventAlertDto, TrackPointDto } from './dto';
import { toCoverageSummary, toDetection, toSystemEventAlert, toTrackPoint } from './mappers';

export type ConnectionState = 'unconfigured' | 'disconnected' | 'connecting' | 'connected' | 'demo';

type Listener<T> = (data: T) => void;

const EVENTS = {
  telemetry: 'telemetry',
  detection: 'detection',
  alert: 'alert',
  coverage: 'coverage',
} as const;

class SocketManager {
  private socket: Socket | null = null;
  private state: ConnectionState =
    config.dataMode === 'demo' ? 'demo' : config.isConfigured ? 'disconnected' : 'unconfigured';

  private readonly telemetryListeners = new Set<Listener<TrackPoint>>();
  private readonly detectionListeners = new Set<Listener<Detection>>();
  private readonly alertListeners = new Set<Listener<SystemEventAlert>>();
  private readonly coverageListeners = new Set<Listener<CoverageSummary>>();
  private readonly stateListeners = new Set<Listener<ConnectionState>>();

  public getConnectionState(): ConnectionState {
    return this.state;
  }

  public subscribeConnectionState(listener: Listener<ConnectionState>): Unsubscribe {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => this.stateListeners.delete(listener);
  }

  public subscribeTelemetry(listener: Listener<TrackPoint>): Unsubscribe {
    return this.track(this.telemetryListeners, listener);
  }

  public subscribeDetection(listener: Listener<Detection>): Unsubscribe {
    return this.track(this.detectionListeners, listener);
  }

  public subscribeAlert(listener: Listener<SystemEventAlert>): Unsubscribe {
    return this.track(this.alertListeners, listener);
  }

  public subscribeCoverage(listener: Listener<CoverageSummary>): Unsubscribe {
    return this.track(this.coverageListeners, listener);
  }

  private track<T>(set: Set<Listener<T>>, listener: Listener<T>): Unsubscribe {
    set.add(listener);
    this.connect();
    return () => {
      set.delete(listener);
      this.disconnectIfIdle();
    };
  }

  private get listenerCount(): number {
    return (
      this.telemetryListeners.size +
      this.detectionListeners.size +
      this.alertListeners.size +
      this.coverageListeners.size
    );
  }

  private setState(next: ConnectionState): void {
    if (this.state === next) return;
    this.state = next;
    this.stateListeners.forEach((l) => {
      l(next);
    });
  }

  private connect(): void {
    if (config.dataMode === 'demo') {
      this.setState('demo');
      return;
    }
    if (config.wsUrl === '') {
      this.setState('unconfigured');
      return;
    }
    if (this.socket !== null) return;

    this.setState('connecting');
    const socket = io(config.wsUrl, {
      transports: ['websocket'],
      withCredentials: true,
      reconnection: true,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 15_000,
      auth: { token: getAuthToken() },
    });
    this.socket = socket;

    socket.on('connect', () => {
      this.setState('connected');
    });
    socket.on('disconnect', () => {
      this.setState('disconnected');
    });
    socket.on('connect_error', () => {
      this.setState('disconnected');
    });

    socket.on(EVENTS.telemetry, (raw: TrackPointDto) => {
      const point = toTrackPoint(raw);
      if (point !== null)
        this.telemetryListeners.forEach((l) => {
          l(point);
        });
    });

    socket.on(EVENTS.detection, (raw: DetectionDto) => {
      const detection = toDetection(raw);
      if (detection !== null)
        this.detectionListeners.forEach((l) => {
          l(detection);
        });
    });

    socket.on(EVENTS.alert, (raw: SystemEventAlertDto) => {
      const alert = toSystemEventAlert(raw);
      if (alert !== null)
        this.alertListeners.forEach((l) => {
          l(alert);
        });
    });

    socket.on(EVENTS.coverage, (raw: CoverageSummaryDto) => {
      const sessionId = raw.sessionId;
      if (sessionId === undefined) return;
      const coverage = toCoverageSummary(raw, sessionId);
      this.coverageListeners.forEach((l) => {
        l(coverage);
      });
    });
  }

  private disconnectIfIdle(): void {
    if (this.listenerCount > 0 || this.socket === null) return;
    this.socket.removeAllListeners();
    this.socket.disconnect();
    this.socket = null;
    this.setState(config.isConfigured ? 'disconnected' : 'unconfigured');
  }
}

export const socketService = new SocketManager();
