#!/usr/bin/env python3
"""Guard against native-command stderr redirection in the installers.

Under $ErrorActionPreference = 'Stop' (install.ps1's default), Windows
PowerShell 5.1 turns the first REDIRECTED stderr line of any native
command into a terminating NativeCommandError: both ``2>&1`` and
``2>$null`` materialize the ErrorRecord before the discard happens.
'git clone' ALWAYS opens with a stderr line ("Cloning into ..."), so the
one-command installer died on git's own progress banner with a green CI
(nothing parsed or linted the redirect pattern).

Rule: install.ps1 and uninstall.ps1 must not redirect a native command's
stderr. The only allowed occurrence is the Invoke-Native helper itself
(``& $Command 2>&1``), which runs with ErrorActionPreference=Continue so
the records can never become terminating, and judge by exit code.

--self-test keeps a falsability fixture in the tree: the exact patterns
that crashed the installer must be reported.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent
TARGETS = [REPO / "install.ps1", REPO / "uninstall.ps1"]

# the helper's own merge line, and comment lines, are the only allowed
# occurrences of a stderr redirection.
HELPER_LINE = re.compile(r"[&.]\s*\$Command\s*2>&1")
REDIRECT = re.compile(r"2>&1|2>\$null")
COMMENT = re.compile(r"^\s*#")


def scan(text: str, source: str) -> list[str]:
    findings: list[str] = []
    for n, line in enumerate(text.splitlines(), start=1):
        if REDIRECT.search(line) and not HELPER_LINE.search(line) and not COMMENT.match(line):
            findings.append(
                f"{source}:{n}: native stderr redirected under "
                f"$ErrorActionPreference='Stop': {line.strip()!r} "
                f"(use Invoke-Native, or drop the redirect)"
            )
    return findings


def self_test() -> int:
    fixtures = {
        # the exact crash of the 2026-10-02 user report: git clone progress
        "install.ps1": "& git clone --depth 1 --branch $Br \"https://github.com/$RepoId.git\" $tmp 2>&1 |\n    ForEach-Object { Write-Info $_ }",
        # silent-discarding variant on a probe
        "uninstall.ps1": "$q = reg query HKCU\\Environment /v Path 2>$null",
        # version probe variant (command behind a variable)
        "install.ps1:b": "$v = (& $sys.Source version) 2>$null",
    }
    bad = 0
    for name, text in fixtures.items():
        f = scan(text, name)
        if not f:
            print(f"self-test FAIL: fixture {name} not reported")
            bad += 1
        else:
            print(f"self-test ok: fixture {name} reported ({len(f)} finding)")
    # the helper's own line must NOT be reported
    ok_helper = scan("        $lines = @(& $Command 2>&1 | ForEach-Object { \"$_\" })", "helper")
    comments = scan("    # both 2>&1 and 2>$null materialize the ErrorRecord", "doc")
    if ok_helper or comments:
        print("self-test FAIL: helper/comment line reported as violation")
        bad += 1
    else:
        print("self-test ok: helper and comment lines accepted")
    return bad


def main() -> int:
    if "--self-test" in sys.argv:
        return 1 if self_test() else 0

    findings: list[str] = []
    for path in TARGETS:
        if not path.exists():
            findings.append(f"{path}: missing target file")
            continue
        findings += scan(path.read_text(encoding="utf-8"), path.name)
    if findings:
        for f in findings:
            print(f"FAIL {f}")
        return 1
    print(
        "check_installer_native_stderr: OK — no native stderr redirection "
        "outside Invoke-Native in install.ps1/uninstall.ps1"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
