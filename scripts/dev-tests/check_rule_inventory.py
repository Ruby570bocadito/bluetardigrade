#!/usr/bin/env python3
"""Check/regenerate the operator rule inventory from the shipped YAML packs."""

import argparse
from collections import Counter
from pathlib import Path
import re
import sys

import yaml

ROOT = Path(__file__).resolve().parents[2]
DOC = ROOT / "docs/OPERATIONS.md"
BEGIN = "<!-- BEGIN RULE INVENTORY -->"
END = "<!-- END RULE INVENTORY -->"
SEVERITIES = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}


def inventory():
    rules = []
    ids = set()
    for path in sorted((ROOT / "rules").rglob("*.yaml")):
        pack = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not isinstance(pack, list):
            raise ValueError(f"{path.relative_to(ROOT)}: expected a rule list")
        for rule in pack:
            if not isinstance(rule, dict):
                raise ValueError(f"{path.relative_to(ROOT)}: expected a rule mapping")
            if rule.get("enabled", True) is False:
                continue
            for key in ("id", "name", "severity", "event_type"):
                if not isinstance(rule.get(key), str) or not rule[key]:
                    raise ValueError(f"{path.relative_to(ROOT)}: invalid {key}")
            if rule["severity"] not in SEVERITIES:
                raise ValueError(f"{path.relative_to(ROOT)}: invalid severity")
            if rule["id"] in ids:
                raise ValueError(f"duplicate rule id: {rule['id']}")
            ids.add(rule["id"])
            rules.append(rule)
    return sorted(rules, key=lambda rule: (SEVERITIES[rule["severity"]], rule["name"].casefold(), rule["id"]))


def cell(value):
    return " ".join(str(value).splitlines()).replace("|", r"\|")


def render(rules):
    counts = Counter(rule["severity"] for rule in rules)
    breakdown = " / ".join(f"{counts[sev]} {sev}" for sev in SEVERITIES if counts[sev])
    types = len({rule["event_type"] for rule in rules})
    lines = [
        f"The enabled pack contains **{len(rules)} rules across {types} event types**: {breakdown}.",
        "Full IDs are retained because different rules in a pack can share a UUID prefix.",
        "",
        "| ID | Rule | Severity | Event type | ATT&CK | Tactic |",
        "|----|------|----------|------------|--------|--------|",
    ]
    for rule in rules:
        tags = rule.get("tags", [])
        if not isinstance(tags, list) or any(not isinstance(tag, str) for tag in tags):
            raise ValueError(f"{rule['id']}: invalid tags")
        techniques = sorted({tag.removeprefix("attack.").upper() for tag in tags if re.fullmatch(r"attack\.t\d{4}(\.\d{3})?", tag)})
        tactics = sorted({tag.removeprefix("attack.") for tag in tags if tag.startswith("attack.") and not tag.startswith("attack.t")})
        values = [f"`{rule['id']}`", rule["name"], rule["severity"], f"`{rule['event_type']}`", ", ".join(techniques), ", ".join(tactics)]
        lines.append("| " + " | ".join(cell(value) for value in values) + " |")
    return "\n" + "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="update only the marked inventory in OPERATIONS.md")
    args = parser.parse_args()
    try:
        rules = inventory()
        text = DOC.read_text(encoding="utf-8")
        if text.count(BEGIN) != 1 or text.count(END) != 1:
            raise ValueError("OPERATIONS.md must contain exactly one inventory marker pair")
        before, rest = text.split(BEGIN, 1)
        current, after = rest.split(END, 1)
        expected = render(rules)
        if args.write:
            DOC.write_text(before + BEGIN + expected + END + after, encoding="utf-8")
        elif current != expected:
            raise ValueError("rule inventory is stale; run python3 scripts/dev-tests/check_rule_inventory.py --write")
    except (ValueError, OSError, yaml.YAMLError) as err:
        print(f"check_rule_inventory: {err}", file=sys.stderr)
        return 1
    print(f"check_rule_inventory: OK — {len(rules)} enabled rules, unique IDs, documented from YAML")
    return 0


if __name__ == "__main__":
    sys.exit(main())
