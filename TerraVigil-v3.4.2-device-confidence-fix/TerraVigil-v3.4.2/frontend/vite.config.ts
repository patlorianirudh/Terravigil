import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

// ── npm run dev live preview ────────────────────────────────────────────────
// Serves /api/bridge/live-telemetry by tailing the telemetry CSV directly, so
// the Live preview page works with `npm run dev` alone — no backend, no
// Firebase, no MAVLink chain. Read-only.
function liveTelemetryDevPlugin(): Plugin {
  const csvPath = path.resolve(
    projectRoot,
    process.env.TELEMETRY_CSV_PATH || 'telemetry/DroneTelemetry/telemetry.csv',
  );
  const TAIL_BYTES = 64 * 1024;
  const MERGE_ROWS = 40;
  const MERGE_WINDOW_MS = 15_000;
  const respond = (res: any, status: number, body: unknown) => {
    const payload = JSON.stringify(body);
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(payload);
  };
  const readTail = () => {
    if (!fs.existsSync(csvPath)) return null;
    const stat = fs.statSync(csvPath);
    const handle = fs.openSync(csvPath, 'r');
    try {
      const head = Buffer.alloc(4096);
      const headRead = fs.readSync(handle, head, 0, head.length, 0);
      const headText = head.toString('utf8', 0, headRead);
      const newline = headText.indexOf('\n');
      const headerText = newline === -1 ? headText : headText.slice(0, newline);
      const header = headerText.trim().split(',');
      const length = Math.min(TAIL_BYTES, stat.size);
      const buffer = Buffer.alloc(length);
      fs.readSync(handle, buffer, 0, length, stat.size - length);
      const lines = buffer
        .toString('utf8')
        .split('\n')
        .filter((line) => line.trim() !== '');
      if (length < stat.size && lines.length > 0) lines.shift();
      if (length >= stat.size) lines.shift();
      return { header, lines, stat };
    } finally {
      fs.closeSync(handle);
    }
  };
  return {
    name: 'terravigil-live-telemetry-preview',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/bridge/live-telemetry', (_req, res) => {
        try {
          const tail = readTail();
          if (!tail || tail.header.length === 0) {
            return respond(res, 200, {
              state: 'missing',
              message:
                'Telemetry CSV not found. Start the MAVLink logger, or set TELEMETRY_CSV_PATH when running npm run dev.',
              csv_path: csvPath,
            });
          }
          if (tail.lines.length === 0) {
            return respond(res, 200, {
              state: 'waiting',
              message: 'Telemetry CSV has no rows yet. Values appear as soon as MAVLink telemetry is logged.',
              csv_path: csvPath,
            });
          }
          const merged: Record<string, string> = {};
          const newestLine = tail.lines.at(-1) ?? '';
          const newestTime = Date.parse(newestLine.split(',')[0] ?? '');
          for (
            let index = tail.lines.length - 1;
            index >= Math.max(0, tail.lines.length - MERGE_ROWS);
            index -= 1
          ) {
            const values = (tail.lines[index] ?? '').split(',');
            const rowTime = Date.parse(values[0] ?? '');
            if (
              Number.isFinite(newestTime) &&
              Number.isFinite(rowTime) &&
              newestTime - rowTime > MERGE_WINDOW_MS
            )
              break;
            tail.header.forEach((column, position) => {
              const value = values[position];
              if (value !== undefined && value.trim() !== '' && merged[column] === undefined)
                merged[column] = value.trim();
            });
          }
          const num = (key: string) => {
            const parsed = Number(merged[key]);
            return merged[key] !== undefined && Number.isFinite(parsed) ? parsed : null;
          };
          const timestamp = merged.timestamp_utc ?? null;
          const parsedTime = timestamp === null ? null : Date.parse(timestamp);
          respond(res, 200, {
            state: 'live',
            message: 'Streaming from the telemetry CSV (Vite dev preview).',
            csv_path: csvPath,
            csv_size_bytes: tail.stat.size,
            csv_mtime: tail.stat.mtime.toISOString(),
            tail_rows: tail.lines.length,
            timestamp,
            age_ms:
              parsedTime !== null && Number.isFinite(parsedTime)
                ? Math.max(0, Date.now() - parsedTime)
                : null,
            latitude: num('latitude'),
            longitude: num('longitude'),
            altitude_m: num('altitude_m'),
            relative_altitude_m: num('relative_altitude_m'),
            ground_speed_m_s: num('ground_speed_m_s'),
            roll_deg: num('roll_deg'),
            pitch_deg: num('pitch_deg'),
            yaw_deg: num('yaw_deg'),
            battery_voltage_v: num('battery_voltage_v'),
            battery_remaining_percent: num('battery_remaining_percent'),
            flight_mode: merged.flight_mode || null,
            armed:
              merged.armed === 'true' || merged.armed === 'True'
                ? true
                : merged.armed === 'false' || merged.armed === 'False'
                  ? false
                  : null,
            gps_fix_type: num('gps_fix_type'),
            satellites: num('satellites'),
            hdop: num('hdop'),
            timestamp_source: merged.timestamp_source || null,
            received_at_utc: merged.received_at_utc || null,
            time_boot_ms: num('time_boot_ms'),
            system_id: num('system_id'),
            fields: merged,
          });
        } catch {
          respond(res, 200, { state: 'missing', message: 'Telemetry CSV could not be read.', csv_path: csvPath });
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    liveTelemetryDevPlugin(),
    {
      name: 'served-build-launch-guidance',
      apply: 'build',
      transformIndexHtml(html) {
        // A served live build must never silently redirect to synthetic data.
        return html
          .replace(/<!-- source-file-launch:start -->[\s\S]*?<!-- source-file-launch:end -->/, '')
          .replace('href="./TerraVigil-preview.html"', 'href="../TerraVigil-preview.html"');
      },
    },
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
