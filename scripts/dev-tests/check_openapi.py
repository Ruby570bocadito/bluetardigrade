#!/usr/bin/env python3
"""Structural validation of docs/api/openapi.yaml against the engine source.

Catches spec drift without needing a running engine:
  1. The spec parses as OpenAPI 3.x.
  2. Every route served by internal/api/api.go exists in the spec
     (and the spec declares no route the code does not serve).
  3. The Stats schema matches the JSON wire tags of statsPayload in
     internal/api/api.go, field by field (names and required list —
     the struct has no omitempty, so every field is always emitted).
  4. Security matches the code: when api.go registers the bearer
     middleware (h.auth(mux)), the spec must declare
     components.securitySchemes.bearerAuth (type http, scheme bearer);
     every operation on a path the code serves must declare its own
     security and offer the optional-auth idiom — a `bearerAuth: []`
     entry plus an anonymous `{}` entry, because the token is only
     demanded when the engine runs with `-api-token`; and any path the
     middleware exempts (parsed from auth(): r.URL.Path == ...)
     must force anonymous access with `security: []`. Protected operations
     must also document their `401` response (the middleware answers it
     with a WWW-Authenticate challenge when -api-token is set), and
     exempt paths must not (auth() passes them through untouched). If the code
     registers no middleware, the spec must not demand bearer anywhere.

Exit code 0 = in sync; 1 = drift found (details on stderr).

--self-test runs the same checks against embedded fixtures: one positive
(0 findings expected) and several mutated copies where a specific finding
is expected. This keeps the negative tests of the guard itself in-tree,
so CI exercises the validator, not just the current spec.

Run from the repo root:
  python3 scripts/dev-tests/check_openapi.py
  python3 scripts/dev-tests/check_openapi.py --self-test

Requires: python3 with PyYAML (pip install pyyaml).
"""

import copy
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

HTTP_METHODS = {"get", "put", "post", "delete", "options", "head", "patch", "trace"}


def run_checks(spec: dict, go_src: str) -> tuple[list[str], dict]:
    """Validate a parsed spec dict against api.go source code.

    Returns (findings, info) where info carries counts for the OK line.
    """
    errors: list[str] = []
    info: dict = {}

    if not str(spec.get("openapi", "")).startswith("3."):
        errors.append(f"spec is not OpenAPI 3.x (openapi={spec.get('openapi')!r})")
    spec_paths = set(spec.get("paths", {}) or {})

    # ---- routes: api.go registers them as mux.HandleFunc("GET /api/...", ...)
    go_routes = set(re.findall(r'HandleFunc\(\s*"(?:GET |POST )?(/[^"]*)"', go_src))

    for route in sorted(go_routes):
        if route not in spec_paths:
            errors.append(f"route served by the code but missing in spec: {route}")
    for path in sorted(spec_paths):
        if path not in go_routes:
            errors.append(f"route declared in spec but not served by the code: {path}")

    # ---- Stats schema vs statsPayload JSON tags
    m = re.search(r"type statsPayload struct \{(.*?)\n\}", go_src, re.S)
    if not m:
        sys.exit("statsPayload struct not found in internal/api/api.go")
    go_fields: dict[str, str] = {}
    for line in m.group(1).splitlines():
        fm = re.match(r"\s*(\w+)\s+[\w\[\]\.\*]+\s+`json:\"(\w+)\"`", line)
        if fm:
            go_fields[fm.group(2)] = fm.group(1)

    stats = (spec.get("components", {}) or {}).get("schemas", {}).get("Stats")
    if stats is None:
        errors.append("components.schemas.Stats missing from the spec")
    else:
        spec_props = set(stats.get("properties", {}))
        spec_req = set(stats.get("required", []))
        go_names = set(go_fields)

        for name in sorted(go_names - spec_props):
            errors.append(f"Stats: field {name} exists in statsPayload but not in the spec")
        for name in sorted(spec_props - go_names):
            errors.append(f"Stats: field {name} declared in the spec but absent from statsPayload")
        for name in sorted(spec_req - spec_props):
            errors.append(f"Stats: {name} listed as required but has no property definition")
        for name in sorted(go_names - spec_req):
            errors.append(f"Stats: {name} missing from the required list")

    # ---- security: bearer middleware in api.go vs securitySchemes/security
    has_mw = bool(re.search(r"\bh\.auth\(\s*mux\s*\)", go_src))
    exempt: set[str] = set()
    m_auth = re.search(r"func \(h \*Hub\) auth\(.*?(?=\nfunc |\Z)", go_src, re.S)
    if m_auth:
        exempt = set(re.findall(r'r\.URL\.Path\s*==\s*"([^"]+)"', m_auth.group(0)))

    schemes = (spec.get("components", {}) or {}).get("securitySchemes", {}) or {}
    spec_paths_map = spec.get("paths", {}) or {}
    global_sec = spec.get("security")

    def op_security(op: dict):
        """Effective security entries: per-operation wins, else global."""
        return op.get("security") if "security" in op else global_sec

    def offers_bearer(sec) -> bool:
        return any(isinstance(e, dict) and e.get("bearerAuth") == [] for e in sec)

    def offers_anon(sec) -> bool:
        return any(isinstance(e, dict) and len(e) == 0 for e in sec)

    gated_ops = 0
    if has_mw:
        bearer = schemes.get("bearerAuth")
        if bearer is None:
            errors.append(
                "components.securitySchemes.bearerAuth missing while api.go "
                "registers the bearer middleware (h.auth(mux))"
            )
        elif bearer.get("type") != "http" or bearer.get("scheme") != "bearer":
            errors.append(
                "securitySchemes.bearerAuth must be type:http scheme:bearer "
                "to mirror the Authorization: Bearer check in api.go"
            )
        for path in sorted(go_routes):
            item = spec_paths_map.get(path)
            if not isinstance(item, dict):
                continue  # route-set mismatch already reported above
            for method, op in item.items():
                if method not in HTTP_METHODS or not isinstance(op, dict):
                    continue
                sec = op_security(op)
                has_401 = "401" in (op.get("responses", {}) or {})
                if path in exempt:
                    if sec != []:
                        errors.append(
                            f"{method.upper()} {path}: the middleware exempts this path, "
                            "the spec must force anonymous access with security: []"
                        )
                    if has_401:
                        errors.append(
                            f"{method.upper()} {path}: the middleware exempts this path; "
                            "it must not document a 401 response (auth() passes it "
                            "through untouched)"
                        )
                elif sec is None:
                    errors.append(
                        f"{method.upper()} {path}: no security declared while api.go "
                        "gates /api/* behind the bearer middleware"
                    )
                else:
                    if not offers_bearer(sec):
                        errors.append(
                            f"{method.upper()} {path}: security does not offer "
                            "bearerAuth: [] (code registers the bearer middleware)"
                        )
                    if not offers_anon(sec):
                        errors.append(
                            f"{method.upper()} {path}: security lacks the anonymous "
                            "entry {} (auth is optional: enforced only with -api-token)"
                        )
                    if offers_bearer(sec):
                        gated_ops += 1
                        if not has_401:
                            errors.append(
                                f"{method.upper()} {path}: protected operation does not "
                                "document a 401 response (the middleware answers 401 "
                                "with a WWW-Authenticate challenge when -api-token is set)"
                            )
    else:
        if "bearerAuth" in schemes:
            errors.append(
                "components.securitySchemes.bearerAuth declared but api.go "
                "registers no auth middleware"
            )
        for path, item in spec_paths_map.items():
            if not isinstance(item, dict):
                continue
            for method, op in item.items():
                if method not in HTTP_METHODS or not isinstance(op, dict):
                    continue
                sec = op_security(op)
                if sec and offers_bearer(sec):
                    errors.append(
                        f"{method.upper()} {path}: spec demands bearerAuth but "
                        "api.go registers no auth middleware"
                    )

    # ---- 401 body: the Unauthorized example must match the JSON the
    # middleware actually writes, byte-for-byte, so the documented
    # error contract cannot drift from the wire (the challenge headers
    # and body live in one Fprintln in api.go's auth()).
    m_body = re.search(r'Fprintln\(w, `(\{"error":"unauthorized[^"]*"\})`\)', go_src)
    unauth = ((spec.get("components", {}) or {}).get("responses", {}) or {}).get("Unauthorized")
    if has_mw and m_body and unauth:
        go_error = m_body.group(1).split('"error":"', 1)[1]
        if not go_error.endswith('"}'):
            errors.append(f"could not parse the 401 body in api.go: {m_body.group(1)!r}")
        else:
            go_error = go_error[:-2]
            try:
                example = unauth["content"]["application/json"]["schema"]["properties"]["error"]["example"]
            except (KeyError, TypeError):
                example = None
            if example is None:
                errors.append(
                    "components.responses.Unauthorized lacks the error example "
                    "(content.application/json.schema.properties.error.example) "
                    "while api.go writes a concrete 401 body"
                )
            elif example != go_error:
                errors.append(
                    f"Unauthorized example drift: spec {example!r} != api.go {go_error!r}"
                )

    info.update(routes=len(go_routes), fields=len(go_fields), gated_ops=gated_ops)
    return errors, info


# --------------------------------------------------------------------------
# Self-test: embedded fixtures, one positive and several negative variants.
# --------------------------------------------------------------------------

GO_FIXTURE = """package api

import (
        "fmt"
        "net/http"
        "time"
)

func setup(mux *http.ServeMux, h *Hub) {
        mux.HandleFunc("GET /api/stats", h.handleStats)
        mux.HandleFunc("GET /api/health", h.handleHealth)
        h.srv = &http.Server{Handler: h.auth(mux), ReadHeaderTimeout: 5 * time.Second}
}

func (h *Hub) auth(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
                if h.token == "" || r.URL.Path == "/api/health" {
                        next.ServeHTTP(w, r)
                        return
                }
                w.Header().Set("WWW-Authenticate", `Bearer realm="fixture"`)
                w.WriteHeader(http.StatusUnauthorized)
                fmt.Fprintln(w, `{"error":"unauthorized: send 'Authorization: Bearer <token>' (configure it with -api-token/SF_API_TOKEN)"}`)
        })
}

type statsPayload struct {
        Uptime float64 `json:"uptime"`
        Events uint64  `json:"events_total"`
}
"""

OPTIONAL_AUTH = [{"bearerAuth": []}, {}]


def good_spec() -> dict:
    return {
        "openapi": "3.0.3",
        "paths": {
            "/api/stats": {
                "get": {
                    "operationId": "getStats",
                    "security": copy.deepcopy(OPTIONAL_AUTH),
                    "responses": {
                        "200": {"description": "ok"},
                        "401": {"$ref": "#/components/responses/Unauthorized"},
                    },
                }
            },
            "/api/health": {
                "get": {
                    "operationId": "getHealth",
                    "security": [],
                    "responses": {"200": {"description": "ok"}},
                }
            },
        },
        "components": {
            "securitySchemes": {"bearerAuth": {"type": "http", "scheme": "bearer"}},
            "responses": {
                "Unauthorized": {
                    "description": "missing or wrong bearer credential",
                    "content": {
                        "application/json": {
                            "schema": {
                                "type": "object",
                                "properties": {
                                    "error": {
                                        "type": "string",
                                        "example": "unauthorized: send 'Authorization: Bearer <token>' (configure it with -api-token/SF_API_TOKEN)",
                                    }
                                },
                            }
                        }
                    },
                }
            },
            "schemas": {
                "Stats": {
                    "type": "object",
                    "properties": {
                        "uptime": {"type": "number"},
                        "events_total": {"type": "integer"},
                    },
                    "required": ["uptime", "events_total"],
                }
            },
        },
    }


def self_test() -> int:
    findings, _ = run_checks(good_spec(), GO_FIXTURE)
    if findings:
        print(f"self-test: good fixture produced unexpected findings: {findings}", file=sys.stderr)
        return 1

    variants = [
        (
            "stats op with security dropped",
            lambda s: s["paths"]["/api/stats"]["get"].pop("security"),
            "no security declared",
        ),
        (
            "exempt health gated behind bearer",
            lambda s: s["paths"]["/api/health"]["get"].__setitem__(
                "security", copy.deepcopy(OPTIONAL_AUTH)
            ),
            "force anonymous access",
        ),
        (
            "securitySchemes.bearerAuth missing",
            lambda s: s["components"]["securitySchemes"].pop("bearerAuth"),
            "bearerAuth missing",
        ),
        (
            "Stats wire field missing from spec",
            lambda s: s["components"]["schemas"]["Stats"]["properties"].pop("events_total"),
            "exists in statsPayload but not in the spec",
        ),
        (
            "anonymous entry dropped (auth modeled as always-on)",
            lambda s: s["paths"]["/api/stats"]["get"].__setitem__(
                "security", [{"bearerAuth": []}]
            ),
            "lacks the anonymous entry",
        ),
        (
            "protected op without documented 401",
            lambda s: s["paths"]["/api/stats"]["get"]["responses"].pop("401"),
            "does not document a 401",
        ),
        (
            "exempt health documenting a 401",
            lambda s: s["paths"]["/api/health"]["get"]["responses"].__setitem__(
                "401", {"$ref": "#/components/responses/Unauthorized"}
            ),
            "must not document a 401",
        ),
        (
            "Unauthorized example drifted from the api.go body",
            lambda s: s["components"]["responses"]["Unauthorized"]["content"][
                "application/json"
            ]["schema"]["properties"]["error"].__setitem__(
                "example", "unauthorized: stale message the code no longer sends"
            ),
            "Unauthorized example drift",
        ),
    ]
    for name, mutate, expect in variants:
        spec = good_spec()
        mutate(spec)
        findings, _ = run_checks(spec, GO_FIXTURE)
        if not any(expect in f for f in findings):
            print(
                f"self-test: variant {name!r} expected a finding containing "
                f"{expect!r}, got: {findings}",
                file=sys.stderr,
            )
            return 1

    print(
        f"self-test: OK — 1 positive fixture + {len(variants)} negative variants, "
        "the guard catches its own class of drift"
    )
    return 0


def main() -> int:
    if "--self-test" in sys.argv[1:]:
        return self_test()

    spec = yaml.safe_load(SPEC.read_text(encoding="utf-8"))
    go_src = API_GO.read_text(encoding="utf-8")
    errors, info = run_checks(spec, go_src)

    if errors:
        for e in errors:
            print(f"DRIFT: {e}", file=sys.stderr)
        print(f"check_openapi: {len(errors)} drift finding(s)", file=sys.stderr)
        return 1

    print(
        f"check_openapi: OK — {info['routes']} routes, {info['fields']} Stats fields, "
        f"{info['gated_ops']} optionally-gated operations, "
        "spec in sync with the code (routes, fields, security)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
