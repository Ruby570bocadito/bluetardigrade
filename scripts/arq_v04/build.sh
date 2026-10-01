#!/usr/bin/env bash
# arq_v04/build.sh — reproducible build of docs/arquitectura-tecnica-v0.11.pdf
#
# Prerequisites:
#   python3 + reportlab + pypdf + pillow   (body + merge)
#   node + playwright (chromium)           (cover page.pdf + diagram screenshots)
#
# Steps:
#   1. Body PDF  — ReportLab (TocDocTemplate + multiBuild), starts at the TOC.
#   2. Cover PDF — docs/assets/src/cover-v0.11.html via Playwright page.pdf
#                  (794x1123 px A4 @96dpi, vector, zero margins).
#   3. Merge     — cover as page 0, normalized to A4, series metadata.
#
# Regenerating the diagrams (optional, only when their sources change):
#   node scripts/arq_v04/render_diagram.mjs docs/assets/src/diagram_arquitectura.html \
#        docs/assets/diagram_arquitectura.png
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
cd "$REPO"

echo "[1/3] body..."
python3 scripts/arq_v04/generator.py

echo "[2/3] cover..."
node scripts/arq_v04/render_cover.mjs docs/assets/src/cover-v0.11.html \
     docs/arquitectura-tecnica-v0.11.cover.pdf

echo "[3/3] merge + metadata..."
python3 scripts/arq_v04/merge_and_meta.py
