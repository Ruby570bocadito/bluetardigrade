#!/usr/bin/env python3
"""Minimal SIEM receivers for end-to-end sink delivery tests.

Emulates the two SIEM ingestion contracts the engine speaks, so the
`-elastic` and `-splunk` sinks can be exercised over real HTTP on a
loopback lab. This is a clearly labeled TEST FIXTURE (like
webhook_receiver.py): it never ships inside the engine, it exists so
the delivery path can be verified end to end without a real cluster.

Modes (exactly one --protocol per process):
  elastic  POST /_bulk      — NDJSON meta/doc line pairs answered with a
                              real bulk acknowledgement; counts alerts,
                              records the target index per alert and the
                              Content-Type/Authorization health.
  splunk   POST /services/collector/event — JSON events answered with
                              {"text":"Success","code":0}; counts events,
                              validates the HEC field contract per frame.

Auth is enforced like the real platforms when --secret is given:
  elastic: "Authorization: ApiKey <secret>" required (401 otherwise)
  splunk:  "Authorization: Splunk <secret>" required (403, code 2, the
           real HEC answer for a bad token)

Script-friendly mode: --expect N --timeout S exits 0 as soon as N or
more alerts have arrived (deliveries may lag the replay), 1 otherwise.
Every frame whose shape breaks the protocol is counted in bad_frames
instead of received, so a shape regression cannot hide behind a 200.

Examples:
  python3 siem_receiver.py --protocol elastic --port 18149 --expect 5 --timeout 60
  python3 siem_receiver.py --protocol splunk --port 18150 --secret hec-token

Requires: python3 standard library only.
"""

import argparse
import json
import os
import signal
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

lock = threading.Lock()
stats = {"received": 0, "bad_frames": 0, "with_auth": 0, "indexes": [], "last_status": None}


def dump_stats(path: str) -> None:
    """Persist the live stats after every accepted/rejected frame, so the
    driving script can read them WITHOUT relying on signal handling or
    exit summaries (SIGTERM semantics vary across python shims)."""
    if not path:
        return
    with lock:
        snapshot = dict(stats)
    with open(path, "w") as fh:
        json.dump(snapshot, fh)
        fh.flush()
        os.fsync(fh.fileno())


class BulkHandler(BaseHTTPRequestHandler):
    secret = None
    stats_file = None

    def _authorized(self) -> bool:
        if self.secret is None:
            return True
        return self.headers.get("Authorization") == f"ApiKey {BulkHandler.secret}"

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length).decode("utf-8", "replace")
        status = 200
        n_alerts = 0
        bad = 0
        indexes = []
        if self.path.rstrip("/") != "/_bulk":
            status = 404
        elif not self._authorized():
            status = 401
        else:
            lines = [l for l in raw.split("\n") if l.strip()]
            if len(lines) % 2 != 0:
                bad += 1  # a bulk body must be meta/doc pairs
            else:
                for i in range(0, len(lines), 2):
                    try:
                        meta = json.loads(lines[i])
                        json.loads(lines[i + 1])
                        action = meta["index"]
                        idx = action["_index"]
                        if not action.get("_id"):
                            raise KeyError("_id missing: retries would not be idempotent")
                        if not idx.startswith("sf-alerts-"):
                            raise ValueError(f"unexpected index prefix: {idx}")
                        indexes.append(idx)
                        n_alerts += 1
                    except Exception:
                        bad += 1
        with lock:
            stats["received"] += n_alerts
            stats["bad_frames"] += bad
            stats["indexes"].extend(indexes)
            if self.headers.get("Authorization"):
                stats["with_auth"] += n_alerts
            stats["last_status"] = status
        dump_stats(BulkHandler.stats_file)
        body = json.dumps({
            "took": 0,
            "errors": False,
            "items": [{"index": {"_index": "idx", "status": 201}} for _ in range(n_alerts)],
        }).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):  # silence default stderr spam
        pass


class HECHandler(BaseHTTPRequestHandler):
    secret = None
    stats_file = None

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length).decode("utf-8", "replace")
        status, code, text = 200, 0, "Success"
        n_events = 0
        bad = 0
        if self.path != "/services/collector/event":
            status, code, text = 404, 1, "wrong endpoint"
        elif self.headers.get("Authorization") != f"Splunk {HECHandler.secret}":
            # the real HEC answer for a token problem is HTTP 403 + code 2
            status, code, text = 403, 2, "Invalid token"
        else:
            try:
                ev = json.loads(raw)
                if not isinstance(ev.get("event"), dict):
                    raise ValueError("event must be the alert object")
                if not isinstance(ev.get("time"), (int, float)):
                    raise ValueError("time must be epoch seconds")
                if ev.get("sourcetype") != "sf:alert" or ev.get("source") != "security-framework":
                    raise ValueError("sourcetype/source contract broken")
                for key in ("id", "timestamp", "rule_id", "severity", "host"):
                    if key not in ev["event"]:
                        raise ValueError(f"alert payload missing {key}")
                if not isinstance(ev.get("fields"), dict) or "rule_id" not in ev["fields"]:
                    raise ValueError("indexed fields missing")
                n_events += 1
            except Exception:
                bad += 1
                status, code, text = 400, 10, "Invalid data format"
        with lock:
            stats["received"] += n_events
            stats["bad_frames"] += bad
            if status == 200 and self.headers.get("Authorization"):
                stats["with_auth"] += n_events
            stats["last_status"] = status
        dump_stats(HECHandler.stats_file)
        body = json.dumps({"text": text, "code": code}).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--protocol", choices=("elastic", "splunk"), required=True)
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--secret", default=None,
                    help="require the platform auth header with this credential")
    ap.add_argument("--expect", type=int, default=None,
                    help="exit 0 as soon as N or more alerts arrived")
    ap.add_argument("--timeout", type=int, default=60,
                    help="seconds to wait for --expect before failing")
    ap.add_argument("--stats-file", default=None,
                    help="JSON file rewritten after every frame (script-friendly "
                         "live stats; the driving script reads it at any time)")
    args = ap.parse_args()

    handler = BulkHandler if args.protocol == "elastic" else HECHandler
    handler.secret = args.secret
    handler.stats_file = args.stats_file
    if args.stats_file:
        dump_stats(args.stats_file)  # create the file upfront: no read races

    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()

    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())

    if args.expect is not None:
        deadline = time.time() + args.timeout
        while time.time() < deadline and not stop.is_set():
            with lock:
                if stats["received"] >= args.expect:
                    break
            stop.wait(0.1)
        with lock:
            ok = stats["received"] >= args.expect
            summary = dict(stats)
        server.shutdown()
        print(json.dumps(summary), flush=True)
        return 0 if ok else 1

    print(f"[siem-receiver] {args.protocol} listening on 127.0.0.1:{args.port}", file=sys.stderr)
    # Event.wait() without a timeout can swallow the signal wakeup on
    # some CPython builds (the handler runs, the waiter re-blocks);
    # a bounded wait loop makes SIGTERM deterministic everywhere.
    while not stop.is_set():
        stop.wait(0.2)
    with lock:
        summary = dict(stats)
    server.shutdown()
    print(json.dumps(summary), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
