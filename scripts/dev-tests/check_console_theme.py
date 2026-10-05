#!/usr/bin/env python3
"""Console theme palette checker (Pulimiento B, THEME round 2026-10-05).

Parses web/console/src/app/globals.css, extracts the dark (:root) and the
light (html.light) token sets, and validates both against the same rules
the dark palette documented in its comments:

  - core UI pairs meet WCAG 2.1 AA (text >= 4.5, large text / UI >= 3.0);
  - severity steps and status colors are >= 3:1 on the viz surface
    (non-text data ink, always shipped with an icon and a text label);
  - sequential (one-hue) ramp steps are >= 2:1 on the viz surface;
  - adjacent severity steps and categorical series stay separated under
    normal vision and the three CVD simulations (CIEDE2000 on Machado et
    al. 2009 severity-1.0 simulated colors), with the light theme never
    doing meaningfully worse than the dark one.

Pure stdlib. Run from the repo root: python3 scripts/dev-tests/check_console_theme.py
"""

from __future__ import annotations

import math
import re
import sys
from pathlib import Path

CSS_PATH = Path(__file__).resolve().parents[2] / "web/console/src/app/globals.css"

# Machado, Oliveira & Fernandes (2009) severity-1.0 simulation matrices.
CVD_MATRICES: dict[str, tuple[tuple[float, ...], ...]] = {
    "protan": (
        (0.152286, 1.052583, -0.204868),
        (0.114503, 0.786281, 0.099216),
        (-0.003882, -0.048116, 1.051998),
    ),
    "deutan": (
        (0.367322, 0.860646, -0.227968),
        (0.280085, 0.672501, 0.047413),
        (-0.011820, 0.042940, 0.968881),
    ),
    "tritan": (
        (1.255528, -0.076749, -0.178779),
        (-0.078411, 0.930809, 0.147602),
        (0.004733, 0.691367, 0.303900),
    ),
}

FAILURES: list[str] = []


def fail(msg: str) -> None:
    FAILURES.append(msg)


# ---------------------------------------------------------------- colors
def parse_hex(token: str) -> tuple[float, float, float]:
    t = token.strip().lstrip("#")
    if len(t) == 3:
        t = "".join(c * 2 for c in t)
    if len(t) != 6:
        raise ValueError(f"not a hex color: {token!r}")
    return tuple(int(t[i : i + 2], 16) / 255.0 for i in (0, 2, 4))  # type: ignore[return-value]


def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def relative_luminance(rgb: tuple[float, float, float]) -> float:
    r, g, b = (srgb_to_linear(v) for v in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    la, lb = relative_luminance(a), relative_luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def rgb_to_lab(rgb: tuple[float, float, float]) -> tuple[float, float, float]:
    def g(c: float) -> float:
        return ((c + 0.055) / 1.055) ** 2.4 if c > 0.04045 else c / 12.92

    r, gg, b = (g(v) for v in rgb)
    x = (0.4124564 * r + 0.3575761 * gg + 0.1804375 * b) / 0.95047
    y = 0.2126729 * r + 0.7151522 * gg + 0.0721750 * b
    z = (0.0193339 * r + 0.1191920 * gg + 0.9503041 * b) / 1.08883

    def h(t: float) -> float:
        return t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116

    fx, fy, fz = h(x), h(y), h(z)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def ciede2000(lab1: tuple[float, float, float], lab2: tuple[float, float, float]) -> float:
    """CIEDE2000 color difference (Sharma et al. 2005 formulation)."""
    l1, a1, b1 = lab1
    l2, a2, b2 = lab2
    c1 = math.hypot(a1, b1)
    c2 = math.hypot(a2, b2)
    cbar = (c1 + c2) / 2
    g = 0.5 * (1 - math.sqrt(cbar**7 / (cbar**7 + 25**7)))
    ap1, ap2 = a1 * (1 + g), a2 * (1 + g)
    cp1, cp2 = math.hypot(ap1, b1), math.hypot(ap2, b2)
    hp1 = math.degrees(math.atan2(b1, ap1)) % 360 if (ap1 or b1) else 0.0
    hp2 = math.degrees(math.atan2(b2, ap2)) % 360 if (ap2 or b2) else 0.0
    dl = l2 - l1
    dc = cp2 - cp1
    if cp1 * cp2 == 0:
        dh = 0.0
    else:
        d = hp2 - hp1
        if d > 180:
            d -= 360
        elif d < -180:
            d += 360
        dh = 2 * math.sqrt(cp1 * cp2) * math.sin(math.radians(d) / 2)
    lbar, cbar2 = (l1 + l2) / 2, (cp1 + cp2) / 2
    if cp1 * cp2 == 0:
        hbar = hp1 + hp2
    else:
        diff, total = hp1 - hp2, hp1 + hp2
        if abs(diff) <= 180:
            hbar = total / 2
        elif total < 360:
            hbar = (total + 360) / 2
        else:
            hbar = (total - 360) / 2
    t = (
        1
        - 0.17 * math.cos(math.radians(hbar - 30))
        + 0.24 * math.cos(math.radians(2 * hbar))
        + 0.32 * math.cos(math.radians(3 * hbar + 6))
        - 0.20 * math.cos(math.radians(4 * hbar - 63))
    )
    dtheta = 30 * math.exp(-(((hbar - 275) / 25) ** 2))
    rc = 2 * math.sqrt(cbar2**7 / (cbar2**7 + 25**7))
    sl = 1 + (0.015 * (lbar - 50) ** 2) / math.sqrt(20 + (lbar - 50) ** 2)
    sc = 1 + 0.045 * cbar2
    sh = 1 + 0.015 * cbar2 * t
    rt = -math.sin(math.radians(2 * dtheta)) * rc
    return math.sqrt((dl / sl) ** 2 + (dc / sc) ** 2 + (dh / sh) ** 2 + rt * (dc / sc) * (dh / sh))


def simulate_cvd(rgb: tuple[float, float, float], kind: str) -> tuple[float, float, float]:
    m = CVD_MATRICES[kind]
    return tuple(  # type: ignore[return-value]
        max(0.0, min(1.0, sum(m[i][j] * rgb[j] for j in range(3)))) for i in range(3)
    )


def min_cvd_de(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    return min(ciede2000(rgb_to_lab(simulate_cvd(a, k)), rgb_to_lab(simulate_cvd(b, k))) for k in CVD_MATRICES)


def normal_de(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    return ciede2000(rgb_to_lab(a), rgb_to_lab(b))


# ------------------------------------------------------------------ css
def parse_block(css: str, selector: str) -> dict[str, str]:
    m = re.search(re.escape(selector) + r"\s*\{([^}]*)\}", css, re.S)
    if not m:
        raise SystemExit(f"globals.css: selector {selector!r} not found")
    out: dict[str, str] = {}
    for line in m.group(1).splitlines():
        line = line.split("/*")[0].strip().rstrip(";")
        if ":" in line and line.startswith("--"):
            k, _, v = line.partition(":")
            out[k.strip()] = v.strip()
    return out


def check(name: str, ratio: float, floor: float, kind: str) -> None:
    ok = ratio >= floor
    print(f"  {'ok ' if ok else 'FAIL'} {name:<44} {ratio:5.2f}:1  (>= {floor}:1, {kind})")
    if not ok:
        fail(f"{name}: {ratio:.2f}:1 < {floor}:1")


def main() -> int:
    css = CSS_PATH.read_text()
    dark = parse_block(css, ":root")
    light = parse_block(css, "html.light")
    if not light:
        raise SystemExit("globals.css: the html.light block is empty or missing")

    themes = {"dark": dark, "light": light}
    for theme, tok in themes.items():
        print(f"\n[{theme}] UI text pairs (WCAG 2.1)")
        surface = parse_hex(tok["--background"])
        card = parse_hex(tok["--card"])
        pairs = [
            ("foreground / background", tok["--foreground"], tok["--background"], 4.5),
            ("foreground / card", tok["--foreground"], tok["--card"], 4.5),
            ("muted-foreground / background", tok["--muted-foreground"], tok["--background"], 4.5),
            ("muted-foreground / card", tok["--muted-foreground"], tok["--card"], 4.5),
            # the zinc-500 hint tier is theme-remapped for AA (dark #93939a,
            # light #6b6b74); validate the tier itself, not one component
            ("zinc-500 / background", tok["--color-zinc-500"], tok["--background"], 4.5),
            ("zinc-500 / card", tok["--color-zinc-500"], tok["--card"], 4.5),
            ("zinc-500 / viz-surface", tok["--color-zinc-500"], tok["--viz-surface"], 4.5),
            ("primary-foreground / primary", tok["--primary-foreground"], tok["--primary"], 4.5),
            ("secondary-foreground / secondary", tok["--secondary-foreground"], tok["--secondary"], 4.5),
            ("accent-foreground / accent", tok["--accent-foreground"], tok["--accent"], 4.5),
            ("popover-foreground / popover", tok["--popover-foreground"], tok["--popover"], 4.5),
            # accent family roles (THEME-2): link/soft are text on the two
            # surfaces; strong carries the white solid-button label; tint is
            # a fill, judged as non-text below.
            ("primary-link / background", tok["--primary-link"], tok["--background"], 4.5),
            ("primary-link / card", tok["--primary-link"], tok["--card"], 4.5),
            ("primary-soft / background", tok["--primary-soft"], tok["--background"], 4.5),
            ("primary-soft / card", tok["--primary-soft"], tok["--card"], 4.5),
            ("white / primary-strong", "#ffffff", tok["--primary-strong"], 4.5),
            # the solid button hovers onto --primary-tint keeping its white
            # label, so the hover state must hold AA in both themes too
            ("white / primary-tint", "#ffffff", tok["--primary-tint"], 4.5),
        ]
        for label, fk, bk, floor in pairs:
            try:
                check(label, contrast(parse_hex(fk), parse_hex(bk)), floor, "text")
            except ValueError as e:
                fail(f"{theme} {label}: {e}")

        print(f"[{theme}] focus / non-text pairs")
        check("ring / background", contrast(parse_hex(tok["--ring"]), surface), 3.0, "ui")
        check("destructive / background", contrast(parse_hex(tok["--destructive"]), surface), 3.0, "ui")
        check("primary / background", contrast(parse_hex(tok["--primary"]), surface), 3.0, "ui")
        check("primary-tint / background", contrast(parse_hex(tok["--primary-tint"]), surface), 3.0, "ui")
        check("primary-tint / card", contrast(parse_hex(tok["--primary-tint"]), card), 3.0, "ui")

        print(f"[{theme}] data ink on --viz-surface (>= 3:1 non-text)")
        viz = parse_hex(tok["--viz-surface"])
        sev = [tok[f"--sev-{s}"] for s in ("critical", "high", "medium", "low", "info")]
        for label, value in zip(("critical", "high", "medium", "low", "info"), sev):
            check(f"sev-{label}", contrast(parse_hex(value), viz), 3.0, "data")
        for label in ("good", "warning", "serious", "critical"):
            check(f"status-{label}", contrast(parse_hex(tok[f"--status-{label}"]), viz), 3.0, "data")
        check("viz-muted / viz-surface", contrast(parse_hex(tok["--viz-muted"]), viz), 4.5, "text")

        print(f"[{theme}] sequential ramp (>= 2:1 ordinal steps)")
        seq = [tok[f"--seq-{i}"] for i in range(1, 6)]
        for i, value in enumerate(seq, 1):
            check(f"seq-{i}", contrast(parse_hex(value), viz), 2.0, "data")

        print(f"[{theme}] CVD separation (CIEDE2000, worst of protan/deutan/tritan)")
        for i in range(4):
            a, b = parse_hex(sev[i]), parse_hex(sev[i + 1])
            worst = min_cvd_de(a, b)
            print(f"  {'ok ' if worst >= 10 else 'FAIL'} sev {['critical','high','medium','low'][i]}->{['critical','high','medium','low','info'][i + 1]:<8} dE {worst:5.1f} (>= 10)")
            if worst < 10:
                fail(f"{theme}: severity {i}->{i + 1} CVD dE {worst:.1f} < 10")
        series = [tok[f"--series-{i}"] for i in range(1, 5)]
        for i in range(3):
            worst = min_cvd_de(parse_hex(series[i]), parse_hex(series[i + 1]))
            print(f"  {'ok ' if worst >= 10 else 'FAIL'} series {i + 1}->{i + 2:<19} dE {worst:5.1f} (>= 10)")
            if worst < 10:
                fail(f"{theme}: series {i + 1}->{i + 2} CVD dE {worst:.1f} < 10")

    # The two surfaces (near-black vs white) sit on different absolute dE
    # scales, so exact cross-theme dE equality is not the binding rule; the
    # per-theme floors above are. Parity only guards against a light value
    # that quietly loses the dark palette's margin (tolerance 5.0 dE).
    print("\n[parity] light worst-case vs dark worst-case (tolerance 5.0 dE)")
    for family, keys in (
        ("severity-adjacent", [("--sev-critical", "--sev-high"), ("--sev-high", "--sev-medium"), ("--sev-medium", "--sev-low"), ("--sev-low", "--sev-info")]),
        ("series-adjacent", [("--series-1", "--series-2"), ("--series-2", "--series-3"), ("--series-3", "--series-4")]),
    ):
        for a, b in keys:
            d_dark = min_cvd_de(parse_hex(dark[a]), parse_hex(dark[b]))
            d_light = min_cvd_de(parse_hex(light[a]), parse_hex(light[b]))
            ok = d_light >= d_dark - 5.0
            print(f"  {'ok ' if ok else 'FAIL'} {family} {a}/{b}: dark {d_dark:5.1f} light {d_light:5.1f}")
            if not ok:
                fail(f"parity {family} {a}/{b}: light {d_light:.1f} < dark {d_dark:.1f} - 5.0")

    print()
    if FAILURES:
        print(f"check_console_theme: {len(FAILURES)} failure(s)")
        for f in FAILURES:
            print(f"  - {f}")
        return 1
    print("check_console_theme: all pairs pass in both themes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
