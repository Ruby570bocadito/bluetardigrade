#!/usr/bin/env python3
"""Minimal HTTP receiver for end-to-end webhook delivery tests.

Starts a loopback HTTP server, counts the alert POSTs the engine
delivers (with `-webhook` or per-rule `actions.webhook`), and reports
delivery health the way a SIEM receptor would.

Modes:
  - Interactive (default): run until interrupted, then print a JSON
    summary {received, with_auth, last_status}.
  - --expect N --timeout S: exit 0 as soon as N or more requests have
    arrived (or fail after S seconds). Script-friendly for smoke tests;
    deliveries may arrive in bursts, so the check is "at least N".

Every request is answered 200 with an empty JSON body; a --secret can
be set to require `Authorization: Bearer <secret>` (401 otherwise),
matching the engine's `-webhook-token` global auth (and ready for any
receptor-side check of per-rule `actions.webhook` secrets).

Examples:
  python3 scripts/dev-tests/webhook_receiver.py --port 9999
  python3 scripts/dev-tests/webhook_receiver.py --port 9999 --expect 18 --timeout 60

Requires: python3 standard library only.
"""

import argparse
import json
import signal
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

lock = threading.Lock()
stats = {"received": 0, "with_auth": 0, "last_status": None}


class Receiver(BaseHTTPRequestHandler):
    secret = None

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", 0))
        self.rfile.read(length)
        auth = self.headers.get("Authorization")
        if Receiver.secret is not None and auth != f"Bearer {Receiver.secret}":
            status = 401
        else:
            status = 200
            with lock:
                stats["received"] += 1
                if auth:
                    stats["with_auth"] += 1
                stats["last_status"] = status
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b"{}")

    def log_message(self, fmt: str, *args) -> None:  # silence default stderr spam
        pass


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--port", type=int, default=9999)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--secret", default=None,
                    help="require 'Authorization: Bearer <secret>' on every POST")
    ap.add_argument("--expect", type=int, default=None,
                    help="exit 0 after N or more deliveries arrive")
    ap.add_argument("--timeout", type=int, default=60,
                    help="seconds to wait for --expect (default 60)")
    args = ap.parse_args()

    Receiver.secret = args.secret
    server = ThreadingHTTPServer((args.host, args.port), Receiver)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print(f"webhook_receiver listening on http://{args.host}:{args.port}", flush=True)

    stop = threading.Event()

    def finish(signum, _frame):
        stop.set()

    signal.signal(signal.SIGINT, finish)
    signal.signal(signal.SIGTERM, finish)

    if args.expect is not None:
        deadline = time.time() + args.timeout
        while time.time() < deadline and not stop.is_set():
            with lock:
                n = stats["received"]
            if n >= args.expect:
                break
            time.sleep(0.2)
        with lock:
            n = stats["received"]
        server.shutdown()
        print(json.dumps({"received": n, "expected": args.expect,
                          "with_auth": stats["with_auth"]}))
        return 0 if n >= args.expect else 1

    stop.wait()
    server.shutdown()
    print(json.dumps(stats))
    return 0


if __name__ == "__main__":
    sys.exit(main())
