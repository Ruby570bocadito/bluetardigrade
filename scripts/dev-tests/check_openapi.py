#!/usr/bin/env python3
"""Structural validation of docs/api/openapi.yaml against the engine source.

Catches spec drift without needing a running engine:
  1. The spec parses as OpenAPI 3.x.
  2. Every (method, path) the internal/api package serves exists in the
     spec as a declared operation — and the spec declares no operation
     the code does not serve. Method-aware since the -api-write surface
     (POST/DELETE /api/suppressions) shares paths with GET routes.
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
  5. Every $ref anywhere in the document resolves to a node inside the
     spec itself: a dangling ref (like the one the self-test fixture
     once carried unnoticed) is drift that downstream consumers — code
     generators, validators, docs — choke on silently. External refs
     are rejected: this spec is a single self-contained file on purpose.

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
API_DIR = ROOT / "internal" / "api"

HTTP_METHODS = {"get", "put", "post", "delete", "options", "head", "patch", "trace"}


def walk_refs(node, where=""):
    """Yield (ref, location) for every $ref string in the document."""
    if isinstance(node, dict):
        for k, v in node.items():
            if k == "$ref" and isinstance(v, str):
                yield v, where or "$"
            else:
                yield from walk_refs(v, f"{where}/{k}")
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from walk_refs(v, f"{where}/{i}")


def resolve_ref(spec: dict, ref: str):
    """Resolve a local '#/a/b' ref (RFC 6901 escapes honored) or None."""
    if not ref.startswith("#/"):
        return None
    node = spec
    for part in ref[2:].split("/"):
        part = part.replace("~1", "/").replace("~0", "~")
        if isinstance(node, dict) and part in node:
            node = node[part]
        elif isinstance(node, list):
            try:
                node = node[int(part)]
            except (ValueError, IndexError):
                return None
        else:
            return None
    return node


def run_checks(spec: dict, go_src: str) -> tuple[list[str], dict]:
    """Validate a parsed spec dict against api.go source code.

    Returns (findings, info) where info carries counts for the OK line.
    """
    errors: list[str] = []
    info: dict = {}

    if not str(spec.get("openapi", "")).startswith("3."):
        errors.append(f"spec is not OpenAPI 3.x (openapi={spec.get('openapi')!r})")
    spec_paths = set(spec.get("paths", {}) or {})

    # ---- routes: the package registers them as mux.HandleFunc("GET
    # /api/...", ...) across its files; every (method, path) served by
    # the code must be declared in the spec, and vice versa. A pattern
    # without a method prefix matches any method: modeled as "*", the
    # path-level check covers it.
    code_ops: set[tuple[str, str]] = set()
    for m in re.finditer(r'HandleFunc\(\s*"((?:[A-Z]+ )?/[^"]*)"', go_src):
        pat = m.group(1)
        if " " in pat:
            method, route = pat.split(" ", 1)
            code_ops.add((method.upper(), route))
        else:
            code_ops.add(("*", pat))
    go_routes = {route for _, route in code_ops}

    spec_paths_map = spec.get("paths", {}) or {}
    spec_ops: set[tuple[str, str]] = set()
    for path, item in spec_paths_map.items():
        if isinstance(item, dict):
            for method in item:
                if method.lower() in HTTP_METHODS:
                    spec_ops.add((method.upper(), path))

    for method, route in sorted(code_ops):
        if method != "*" and (method, route) not in spec_ops:
            errors.append(
                f"{method} {route} served by the code but the spec declares no such operation"
            )
    for method, path in sorted(spec_ops):
        if ("*", path) in code_ops:
            continue  # method-agnostic handler: the path-level check covers it
        if (method, path) not in code_ops:
            errors.append(
                f"{method} {path} declared in the spec but not served by the code"
            )
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

    # ---- write surface: the engine answers 403 on the routes registered
    # by registerSuppressionsWrite when it runs without -api-write (the
    # body lives next to those handlers in internal/api). Only THOSE
    # (method, path) pairs are flag-gated — other write routes (the alert
    # triage POST, for one) have their own gating contract — so the spec
    # must document the 403 on exactly these operations, with an error
    # example matching the code body byte-for-byte, like the 401 check.
    m_403 = re.search(r'Fprintln\(w, `(\{"error":"api writes[^"]*"\})`\)', go_src)
    gated_writes: set[tuple[str, str]] = set()
    m_reg = re.search(r"func \(h \*Hub\) registerSuppressionsWrite\(.*?\n\}", go_src, re.S)
    if m_reg:
        for m in re.finditer(r'HandleFunc\(\s*"((?:[A-Z]+ )?/[^"]*)"', m_reg.group(0)):
            pat = m.group(1)
            if " " in pat:
                method, route = pat.split(" ", 1)
                gated_writes.add((method.upper(), route))
    write_ops = 0
    for wmethod, wpath in sorted(gated_writes):
        item = spec_paths_map.get(wpath)
        if not isinstance(item, dict):
            errors.append(
                f"{wmethod} {wpath}: registered as a gated write route "
                "but missing in the spec"
            )
            continue
        op = item.get(wmethod.lower())
        if not isinstance(op, dict):
            errors.append(
                f"{wmethod} {wpath}: registered as a gated write route "
                "but the spec declares no such operation"
            )
            continue
        write_ops += 1
        if not m_403:
            continue  # no gated write surface in the code: nothing to match
        responses = op.get("responses", {}) or {}
        if "403" not in responses:
            errors.append(
                f"{wmethod} {wpath}: gated write operation does not document "
                "a 403 response (the engine answers it when running "
                "without -api-write)"
            )
            continue
        node = responses["403"]
        if isinstance(node, dict) and "$ref" in node:
            node = resolve_ref(spec, node["$ref"]) or {}
        example = None
        try:
            example = node["content"]["application/json"]["schema"]["properties"]["error"]["example"]
        except (KeyError, TypeError):
            example = None
        go_403 = m_403.group(1).split('"error":"', 1)[1]
        if not go_403.endswith('"}'):
            errors.append(f"could not parse the 403 body in internal/api: {m_403.group(1)!r}")
        else:
            go_403 = go_403[:-2]
            if example is None:
                errors.append(
                    "the 403 response lacks the error example "
                    "(content.application/json.schema.properties.error.example) "
                    "while the code writes a concrete body"
                )
            elif example != go_403:
                errors.append(
                    f"403 example drift: spec {example!r} != internal/api {go_403!r}"
                )

    # ---- every $ref in the document must resolve inside the spec: a
    # dangling ref is silent breakage for every downstream consumer
    # (validators, generators, rendered docs) and cannot be caught by
    # route/field checks because the ref target is never visited.
    n_refs = 0
    for ref, where in walk_refs(spec):
        n_refs += 1
        if not ref.startswith("#/"):
            errors.append(f"$ref {ref!r} at {where} is external - inline it so the guard can verify it")
            continue
        if resolve_ref(spec, ref) is None:
            errors.append(f"unresolvable $ref {ref!r} at {where}")

    info.update(routes=len(go_routes), fields=len(go_fields), gated_ops=gated_ops, write_ops=write_ops, refs=n_refs)
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
        h.registerSuppressionsWrite(mux)
        h.srv = &http.Server{Handler: h.auth(mux), ReadHeaderTimeout: 5 * time.Second}
}

// The flag-gated write surface: only routes registered here answer the
// 403 body the write-surface check matches against.
func (h *Hub) registerSuppressionsWrite(mux *http.ServeMux) {
        mux.HandleFunc("POST /api/suppressions", h.handleSuppressionsCreate)
        mux.HandleFunc("DELETE /api/suppressions", h.handleSuppressionsDelete)
}

func (h *Hub) suppressWriteTarget(w http.ResponseWriter) {
        w.Header().Set("Content-Type", "application/json")
        w.WriteHeader(http.StatusForbidden)
        fmt.Fprintln(w, `{"error":"api writes are disabled: restart the engine with -api-write (or SF_API_WRITE=1) to allow suppression writes"}`)
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
                },
            },
            "/api/health": {
                "get": {
                    "operationId": "getHealth",
                    "security": [],
                    "responses": {"200": {"description": "ok"}},
                }
            },
            "/api/suppressions": {
                "post": {
                    "operationId": "writeSuppression",
                    "security": copy.deepcopy(OPTIONAL_AUTH),
                    "responses": {
                        "200": {"description": "ok"},
                        "401": {"$ref": "#/components/responses/Unauthorized"},
                        "403": {"$ref": "#/components/responses/WritesDisabled"},
                    },
                },
                "delete": {
                    "operationId": "removeSuppression",
                    "security": copy.deepcopy(OPTIONAL_AUTH),
                    "responses": {
                        "200": {"description": "ok"},
                        "401": {"$ref": "#/components/responses/Unauthorized"},
                        "403": {"$ref": "#/components/responses/WritesDisabled"},
                    },
                },
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
                },
                "WritesDisabled": {
                    "description": "write surface not armed",
                    "content": {
                        "application/json": {
                            "schema": {
                                "type": "object",
                                "properties": {
                                    "error": {
                                        "type": "string",
                                        "example": "api writes are disabled: restart the engine with -api-write (or SF_API_WRITE=1) to allow suppression writes",
                                    }
                                },
                            }
                        }
                    },
                },
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
        (
            "write op without documented 403",
            lambda s: s["paths"]["/api/suppressions"]["post"]["responses"].pop("403"),
            "does not document a 403",
        ),
        (
            "403 example drifted from the internal/api body",
            lambda s: s["components"]["responses"]["WritesDisabled"]["content"][
                "application/json"
            ]["schema"]["properties"]["error"].__setitem__(
                "example", "api writes are disabled: stale message"
            ),
            "403 example drift",
        ),
        (
            "POST served by the code but missing in the spec",
            lambda s: s["paths"]["/api/suppressions"].pop("post"),
            "served by the code but the spec declares no such operation",
        ),
        (
            "dangling $ref ignored",
            lambda s: s["paths"]["/api/stats"]["get"]["responses"].__setitem__(
                "500", {"$ref": "#/components/responses/DoesNotExist"}
            ),
            "unresolvable $ref",
        ),
        (
            "external $ref not verifiable",
            lambda s: s["components"]["schemas"]["Stats"].__setitem__(
                "$ref", "https://schemas.example.org/stats.yaml"
            ),
            "is external",
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
    go_src = "\n".join(
        p.read_text(encoding="utf-8") for p in sorted(API_DIR.glob("*.go"))
    )
    errors, info = run_checks(spec, go_src)

    if errors:
        for e in errors:
            print(f"DRIFT: {e}", file=sys.stderr)
        print(f"check_openapi: {len(errors)} drift finding(s)", file=sys.stderr)
        return 1

    print(
        f"check_openapi: OK — {info['routes']} routes, {info['fields']} Stats fields, "
        f"{info['gated_ops']} optionally-gated operations, {info['write_ops']} write operations "
        "(403-gated), "
        f"{info['refs']} $refs resolved, "
        "spec in sync with the code (routes, methods, fields, security, refs)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
