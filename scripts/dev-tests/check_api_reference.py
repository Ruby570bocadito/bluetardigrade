#!/usr/bin/env python3
"""Check/regenerate the generated API reference in OPERATIONS.md from docs/api/openapi.yaml.

Same contract as check_rule_inventory.py: the generated block between the
BEGIN/END markers is machine-owned. Default mode checks for drift (exit 1
when the spec moved and the block did not follow); --write regenerates it;
--self-test exercises the renderer on a tiny inline spec.
"""

import argparse
from pathlib import Path
import sys

import yaml

ROOT = Path(__file__).resolve().parents[2]
DOC = ROOT / "docs/OPERATIONS.md"
SPEC = ROOT / "docs/api/openapi.yaml"
BEGIN = "<!-- BEGIN API REFERENCE -->"
END = "<!-- END API REFERENCE -->"
METHODS = ("get", "post", "put", "delete", "patch")


def cell(value):
    return " ".join(str(value).splitlines()).replace("|", r"\|")


def parse_spec(spec):
    """Return (route_count, rows) for an OpenAPI mapping; rows are
    (method, path, summary, tags) sorted by route then canonical method."""
    if not isinstance(spec, dict) or not isinstance(spec.get("paths"), dict):
        raise ValueError("openapi.yaml: expected a mapping with a paths section")
    rows = []
    seen = set()
    for path in sorted(spec["paths"]):
        item = spec["paths"][path]
        if not isinstance(item, dict):
            raise ValueError(f"{path}: expected an operation map")
        for method in METHODS:
            op = item.get(method)
            if not isinstance(op, dict):
                continue
            key = (method, path)
            if key in seen:
                raise ValueError(f"duplicate operation: {method} {path}")
            seen.add(key)
            summary = str(op.get("summary") or "").strip()
            if not summary:
                description = str(op.get("description") or "").strip()
                summary = description.splitlines()[0].strip() if description else ""
            tags = op.get("tags") or []
            if not isinstance(tags, list) or any(not isinstance(t, str) for t in tags):
                raise ValueError(f"{method} {path}: invalid tags")
            rows.append((method.upper(), path, summary, ", ".join(tags)))
    if not rows:
        raise ValueError("openapi.yaml: no operations found")
    return len(spec["paths"]), rows


def render(route_count, rows):
    lines = [
        f"Complete operation index generated from `api/openapi.yaml` (POL-5):"
        f" **{route_count} routes, {len(rows)} operations**. The guard"
        f" `scripts/dev-tests/check_api_reference.py` fails CI when the spec and this"
        f" index drift; regenerate in the same round as the spec change with"
        f" `python3 scripts/dev-tests/check_api_reference.py --write`.",
        "",
        "| Method | Route | Summary | Tags |",
        "|--------|-------|---------|------|",
    ]
    for row in rows:
        lines.append("| " + " | ".join(cell(v) for v in row) + " |")
    # Leading newline: the generated content starts on the line AFTER the
    # BEGIN marker, never glued to it.
    return "\n" + "\n".join(lines) + "\n"


def self_test():
    spec = {
        "paths": {
            "/api/b": {
                "post": {"summary": "Create thing", "tags": ["write"]},
                "get": {"description": "List things\nwith details", "tags": ["status"]},
            },
            "/api/a": {"get": {"summary": "Health", "tags": ["status"]}},
        }
    }
    count, rows = parse_spec(spec)
    text = render(count, rows)
    assert count == 2, count
    assert rows[0] == ("GET", "/api/a", "Health", "status"), rows[0]
    assert rows[1][0] == "GET" and rows[2][0] == "POST", rows
    assert rows[1][2] == "List things", rows[1]  # description fallback, first line
    assert "| GET | /api/a | Health | status |" in text
    assert "| POST | /api/b | Create thing | write |" in text
    # Pipe characters in prose must never break the table.
    count2, rows2 = parse_spec({"paths": {"/api/c": {"get": {"summary": "a | b", "tags": []}}}})
    assert "| GET | /api/c | a \\| b |  |" in render(count2, rows2)
    print("check_api_reference: self-test OK")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="update only the marked reference in OPERATIONS.md")
    parser.add_argument("--self-test", action="store_true", help="run the renderer self-test and exit")
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    try:
        route_count, rows = parse_spec(yaml.safe_load(SPEC.read_text(encoding="utf-8")))
        expected = render(route_count, rows)
        text = DOC.read_text(encoding="utf-8")
        if text.count(BEGIN) != 1 or text.count(END) != 1:
            raise ValueError("OPERATIONS.md must contain exactly one API reference marker pair")
        before, rest = text.split(BEGIN, 1)
        current, after = rest.split(END, 1)
        if args.write:
            DOC.write_text(before + BEGIN + expected + END + after, encoding="utf-8")
        elif current != expected:
            raise ValueError("API reference is stale; run python3 scripts/dev-tests/check_api_reference.py --write")
    except (ValueError, OSError, yaml.YAMLError) as err:
        print(f"check_api_reference: {err}", file=sys.stderr)
        return 1
    print(f"check_api_reference: OK — {route_count} routes, {len(rows)} operations documented from OpenAPI")
    return 0


if __name__ == "__main__":
    sys.exit(main())
