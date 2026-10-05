#!/usr/bin/env python3
"""Workflow trigger guard: no malformed branch/tag filters in CI triggers.

SEC-5 hardening, round 2. The on: block of a GitHub workflow is
hand-written YAML where a single malformed scalar silently disables a
trigger: `branches: [main` (unclosed flow list), a stray bracket or
whitespace inside a filter value, an accidental glob — GitHub accepts
the workflow file, shows it as enabled, and the job simply never runs.
Nothing else in the tree catches this class: actionlint is not pinned
here, and the failure is invisible until somebody notices the missing
run. This guard was written while verifying the deps-audit trigger
after its first push produced no runs; the trigger itself turned out to
be valid (see the byte-level check note in the round report — display
tools in this working environment mangle bracket sequences, so trust
byte comparisons, not rendered text), but the guard stays as preventive
coverage for every current and future workflow.

The guard scans every .github/workflows/*.yml|yaml and validates the
on: trigger block with a line-oriented walker:

  - the on: block must exist and must not be a bare scalar;
  - push/pull_request sub-blocks may declare branches, branches-ignore,
    tags and tags-ignore filters; every declared value must look like a
    real ref name: non-empty after stripping, allowed charset (letters,
    digits, . _ / - plus the glob characters * and ? that GitHub itself
    documents for filters, and which the release workflow legitimately
    uses), no flow-list leftovers ('[', ']'), no whitespace or control
    chars, no leading/trailing slash, no 'refs/' prefix (filters take
    raw names) and no '...' or '@' (ref ranges do not belong in
    filters).

This is deliberately NOT a YAML linter: it guards the one corruption
class that silently disables a trigger. A file so broken that the walker
cannot locate a proper on: block is itself a finding.

--self-test runs embedded fixtures through the same walker in a temp
directory: fixtures that must be flagged and fixtures that must stay
clean. Stdlib only.
"""

import argparse
import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW_DIRS = (ROOT / ".github" / "workflows",)

# A filter value must be a plain ref name or a GitHub glob over one
# (release.yml uses tags: v*, a documented and intentional pattern).
NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/*?-]*$")
FORBIDDEN_CHARS = tuple("[]{}~\\")
FILTER_KEYS = ("branches", "branches-ignore", "tags", "tags-ignore")


def _flagged(value: str) -> str | None:
    """Return the reason a trigger filter value is malformed, or None."""
    value = value.strip()
    if not value:
        return "empty filter value"
    if value.startswith("refs/"):
        return "filters take raw ref names, not refs/ paths"
    if value.startswith("/") or value.endswith("/"):
        return "leading/trailing slash"
    if "..." in value or "@" in value:
        return "ref range syntax does not belong in a trigger filter"
    if any(ch in value for ch in FORBIDDEN_CHARS):
        return "flow-list or glob metacharacter"
    if any(ord(ch) < 32 or ord(ch) == 127 for ch in value):
        return "control character"
    if not NAME_RE.match(value):
        return "charset outside plain ref names"
    return None


def _strip_comment(value: str) -> str:
    """Drop a trailing '# comment' from a filter value."""
    if " #" in value:
        return value.split(" #", 1)[0].strip()
    return value


def _flow_items(raw: str) -> list[str]:
    """Split a flow-list body ('main, release/*') into raw items."""
    return [item.strip() for item in raw.split(",")]


def _block_items(lines: list[str], start: int, indent: int) -> tuple[list[str], int]:
    """Collect '- item' block entries under a key; return (items, next_i)."""
    items: list[str] = []
    i = start
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        cur_indent = len(line) - len(line.lstrip(" "))
        if not stripped:
            i += 1
            continue
        if cur_indent <= indent:
            break
        if stripped.startswith("- "):
            items.append(_strip_comment(stripped[2:].strip()).strip("'\""))
            i += 1
        else:
            break
    return items, i


def check_workflow_text(rel: str, text: str) -> list[str]:
    """Validate one workflow file; return findings (empty = clean)."""
    findings: list[str] = []
    lines = text.splitlines()

    # Locate the on: block at column 0 (the YAML key may also be quoted
    # as "on":, which is how some editors force the boolean-safe form).
    on_idx = None
    for i, line in enumerate(lines):
        if re.match(r'^"?on"?:\s*($|#)', line) and not line.startswith(" "):
            on_idx = i
            break
    if on_idx is None:
        return [f"{rel}: no top-level 'on:' trigger block found"]

    # Collect the block: until the next top-level key or EOF.
    block: list[str] = []
    for line in lines[on_idx + 1 :]:
        if line.strip() and not line.startswith((" ", "\t", "#", "-")):
            break  # next top-level key
        block.append(line)

    # Walk sub-keys (push:, pull_request:, schedule:, workflow_dispatch:,
    # and their filter keys) at any depth inside the block.
    i = 0
    while i < len(block):
        line = block[i]
        stripped = line.strip()
        indent = len(line) - len(line.lstrip(" "))
        key = stripped.split(":", 1)[0] if ":" in stripped else ""
        if key in FILTER_KEYS:
            value = _strip_comment(stripped.split(":", 1)[1].strip())
            if not value or value.startswith("#"):
                items, i = _block_items(block, i + 1, indent)
                if not items:
                    findings.append(f"{rel}: '{key}' filter is empty")
            elif value.startswith("["):
                if not value.endswith("]"):
                    findings.append(
                        f"{rel}: on.{key} value {value!r}: flow list not closed"
                    )
                    i += 1
                    continue
                body = value.strip("[]").strip()
                items = _flow_items(body) if body else []
                i += 1
            else:
                items, i = [value.strip("'\"")], i + 1
            for item in items:
                reason = _flagged(item)
                if reason:
                    findings.append(f"{rel}: on.{key} value {item!r}: {reason}")
        else:
            i += 1
    return findings


def check_root(root: Path) -> list[str]:
    """Scan .github/workflows under root; return all findings."""
    findings: list[str] = []
    wf_dir = root / ".github" / "workflows"
    if not wf_dir.is_dir():
        return [f"{wf_dir}: workflows directory missing"]
    files = sorted(p for p in wf_dir.iterdir() if p.suffix in (".yml", ".yaml"))
    if not files:
        return [f"{wf_dir}: no workflow files found"]
    for path in files:
        findings.extend(check_workflow_text(path.name, path.read_text(encoding="utf-8")))
    return findings


def self_test() -> int:
    """Embedded fixtures: flagged cases and clean cases."""
    bad_scalar = BAD_SCALAR
    fixtures = {
        "bad_scalar.yml": bad_scalar,
        "unclosed_flow.yml": UNCLOSED_FLOW,
        "bad_whitespace.yml": BAD_WHITESPACE,
        "no_on_block.yml": NO_ON_BLOCK,
        "clean_flow.yml": CLEAN_FLOW,
        "clean_glob.yml": GLOB_FILTER,
        "clean_block.yml": CLEAN_BLOCK,
        "clean_bare.yml": CLEAN_BARE,
    }
    expected_flagged = {"bad_scalar.yml", "unclosed_flow.yml", "bad_whitespace.yml", "no_on_block.yml"}
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        (root / ".github" / "workflows").mkdir(parents=True)
        for name, text in fixtures.items():
            (root / ".github" / "workflows" / name).write_text(text, encoding="utf-8")
        findings = check_root(root)
        flagged = {f.split(":")[0] for f in findings}
    ok = True
    for name in sorted(expected_flagged):
        if name not in flagged:
            print(f"self-test FAIL: {name} should be flagged", file=sys.stderr)
            ok = False
    for name in sorted(set(fixtures) - expected_flagged):
        if name in flagged:
            print(f"self-test FAIL: {name} should be clean", file=sys.stderr)
            ok = False
    if not findings:
        print("self-test FAIL: no findings produced at all", file=sys.stderr)
        ok = False
    if ok:
        print(f"self-test OK: {len(findings)} findings across 4 bad fixtures, 4 clean fixtures clean")
    return 0 if ok else 1


BAD_SCALAR = """name: bad
on:
  push:
    branches: ain]
jobs:
  a:
    runs-on: ubuntu-latest
    steps: [{run: 'true'}]
"""
UNCLOSED_FLOW = """name: unclosed
on:
  push:
    branches: [main
jobs:
  a:
    runs-on: ubuntu-latest
    steps: [{run: 'true'}]
"""
GLOB_FILTER = """name: glob
on:
  pull_request:
    branches: [release/*, main]
jobs:
  a:
    runs-on: ubuntu-latest
    steps: [{run: 'true'}]
"""
NO_ON_BLOCK = """name: no-trigger
jobs:
  a:
    runs-on: ubuntu-latest
    steps: [{run: 'true'}]
"""
BAD_WHITESPACE = """name: bad-ws
on:
  push:
    tags:
      - v1.0.0 extra
jobs:
  a:
    runs-on: ubuntu-latest
    steps: [{run: 'true'}]
"""
CLEAN_FLOW = """name: clean-flow
on:
  push:
    branches: [main, carril/seguridad-b]
  pull_request:
jobs:
  a:
    runs-on: ubuntu-latest
    steps: [{run: 'true'}]
"""
CLEAN_BLOCK = """name: clean-block
on:
  push:
    branches:
      - main
      - carril/seguridad-b
    tags:
      - v1.0.0
jobs:
  a:
    runs-on: ubuntu-latest
    steps: [{run: 'true'}]
"""
CLEAN_BARE = """name: clean-bare
on:
  push:
  pull_request:
  workflow_dispatch: {}
jobs:
  a:
    runs-on: ubuntu-latest
    steps: [{run: 'true'}]
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--self-test", action="store_true", help="run embedded fixtures")
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    findings = check_root(ROOT)
    for finding in findings:
        print(finding, file=sys.stderr)
    if findings:
        print(f"check_workflows: {len(findings)} finding(s)", file=sys.stderr)
        return 1
    print("check_workflows: all workflow triggers clean")
    return 0


if __name__ == "__main__":
    sys.exit(main())
