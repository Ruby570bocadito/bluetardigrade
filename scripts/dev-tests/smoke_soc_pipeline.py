#!/usr/bin/env python3
"""Six source formats through real collector/engine binaries; all inputs inert fixtures."""

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


def shipped_rule_count():
    """Rules in the shipped pack (one top-level "- name:" entry each): the
    engine must load every one of them, whatever the pack grows to."""
    return sum(
        line.startswith("- name:")
        for path in (ROOT / "rules").rglob("*.y*ml")
        for line in path.read_text(encoding="utf-8").splitlines()
    )


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine", required=True, type=Path)
    parser.add_argument("--collector", required=True, type=Path)
    args = parser.parse_args()
    engine_binary = args.engine.resolve(strict=True)
    collector_binary = args.collector.resolve(strict=True)
    ingest, api = free_port(), free_port()
    while api == ingest:
        api = free_port()
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    base = f"http://127.0.0.1:{api}"

    def request(path, body=None, authenticated=True):
        headers = {"Authorization": "Bearer fixture-api-token"} if authenticated else {}
        if body is not None:
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(base + path, headers=headers, data=None if body is None else json.dumps(body).encode())
        with opener.open(req, timeout=3) as response:
            return json.load(response)

    with tempfile.TemporaryDirectory(prefix="bt-soc-smoke-") as directory:
        work = Path(directory)
        env = {key: value for key, value in os.environ.items() if not key.startswith("SF_")}
        command = [str(engine_binary), "-addr", f"127.0.0.1:{ingest}", "-api", f"127.0.0.1:{api}",
                   "-rules", str(ROOT / "rules"), "-sequences", "", "-thresholds", "", "-beacons", "",
                   "-token", "fixture-ingest-token", "-api-token", "fixture-api-token", "-reload-every", "0",
                   "-store", str(work / "events.db"), "-forensic-dir", str(work / "forensics"),
                   "-lifecycle", str(work / "lifecycle.json")]
        with (work / "engine.log").open("wb") as log:
            engine = subprocess.Popen(command, cwd=work, env=env, stdout=log, stderr=subprocess.STDOUT)
            try:
                deadline = time.monotonic() + 15
                while True:
                    if engine.poll() is not None:
                        raise RuntimeError("fixture engine exited before ready")
                    try:
                        request("/api/health", authenticated=False)
                        break
                    except (OSError, urllib.error.URLError):
                        if time.monotonic() > deadline:
                            raise RuntimeError("fixture engine did not become ready")
                        time.sleep(0.05)
                now = datetime.now(timezone.utc)
                stamp = now.isoformat()
                records = {
                    "suricata": [{"timestamp": stamp, "event_type": "alert", "src_ip": "10.0.0.2", "dest_ip": "8.8.8.8", "src_port": 32000, "dest_port": 443, "proto": "TCP", "alert": {"signature": "Fixture IDS signature", "signature_id": 42, "severity": 1, "action": "allowed"}, "verdict": {"action": "drop"}}],
                    "zeek": [{"ts": now.timestamp(), "uid": "C-fixture", "id.orig_h": "10.0.0.3", "id.orig_p": 32000, "id.resp_h": "8.8.8.8", "id.resp_p": 445, "proto": "tcp", "conn_state": "SF"}],
                    "osquery": [{"name": "bt_exposed_admin_ports", "action": "added", "hostIdentifier": "QUERY-FIXTURE", "unixTime": int(now.timestamp()), "counter": "1", "columns": {"pid": "42", "name": "sshd", "address": "0.0.0.0", "port": "22"}}],
                    "cowrie": [{"eventid": "cowrie.login.success", "timestamp": stamp, "src_ip": "10.0.0.4", "username": "root", "password": "fixture-honeypot-secret", "session": "s1"}, {"eventid": "cowrie.command.input", "timestamp": stamp, "src_ip": "10.0.0.4", "realm": "passwd", "input": "fixture-stdin-secret", "session": "s1"}],
                }
                inputs = {source: "\n".join(json.dumps(row) for row in rows) + "\n" for source, rows in records.items()}
                inputs["windows-firewall"] = "#Version: 1.5\n#Time Format: UTC\n#Fields: date time action protocol src-ip dst-ip src-port dst-port path pid\n" + now.strftime("%Y-%m-%d %H:%M:%S") + " ALLOW TCP 10.0.0.5 10.0.0.6 32000 3389 RECEIVE 42\n"
                inputs["eml"] = (
                    "From: sender@example.com\r\nSubject: Inert mail fixture\r\n"
                    "Authentication-Results: fixture; dmarc=fail\r\nMIME-Version: 1.0\r\n"
                    'Content-Type: multipart/mixed; boundary="fixture-boundary"\r\n\r\n'
                    "--fixture-boundary\r\nContent-Type: text/html; charset=utf-8\r\n\r\n"
                    '<a href="https://fixture-cred-secret@xn--bcher-kva.example.invalid/login?token=fixture-mail-secret">https://bank.example.invalid/login</a>\r\n'
                    "Review https://192.0.2.1/inert?token=fixture-mail-secret\r\n"
                    "--fixture-boundary\r\nContent-Type: application/octet-stream\r\n"
                    'Content-Disposition: attachment; filename="agenda.docm"\r\n\r\nINERT\r\n'
                    "--fixture-boundary\r\nContent-Type: application/octet-stream\r\n"
                    'Content-Disposition: attachment; filename="invoice.pdf.exe"\r\n\r\nINERT\r\n'
                    "--fixture-boundary\r\nContent-Type: application/octet-stream\r\n"
                    'Content-Disposition: attachment; filename="invoice\u202egnp.exe"\r\n\r\nINERT\r\n'
                    "--fixture-boundary--\r\n"
                )
                ingest_env = {**env, "SF_INGEST_TOKEN": "fixture-ingest-token"}
                for source, contents in inputs.items():
                    path = work / (source + ".input")
                    # Preserve provider bytes, especially EML CRLF on Windows.
                    path.write_bytes(contents.encode("utf-8"))
                    completed = subprocess.run([str(collector_binary), "-source", source, "-observer", "SOC-FIXTURE", "-file", str(path), "-addr", f"127.0.0.1:{ingest}"], env=ingest_env, cwd=work, capture_output=True, timeout=15)
                    if completed.returncode != 0:
                        raise RuntimeError(f"{source} collector failed: {completed.stderr.decode()}")
                expected = {"soc-ids-priority-high", "soc-ips-reported-drop", "soc-ndr-public-smb", "soc-osquery-admin-listener", "soc-honeypot-login", "soc-firewall-admin-allow", "soc-mail-dmarc-fail", "soc-mail-ip-url"}
                expected.update({"soc-mail-risky-attachment", "soc-mail-html-link-mismatch", "soc-mail-url-credentials",
                                 "soc-mail-url-punycode", "soc-mail-macro-attachment", "soc-mail-double-extension", "soc-mail-bidi-filename"})
                deadline = time.monotonic() + 8
                while True:
                    stats = request("/api/stats")
                    alerts = request("/api/alerts?limit=100")
                    if stats["events_total"] == 7 and expected.issubset({row["rule_id"] for row in alerts}):
                        break
                    if time.monotonic() > deadline:
                        raise RuntimeError("SOC source pipeline missed expected events/alarms")
                    time.sleep(0.05)
                assert stats["rules_count"] == shipped_rule_count() and stats["dropped"] == 0
                assert len(alerts) == len(expected) and {row["rule_id"] for row in alerts} == expected
                events = request("/api/events?limit=100")
                assert {row["source"] for row in events} == set(inputs)
                evidence_json = json.dumps(events) + json.dumps(alerts)
                assert not any(secret in evidence_json for secret in
                               ("fixture-honeypot-secret", "fixture-stdin-secret", "fixture-mail-secret", "fixture-cred-secret"))
                mail_event = next(row for row in events if row["source"] == "eml")
                assert mail_event["attributes"]["mail_html_link_mismatches"] == "bank.example.invalid -> xn--bcher-kva.example.invalid"
                # The real CLI must diagnose the live authenticated engine
                # without manufacturing a telemetry record or exposing tokens.
                doctor_env = {**ingest_env, "SF_API_TOKEN": "fixture-api-token"}
                doctor_command = [str(engine_binary), "doctor", "-root", str(ROOT),
                                  "-addr", f"127.0.0.1:{ingest}", "-api-url", base,
                                  "-console-url=", "-hub-url=", "-sensor", "providers", "-json"]
                diagnosis = subprocess.run(doctor_command, env=doctor_env, cwd=work, capture_output=True, timeout=15)
                assert diagnosis.returncode == 0, "live engine diagnosis failed: " + diagnosis.stdout.decode()
                diagnosed = json.loads(diagnosis.stdout)
                statuses = {check["name"]: check["status"] for check in diagnosed["checks"]}
                assert diagnosed["errors"] == 0 and statuses["Autenticacion de ingesta"] == "ok"
                assert statuses["API del motor"] == "ok" and statuses["Persistencia"] == "ok" and statuses["Telemetria"] == "ok"
                assert request("/api/stats")["events_total"] == 7, "doctor generated events"
                assert not list(ROOT.glob(".doctor-write-*")), "doctor left temporary state"
                wrong = subprocess.run(doctor_command, env={**doctor_env, "SF_API_TOKEN": "wrong-fixture-token"},
                                       cwd=work, capture_output=True, timeout=15)
                wrong_report = json.loads(wrong.stdout)
                wrong_statuses = {check["name"]: check["status"] for check in wrong_report["checks"]}
                assert wrong.returncode == 1 and wrong_statuses["API del motor"] == "ok"
                assert wrong_statuses["Acceso a estadisticas"] == "error"
                for result in (diagnosis, wrong):
                    assert not any(secret.encode() in result.stdout + result.stderr for secret in
                                   ("fixture-api-token", "fixture-ingest-token", "wrong-fixture-token", "fixture-mail-secret"))
                selected = next(row for row in alerts if row["rule_id"] == "soc-ids-priority-high")
                assert selected["attributes"]["ids_action"] == "allowed" and selected["attributes"]["ids_verdict"] == "drop"
                assert next(row for row in alerts if row["rule_id"] == "soc-ips-reported-drop")["severity"] == "info"
                history = request("/api/alerts/search?q=ids_signature&limit=25")
                assert history["source"] == "sqlite" and any(row["id"] == selected["id"] for row in history["items"])
                forensic = request(f"/api/alerts/{selected['id']}/forensics")
                assert forensic["alert"]["attributes"]["ids_verdict"] == "drop"
                for state in ["acknowledged", "closed"]:
                    changed = request(f"/api/alerts/{selected['id']}/status", {"status": state, "note": "Fixture analyst review", "by": "Fixture analyst"})
                    assert changed["status"] == state
                notes = work / "notes.json"
                notes.write_text(json.dumps({"title": "Fixture investigation", "analyst": "Fixture analyst", "decision": "false_positive", "findings": "Inert test data", "actions": "Reviewed fixture only", "recommendations": "No production action", "references": "Fixture CI"}))
                report = work / "reports" / "investigation.json"
                report_env = {**env, "SF_API_TOKEN": "fixture-api-token"}
                report_cmd = [str(engine_binary), "report", "--api", base, "--alert", selected["id"], "--notes", str(notes), "--format", "json", "--out", str(report)]
                completed = subprocess.run(report_cmd, env=report_env, cwd=work, capture_output=True, timeout=12)
                if completed.returncode != 0:
                    raise RuntimeError("actual report command failed: " + completed.stderr.decode())
                contents = report.read_bytes()
                saved = json.loads(contents)
                assert saved["fields"]["decision"] == "false_positive" and saved["alert"]["status"] == "closed" and saved["alert"]["source"] == "suricata"
                assert saved["alert"]["attributes"]["ids_action"] == "allowed"
                repeat = subprocess.run(report_cmd, env=report_env, cwd=work, capture_output=True, timeout=12)
                assert repeat.returncode != 0 and report.read_bytes() == contents
                print("SOC smoke: PASS — six source formats, seven fixture records, 15 actual alarms including offline phishing, SQLite, doctor, forensics, triage and CLI report; no attack executed")
            finally:
                engine.terminate()
                try:
                    engine.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    engine.kill()
                    engine.wait(timeout=3)


if __name__ == "__main__":
    main()
