#!/usr/bin/env python3
"""Guard: Makefile recipes must be tab-indented.

Outage class: an editor expanded every recipe tab to 8 spaces
(63fa077, 2026-10-05) and `make` died with "missing separator" on
every target - silently, because CI runs the underlying commands
directly and never invokes make, so a broken build entry point shipped
to main behind a green pipeline. This guard pins the GNU make
contract: a recipe line (any line inside a rule's recipe block) must
start with a TAB.

Static and stdlib-only (no make required, works on any runner and any
sandbox). Rule position is tracked like make does:
  - a column-0 line containing ':' starts a rule; the indented lines
    that follow are its recipe;
  - a column-0 line without ':' (variable, include, conditional
    keyword like ifeq/define) does NOT open a recipe - space-indented
    bodies are legal there, so they are exempt by design;
  - a recipe line ending in backslash continues on the next line; the
    continuation is passed to the shell verbatim and may carry any
    indentation, so it is NOT checked;
  - blank lines and lines starting with '#' never switch state, as
    make treats them inside recipes.

--self-test runs the checker over embedded fixtures (a good makefile,
the real corruption, a space-indented variable which is legal, a
backslash continuation which is legal) and asserts both directions.
"""

from __future__ import annotations

import re
import sys

LINE_NUM = re.compile(r"^line (\d+): ")
# Leading name followed directly by an assignment operator: VAR := x,
# VAR ?= x, VAR += x, VAR ::= x (also covers "A = B" shape via the
# optional operator). A rule header like "all: build" or
# "build: FLAGS ?= x" does NOT match (the '=' is not adjacent to the
# name), which is what separates rules from assignments that merely
# contain colons later (URL := http://x).
ASSIGNMENT_RE = re.compile(r"^\S+\s*(::=|:=|\+=|\?=|=)")


def check_lines(lines: list[str]) -> list[str]:
    """Return the list of defect messages for the given makefile lines."""
    defects: list[str] = []
    in_recipe = False
    for idx, raw in enumerate(lines, start=1):
        line = raw.rstrip("\n")
        if not line.strip():
            continue  # blank lines never switch mode (make ignores them)
        if line.startswith("\t"):
            # Recipe line. If it ends with a backslash the next logical
            # line is a shell continuation: passed verbatim, any
            # indentation legal, so it is NOT checked.
            in_recipe = not line.rstrip().endswith("\\")
            continue
        if line[0] == " ":
            if in_recipe and not line.lstrip().startswith("#"):
                defects.append(
                    f"line {idx}: recipe line indented with spaces "
                    f"({len(line) - len(line.lstrip())} spaces) - GNU make "
                    f"requires a TAB; make fails on this file with 'missing separator'"
                )
                continue
            # Space-indented line outside a recipe (wrapped variable,
            # conditional body, comment continuation) is legal make.
            continue
        # Column-0 line.
        if line.lstrip().startswith("#"):
            continue  # comment: no state change
        if ASSIGNMENT_RE.match(line) or ":" not in line:
            # Variable assignment (even one containing colons, like
            # URL := http://x), include, or conditional keyword:
            # space-indented bodies are legal here, so this does NOT
            # open a recipe block.
            in_recipe = False
        else:
            # Rule header (target, .PHONY, target-specific variable):
            # the next indented line is its recipe.
            in_recipe = True
    return defects


GOOD = """\
GO ?= go
BIN_DIR ?= bin

build:
\t$(GO) build -o $(BIN_DIR)/engine ./cmd/engine

run-engine:
\t$(GO) run ./cmd/engine -addr :7777 \\
\t\t-rules ./rules -v

# a comment at column zero
ci:
\t@out="$$(gofmt -l .)"; if [ -n "$$out" ]; then exit 1; fi
\t$(GO) build ./...
"""

BAD = """\
build:
        $(GO) build -o bin/engine ./cmd/engine
\t$(GO) vet ./...
"""

SPACE_VARIABLE = """\
LONG_VAR := first part \\
        second part is a shell-visible continuation, legal outside recipes
"""

URL_VARIABLE = """\
URL := http://x.example:8080/path
        REAL_TARGET_COLON_IS_NOT_HERE (space continuation after an assignment: legal)

after-url:
	echo ok
"""


def run(paths: list[str]) -> int:
    failed = False
    for path in paths:
        try:
            with open(path, "r", encoding="utf-8") as fh:
                lines = fh.readlines()
        except OSError as exc:
            print(f"check_makefile_tabs: cannot read {path}: {exc}", file=sys.stderr)
            return 2
        defects = check_lines(lines)
        for msg in defects:
            m = LINE_NUM.match(msg)
            where = f"file={path},line={m.group(1)}" if m else f"file={path}"
            print(f"::error {where}::check_makefile_tabs: {msg}")
            failed = True
        if not defects:
            print(f"check_makefile_tabs: {path}: OK (every recipe line is tab-indented)")
    return 1 if failed else 0


def self_test() -> int:
    # Each case: (name, makefile text, expected defect line numbers).
    cases = [
        ("good makefile (tabs, continuation, comment)", GOOD, []),
        ("space recipe (the 63fa077 outage class)", BAD, [2]),
        ("space-indented wrapped variable (legal)", SPACE_VARIABLE, []),
        ("assignment containing colons, then a tab rule (legal)", URL_VARIABLE, []),
        ("empty file", "", []),
    ]
    failed = False
    for name, text, want in cases:
        got = [int(m.group(1)) for m in (LINE_NUM.match(d) for d in check_lines(text.splitlines())) if m]
        ok = got == want
        print(f"check_makefile_tabs self-test: {name}: {'ok' if ok else 'FAIL (got ' + repr(got) + ', want ' + repr(want) + ')'}")
        if not ok:
            failed = True
    return 1 if failed else 0


def main(argv: list[str]) -> int:
    args = [a for a in argv[1:] if not a.startswith("-")]
    if "--self-test" in argv:
        return self_test()
    targets = args or ["Makefile"]
    return run(targets)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
