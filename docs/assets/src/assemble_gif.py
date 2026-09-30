# -*- coding: utf-8 -*-
"""Ensambla console-busqueda.gif desde los frames que deja
capture_console.mjs en su directorio temporal.

Uso:
    python3 assemble_gif.py <dir-de-frames> [salida.gif]

Salida por defecto: docs/assets/console-busqueda.gif (1100 px de ancho,
paleta adaptativa por frame, ~450 ms por frame con retención larga en
el último — la convención documentada en docs/assets/README.md).
"""
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
# HERE = docs/assets/src -> tres niveles arriba queda la raíz del repo
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
DEFAULT_OUT = os.path.join(REPO, "docs", "assets", "console-busqueda.gif")

FRAME_MS = 450
FINAL_MS = 1800
TARGET_W = 1100


def main():
    frames_dir = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_OUT
    names = sorted(
        (f for f in os.listdir(frames_dir) if f.endswith(".png")),
        key=lambda n: int(os.path.splitext(n)[0][1:]) if n[0] == "f" else 0,
    )
    if not names:
        raise SystemExit(f"sin frames PNG en {frames_dir}")
    frames = []
    for n in names:
        im = Image.open(os.path.join(frames_dir, n)).convert("RGB")
        if im.width != TARGET_W:
            im = im.resize((TARGET_W, round(im.height * TARGET_W / im.width)),
                           Image.LANCZOS)
        frames.append(im.quantize(colors=256, method=Image.MEDIANCUT))
    durations = [FRAME_MS] * len(frames)
    durations[-1] = FINAL_MS
    frames[0].save(
        out, save_all=True, append_images=frames[1:], duration=durations,
        loop=0, optimize=True, disposal=2,
    )
    print(f"OK gif -> {out} ({len(frames)} frames)")


if __name__ == "__main__":
    main()
