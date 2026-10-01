#!/usr/bin/env python3
"""Inert fixture telemetry through a real, authenticated loopback engine."""

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[2]


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine", required=True, type=Path, help="already-built engine binary")
    args = parser.parse_args()
    binary = args.engine.resolve(strict=True)
    ingest_port, api_port = free_port(), free_port()
    while api_port == ingest_port:
        api_port = free_port()
    base = f"http://127.0.0.1:{api_port}"
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def get(path, authenticated=True):
        headers = {"Authorization": "Bearer fixture-api-token"} if authenticated else {}
        with opener.open(urllib.request.Request(base + path, headers=headers), timeout=2) as response:
            return json.load(response)

    with tempfile.TemporaryDirectory(prefix="bt-file-forensics-") as directory:
        work = Path(directory)
        # Operator env must never arm response, external sinks or notifications
        # for a fixture. Only read routes and AUTH-gated loopback ingest are used.
        env = {key: value for key, value in os.environ.items() if not key.startswith("SF_")}
        command = [str(binary), "-addr", f"127.0.0.1:{ingest_port}", "-api", f"127.0.0.1:{api_port}",
                   "-rules", str(ROOT / "rules"), "-sequences", "", "-beacons", "", "-thresholds", "",
                   "-token", "fixture-ingest-token", "-api-token", "fixture-api-token", "-reload-every", "0",
                   "-forensic-dir", str(work / "forensics"), "-lifecycle", str(work / "lifecycle.json")]
        with (work / "engine.log").open("wb") as log:
            engine = subprocess.Popen(command, cwd=work, env=env, stdout=log, stderr=subprocess.STDOUT)
            try:
                deadline = time.monotonic() + 15
                while True:
                    if engine.poll() is not None:
                        raise RuntimeError("fixture engine exited before becoming ready")
                    try:
                        get("/api/health", False)
                        break
                    except (OSError, urllib.error.URLError):
                        if time.monotonic() >= deadline:
                            raise RuntimeError("fixture engine did not become ready")
                        time.sleep(0.05)

                events = []

                def event(kind, pid, name="", **extra):
                    value = {"id": f"fixture-{len(events)}", "timestamp": datetime.now(timezone.utc).isoformat(),
                             "type": kind, "source": "fixture", "host": "LAB-FILE-FORENSICS", "user": "CORP\\fixture",
                             "process": {"pid": pid, "name": name}, "enrichment": {"fixture_trace": "retained"}, **extra}
                    events.append(value)
                    return value

                event("process.create", 900, "WINWORD.EXE")
                event("file.write", 900)  # must not erase the remembered Office parent
                child = event("process.create", 901, process={"pid": 901, "ppid": 900, "name": "cmd.exe"})
                expected = {"b2c3d4e5-0005-4b05-9e05-050505050505": child}
                event("file.write", 1200, "winword.exe", file={"path": r"C:\Users\ana\AppData\Local\Temp\report.docx"})
                samples = [
                    ("winword.exe", r"C:\Users\ana\AppData\Local\Temp\loader.exe"),
                    ("powershell.exe", r"C:\Users\Public\plugin.dll"),
                    ("chrome.exe", r"C:\Users\ana\Downloads\tool\version.dll"),
                    ("notepad.exe", r"C:\Users\ana\Documents\PowerShell\profile.ps1"),
                    ("explorer.exe", r"C:\Users\ana\AppData\Roaming\Microsoft\Word\STARTUP\loader.dotm"),
                    ("procdump64.exe", r"C:\Temp\lsass.dmp"),
                ]
                for index, (name, path) in enumerate(samples, 1):
                    value = event("file.write", 1000 + index, name, file={"path": path, "hashes": {"sha256": "fixture-hash"}})
                    expected[f"d4e5f607-100{index}-4a00-8000-00000000000{index}"] = value
                startup = event("file.write", 1100, "explorer.exe",
                                file={"path": r"C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Startup\fixture.lnk"})
                expected["a04b5c73-8d9e-4fa0-c1b2-3d4e5f6a7b80"] = startup
                with socket.create_connection(("127.0.0.1", ingest_port), timeout=3) as sock:
                    sock.sendall(b"AUTH fixture-ingest-token\n")
                    with sock.makefile("rb") as reply:
                        if json.loads(reply.readline()) != {"ack": "ok"}:
                            raise AssertionError("ingest authentication failed")
                        sock.sendall(b"".join(json.dumps(value).encode() + b"\n" for value in events))

                deadline = time.monotonic() + 10
                while True:
                    stats = get("/api/stats")
                    alerts = get("/api/alerts?limit=256")
                    actual = {value["rule_id"]: value for value in alerts}
                    # events_total counts accepted intake, which can precede
                    # rule evaluation and evidence writes. Startup is last:
                    # its published alert confirms the preceding benign record
                    # and all earlier fixtures have finished evaluation.
                    if stats["events_total"] == len(events) and set(expected).issubset(actual):
                        break
                    if time.monotonic() >= deadline:
                        raise AssertionError(("fixture alarms did not finish", set(expected) - set(actual)))
                    time.sleep(0.05)
                assert set(actual) == set(expected), ("unexpected/missing alarms", set(actual) ^ set(expected))
                assert len(alerts) == len(expected) and stats["rules_count"] == 55 and stats["dropped"] == 0
                print("PASS: six file alarms + Startup + Office-parent alarm, no benign-document alarm")
                captured = 0
                for rule_id, alert in actual.items():
                    path = f"/api/alerts/{alert['id']}/forensics"
                    if alert["severity"] == "medium":
                        try:
                            get(path)
                        except urllib.error.HTTPError as err:
                            assert err.code == 404
                        else:
                            raise AssertionError("medium evidence must follow the capture threshold")
                        continue
                    bundle = get(path)
                    assert bundle["alert"]["id"] == alert["id"]
                    trigger = next(value for value in bundle["timeline"] if value["id"] == expected[rule_id]["id"])
                    assert trigger["enrichment"]["fixture_trace"] == "retained"
                    if "file" in expected[rule_id]:
                        assert trigger["file"] == expected[rule_id]["file"]
                    else:
                        assert trigger["enrichment"]["parent_name"] == "WINWORD.EXE"
                    assert bundle["summary"]["events"] == len(bundle["timeline"])
                    try:
                        get(path, False)
                    except urllib.error.HTTPError as err:
                        assert err.code == 401
                    else:
                        raise AssertionError("evidence route must enforce API authentication")
                    captured += 1
                assert captured == 6
                print("PASS: six complete authenticated bundles; medium captures remain absent")
                print("File/forensics smoke: PASS (inert fixtures; no attack command executed)")
            except Exception:
                log.flush()
                print((work / "engine.log").read_text(errors="replace")[-4000:])
                raise
            finally:
                engine.terminate()
                try:
                    engine.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    engine.kill()
                    engine.wait(timeout=5)


if __name__ == "__main__":
    main()
