#!/usr/bin/env python3
"""Structural validation of docs/api/openapi.yaml against the engine source.

Catches spec drift without needing a running engine:
  1. The spec parses as OpenAPI 3.x.
  2. Every route served by internal/api/api.go exists in the spec
     (and the spec declares no route the code does not serve).
  3. The Stats schema matches the JSON wire tags of statsPayload in
     internal/api/api.go, field by field (names and required list —
     the struct has no omitempty, so every field is always emitted).

Exit code 0 = in sync; 1 = drift found (details on stderr).

Run from the repo root:  python3 scripts/dev-tests/check_openapi.py
Requires: python3 with PyYAML (pip install pyyaml).
"""

import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.exit("PyYAML is required: pip install pyyaml")

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "docs" / "api" / "openapi.yaml"
API_GO = ROOT / "internal" / "api" / "api.go"

errors: list[str] = []


def fail(msg: str) -> None:
    errors.append(msg)


def main() -> int:
    spec = yaml.safe_load(SPEC.read_text(encoding="utf-8"))
    if not str(spec.get("openapi", "")).startswith("3."):
        fail(f"spec is not OpenAPI 3.x (openapi={spec.get('openapi')!r})")
    spec_paths = set(spec.get("paths", {}))

    # ---- routes: api.go registers them as mux.HandleFunc("GET /api/...", ...)
    go_src = API_GO.read_text(encoding="utf-8")
    go_routes = set(
        re.findall(r'HandleFunc\(\s*"(?:GET |POST )?(/[^"]*)"', go_src)
    )
    for route in sorted(go_routes):
        if route not in spec_paths:
            fail(f"route served by the code but missing in spec: {route}")
    for path in sorted(spec_paths):
        if path not in go_routes:
            fail(f"route declared in spec but not served by the code: {path}")

    # ---- Stats schema vs statsPayload JSON tags
    m = re.search(r"type statsPayload struct \{(.*?)\n\}", go_src, re.S)
    if not m:
        sys.exit("statsPayload struct not found in internal/api/api.go")
    go_fields: dict[str, str] = {}
    for line in m.group(1).splitlines():
        fm = re.match(r"\s*(\w+)\s+[\w\[\]\.\*]+\s+`json:\"(\w+)\"`", line)
        if fm:
            go_fields[fm.group(2)] = fm.group(1)

    stats = spec.get("components", {}).get("schemas", {}).get("Stats")
    if stats is None:
        fail("components.schemas.Stats missing from the spec")
    else:
        spec_props = set(stats.get("properties", {}))
        spec_req = set(stats.get("required", []))
        go_names = set(go_fields)

        for name in sorted(go_names - spec_props):
            fail(f"Stats: field {name} exists in statsPayload but not in the spec")
        for name in sorted(spec_props - go_names):
            fail(f"Stats: field {name} declared in the spec but absent from statsPayload")
        for name in sorted(spec_req - spec_props):
            fail(f"Stats: {name} listed as required but has no property definition")
        for name in sorted(go_names - spec_req):
            fail(f"Stats: {name} missing from the required list")

    if errors:
        for e in errors:
            print(f"DRIFT: {e}", file=sys.stderr)
        print(f"check_openapi: {len(errors)} drift finding(s)", file=sys.stderr)
        return 1

    print(
        f"check_openapi: OK — {len(go_routes)} routes, "
        f"{len(go_fields)} Stats fields, spec in sync with the code"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
