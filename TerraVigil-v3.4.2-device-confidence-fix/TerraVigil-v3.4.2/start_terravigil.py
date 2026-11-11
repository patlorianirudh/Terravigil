#!/usr/bin/env python3
"""TerraVigil: one Python entry point for setup, Firebase, telemetry, and dashboard."""
import argparse
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import uuid
import webbrowser
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'telemetry'))
from config import load_environment, setting_path


def run(command, cwd=ROOT, env=None):
    # npm.cmd needs cmd.exe on Windows. list2cmdline quotes paths containing spaces.
    if os.name == 'nt' and str(command[0]).lower().endswith(('.cmd', '.bat')):
        command = [os.environ.get('COMSPEC', 'cmd.exe'), '/d', '/s', '/c', subprocess.list2cmdline([str(x) for x in command])]
    result = subprocess.run([str(x) for x in command], cwd=cwd, env=env)
    if result.returncode:
        raise RuntimeError(f'{Path(command[0]).name} failed (exit {result.returncode}). See the message above.')


def python_executable():
    return ROOT / '.venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')


def prerequisites():
    if not (3, 10) <= sys.version_info[:2] < (3, 13):
        command = 'py -3.12 start_terravigil.py' if os.name == 'nt' else 'python3.12 start_terravigil.py'
        raise RuntimeError(f'Use Python 3.10, 3.11, or 3.12; Python 3.12 is recommended. Try: {command}')
    node = shutil.which('node')
    npm = shutil.which('npm.cmd' if os.name == 'nt' else 'npm')
    if not node or not npm:
        raise RuntimeError('Install Node.js 22.12+ (version 22) or Node.js 24, then reopen the terminal.')
    version = subprocess.check_output([node, '--version'], text=True).strip().lstrip('v').split('.')
    if not (int(version[0]) == 24 or (int(version[0]) == 22 and int(version[1]) >= 12)):
        raise RuntimeError('This project supports Node.js 22.12+ within version 22, or version 24.')
    npm_cli = Path(npm).parent / 'node_modules/npm/bin/npm-cli.js'
    # Standard Windows Node installs expose npm-cli.js beside npm.cmd. Avoid shell quoting.
    return node, [node, str(npm_cli)] if npm_cli.is_file() else [npm]


def frontend_needs_build():
    """Return True when a frontend source/config file is newer than the built app."""
    frontend = ROOT / 'frontend'
    built_index = frontend / 'dist/index.html'
    if not built_index.exists():
        return True
    built_time = built_index.stat().st_mtime_ns
    candidates = [
        frontend / 'index.html',
        frontend / 'package.json',
        frontend / 'package-lock.json',
        frontend / 'vite.config.ts',
        frontend / 'tsconfig.json',
        frontend / 'tailwind.config.js',
        frontend / 'postcss.config.js',
    ]
    source_dir = frontend / 'src'
    if source_dir.exists():
        candidates.extend(path for path in source_dir.rglob('*') if path.is_file())
    public_dir = frontend / 'public'
    if public_dir.exists():
        candidates.extend(path for path in public_dir.rglob('*') if path.is_file())
    return any(path.exists() and path.stat().st_mtime_ns > built_time for path in candidates)


def setup(node, npm, force=False, rebuild=False):
    environment = ROOT / 'backend/.env'
    if not environment.exists():
        shutil.copyfile(ROOT / 'backend/.env.example', environment)
    executable = python_executable()
    if not executable.exists():
        run([sys.executable, '-m', 'venv', ROOT / '.venv'])
    check = subprocess.run([str(executable), '-c', 'import firebase_admin, pymavlink, PIL, tzdata'], capture_output=True)
    if force or check.returncode:
        print('Installing Python Firebase, image, and telemetry support...', flush=True)
        run([executable, '-m', 'pip', 'install', '-r', ROOT / 'telemetry/requirements.txt'])
    if force or not (ROOT / 'backend/node_modules/express/package.json').exists():
        print('Installing backend dependencies...', flush=True)
        install_env = os.environ.copy()
        # CPU ONNX is bundled. The ground-station app needs no optional CUDA download.
        install_env.setdefault('ONNXRUNTIME_NODE_INSTALL', 'skip')
        run([*npm, 'ci', '--no-audit', '--no-fund'], ROOT / 'backend', env=install_env)
    should_build_frontend = force or rebuild or frontend_needs_build()
    frontend_vite = ROOT / 'frontend/node_modules/vite/package.json'
    if should_build_frontend:
        if force or not frontend_vite.exists():
            print('Installing frontend dependencies...', flush=True)
            run([*npm, 'ci', '--no-audit', '--no-fund'], ROOT / 'frontend')
        print('Building the frontend...', flush=True)
        run([*npm, 'run', 'build'], ROOT / 'frontend')


def get_json(url):
    with urlopen(url, timeout=3) as response:
        return json.load(response)


def start_child(command, label, env):
    options = {'creationflags': subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == 'nt' else {'start_new_session': True}
    child = subprocess.Popen([str(x) for x in command], cwd=ROOT, env=env, stdout=subprocess.PIPE,
                             stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace', bufsize=1, **options)
    def output():
        for line in child.stdout:
            print(f'[{label}] {line.rstrip()}', flush=True)
    threading.Thread(target=output, daemon=True).start()
    return child


def stop_child(child):
    if child.poll() is not None:
        return
    if os.name == 'nt':
        # Stop the backend's Python bridge as well as the parent node process.
        subprocess.run(['taskkill', '/PID', str(child.pid), '/T', '/F'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        try:
            os.killpg(child.pid, signal.SIGTERM)
            child.wait(timeout=8)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


def build_environment(args):
    env = os.environ.copy()
    env.update(PYTHONUNBUFFERED='1', PYTHONIOENCODING='utf-8', TELEMETRY_PYTHON=str(python_executable()), PORT=str(args.port))
    csv_path = Path(args.csv).expanduser().resolve() if args.csv else setting_path('TELEMETRY_CSV_PATH', 'telemetry/DroneTelemetry/telemetry.csv')
    if args.mode == 'recorded' and not args.csv:
        csv_path = ROOT / 'reference/telemetry.csv'
    if args.mission:
        env['FIREBASE_MISSION_ID'] = args.mission
    if args.mode == 'test':
        mission = 'TV-FBTEST-' + datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S-') + uuid.uuid4().hex[:6]
        folder = ROOT / '.runtime/tests' / mission
        folder.mkdir(parents=True, exist_ok=True)
        env.update(FIREBASE_MISSION_ID=mission, FIREBASE_DETECTIONS_PATH=f'TerraVigil/tests/{mission}/detections',
                   TERRAVIGIL_DB='local', TERRAVIGIL_DATA_DIR=str(folder / 'data'),
                   DETECTION_IMAGE_DIR=str(folder / 'images'), TERRAVIGIL_TEST_MODE='true',
                   DETECTION_CLOCK_OFFSET_SECONDS='0')
        csv_path = Path(args.csv).expanduser().resolve() if args.csv else ROOT / 'reference/telemetry.csv'
    else:
        env['TERRAVIGIL_TEST_MODE'] = 'false'
    env['TELEMETRY_CSV_PATH'] = str(csv_path)
    if args.no_firebase:
        env['FIREBASE_ENABLED'] = 'false'
    if args.mode == 'test':
        keep = ['FIREBASE_MISSION_ID', 'FIREBASE_DETECTIONS_PATH', 'TELEMETRY_CSV_PATH',
                'DETECTION_IMAGE_DIR', 'TELEMETRY_TIMESTAMP_TIMEZONE', 'FIREBASE_DATABASE_URL', 'PORT']
        (ROOT / '.runtime/last_test.json').write_text(json.dumps({k: env[k] for k in keep if k in env}, indent=2))
    return env


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--setup', action='store_true', help='Install dependencies and rebuild frontend, then exit')
    parser.add_argument('--rebuild', action='store_true', help='Rebuild frontend before starting')
    parser.add_argument('--mode', choices=['live', 'recorded', 'test'], default='live')
    parser.add_argument('--csv', help='Telemetry CSV path (relative paths are relative to your current directory)')
    parser.add_argument('--mission', help='New live/recorded mission ID; test mode always uses an isolated ID')
    parser.add_argument('--port', type=int)
    parser.add_argument('--no-telemetry', action='store_true', help='Use an already-running telemetry logger')
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--no-firebase', action='store_true', help='Start the local UI without Firebase')
    args = parser.parse_args(argv)
    load_environment()
    args.port = args.port or int(os.getenv('PORT', '3000'))
    if not 1 <= args.port <= 65535:
        parser.error('Port must be 1..65535')
    if args.no_firebase and args.mode == 'test':
        parser.error('Test mode uses real Firebase; omit --no-firebase.')
    node, npm = prerequisites()
    setup(node, npm, force=args.setup, rebuild=args.rebuild)
    load_environment()
    if args.setup:
        print('Setup complete. Run: py -3.12 start_terravigil.py')
        return 0
    env = build_environment(args)
    if env.get('FIREBASE_ENABLED', 'true') != 'false':
        credential = setting_path('FIREBASE_SERVICE_ACCOUNT', 'backend/serviceAccountKey.json')
        if not credential.is_file():
            raise RuntimeError('Copy your existing Firebase serviceAccountKey.json into the backend folder, then run this command again.')
    if args.mode != 'live' and not Path(env['TELEMETRY_CSV_PATH']).is_file():
        raise RuntimeError('Recorded telemetry CSV not found. Supply --csv with its path.')
    # Fail before starting any child if another application owns this port.
    with socket.socket() as check:
        try:
            check.bind(('127.0.0.1', args.port))
        except OSError:
            raise RuntimeError(f'Port {args.port} is in use. Stop the other app or choose --port 3001.') from None
    children = []
    interrupted = False
    telemetry_child = None
    telemetry_warned = False
    def request_stop(_signum, _frame):
        nonlocal interrupted
        interrupted = True
    old_signals = {sig: signal.signal(sig, request_stop) for sig in (signal.SIGINT, signal.SIGTERM)}
    try:
        backend = start_child([node, ROOT / 'backend/integrated-server.js'], 'app', env)
        children.append(backend)
        if args.mode == 'live' and not args.no_telemetry:
            telemetry_child = start_child([python_executable(), '-u', ROOT / 'telemetry/drone_metrics_forwarded.py'], 'telemetry', env)
            children.append(telemetry_child)
        base = f'http://127.0.0.1:{args.port}'
        deadline = time.monotonic() + 35
        while not interrupted:
            # Only the backend is required for the dashboard. The telemetry
            # logger may wait on or lose the MAVLink connection; the dashboard
            # (including the live CSV preview) stays open either way.
            if backend.poll() is not None:
                raise RuntimeError('The app backend stopped during startup. See its message above.')
            try:
                if get_json(base + '/api/health').get('status') == 'ok':
                    break
            except (OSError, ValueError):
                pass
            if time.monotonic() > deadline:
                raise RuntimeError('Backend startup timed out. See the app messages above.')
            time.sleep(.25)
        if interrupted:
            return 0
        mission = env.get('FIREBASE_MISSION_ID', 'TV-LIVE-001')
        print(f'\nDashboard: {base}/?mission={mission}\nConnections: {base}/connections\nLive CSV preview: {base}/live-preview\nFirebase branch: {env.get("FIREBASE_DETECTIONS_PATH", "detections")}\nCSV: {env["TELEMETRY_CSV_PATH"]}\nThe dashboard is ready. If telemetry is still connecting, that is fine — live values appear on the dashboard and the live preview as soon as the CSV updates.\nAutomatic timestamp matching is running; no lookup or y/n input is needed.\nPress Ctrl+C to stop all services.', flush=True)
        if not args.no_browser:
            webbrowser.open(base + '/?mission=' + mission)
        if args.mode == 'test':
            print('REAL FIREBASE / TEST IMAGES: sending three marked test records to the isolated test branch.', flush=True)
            children.append(start_child([python_executable(), ROOT / 'send_firebase_test_images.py'], 'test', env))
        sender_checked = False
        while not interrupted:
            if backend.poll() is not None:
                raise RuntimeError('Backend stopped unexpectedly.')
            # The telemetry logger is not fatal: losing or never gaining the
            # MAVLink connection keeps the dashboard available for review.
            if telemetry_child is not None and not telemetry_warned and telemetry_child.poll() is not None:
                telemetry_warned = True
                print('Telemetry logger stopped; the dashboard stays open. Restart this command (or check the [telemetry] messages above) to resume CSV logging.', flush=True)
            if args.mode == 'test' and not sender_checked and children[-1].poll() is not None:
                sender_checked = True
                if children[-1].returncode:
                    print('Test sender needs attention. The dashboard remains open; check its message above.', flush=True)
            time.sleep(.25)
    finally:
        for child in reversed(children):
            stop_child(child)
        for sig, previous in old_signals.items():
            signal.signal(sig, previous)
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (RuntimeError, OSError, ValueError) as error:
        print(f'\nTerraVigil: {error}', file=sys.stderr)
        raise SystemExit(1)
    except KeyboardInterrupt:
        raise SystemExit(130)
