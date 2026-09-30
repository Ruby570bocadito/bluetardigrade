#!/usr/bin/env python3
"""Capture receiver for end-to-end notification channel tests.

Stands in for Slack and Telegram Bot API during smoke tests: any POST
is recorded (path + JSON body) into a JSONL capture file and answered
200 with an {"ok": true} body, the way both APIs answer success.

Modes:
  - Interactive (default): run until interrupted, then print a JSON
    summary {captured, last_path}.
  - --expect N --timeout S: exit 0 as soon as N or more payloads have
    arrived (or fail after S seconds). Script-friendly for smoke
    tests; deliveries may arrive in bursts, so the check is
    "at least N".

Examples:
  python3 scripts/dev-tests/notify_receiver.py --port 18301 --out /tmp/cap.jsonl
  python3 scripts/dev-tests/notify_receiver.py --port 18301 --out /tmp/cap.jsonl --expect 4 --timeout 60

Requires: python3 standard library only.
"""

import argparse
import json
import signal
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

captured = 0
last_path = ""
lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        global captured, last_path
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            body = {"raw": raw.decode("utf-8", "replace")}
        with lock:
            captured += 1
            last_path = self.path
            if args.out:
                with open(args.out, "a", encoding="utf-8") as fh:
                    fh.write(json.dumps({"path": self.path, "body": body}) + "\n")
        payload = json.dumps({"ok": True}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, fmt, *a):  # silence per-request stderr noise
        pass


parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
parser.add_argument("--port", type=int, default=18301, help="loopback port to listen on")
parser.add_argument("--out", default="", help="JSONL capture file (one payload per line)")
parser.add_argument("--expect", type=int, default=0, help="exit 0 once N payloads arrived")
parser.add_argument("--timeout", type=int, default=0, help="seconds to wait for --expect")
args = parser.parse_args()

srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
print(f"notify_receiver listening on 127.0.0.1:{args.port}", flush=True)

if not args.expect:
    try:
        signal.pause()
    except KeyboardInterrupt:
        pass
    print(json.dumps({"captured": captured, "last_path": last_path}))
    sys.exit(0)

deadline = time.time() + args.timeout
while time.time() < deadline:
    with lock:
        if captured >= args.expect:
            print(json.dumps({"captured": captured, "last_path": last_path}))
            srv.shutdown()
            sys.exit(0)
    time.sleep(0.2)
print(json.dumps({"captured": captured, "last_path": last_path, "error": "timeout"}))
srv.shutdown()
sys.exit(1)
