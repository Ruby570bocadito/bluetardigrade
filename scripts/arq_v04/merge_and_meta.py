#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
arq_v04/merge_and_meta.py — inserts the rendered cover as page 0 of the body
PDF (normalized to A4) and writes the final document metadata, matching the
series convention of arquitectura-tecnica-v0.1..v0.3.

Usage: python3 scripts/arq_v04/merge_and_meta.py
"""

import os

from pypdf import PdfReader, PdfWriter

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
COVER = os.path.join(REPO, "docs", "arquitectura-tecnica-v0.4.cover.pdf")
BODY = os.path.join(REPO, "docs", "arquitectura-tecnica-v0.4.body.pdf")
FINAL = os.path.join(REPO, "docs", "arquitectura-tecnica-v0.4.pdf")

A4_W, A4_H = 595.28, 841.89


def normalize_page_to_a4(page):
    box = page.mediabox
    w, h = float(box.width), float(box.height)
    # Strict: Playwright px->pt rounding produces 595.9x842.9 for a 794x1123px
    # page; anything not exactly A4 (within half a point) is scaled.
    if abs(w - A4_W) > 0.5 or abs(h - A4_H) > 0.5:
        page.scale_to(A4_W, A4_H)
    return page


writer = PdfWriter()
writer.add_page(normalize_page_to_a4(PdfReader(COVER).pages[0]))
for page in PdfReader(BODY).pages:
    writer.add_page(normalize_page_to_a4(page))
writer.add_metadata({
    "/Title": "Arquitectura Técnica - Framework de Detección de Amenazas en Tiempo Real (v0.4)",
    "/Author": "Ruby570bocadito",
    "/Creator": "Ruby570bocadito",
    "/Subject": "Documento de arquitectura tecnica v0.4: estado implementado y verificado del framework",
})
with open(FINAL, "wb") as fh:
    writer.write(fh)
os.remove(BODY)
os.remove(COVER)
print(f"final written: {FINAL} ({len(writer.pages)} pages)")
