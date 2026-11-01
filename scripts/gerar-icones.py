#!/usr/bin/env python3
"""Gera icons/*.png, favicon.ico e favicon.svg (3 barras ascendentes sobre a cor da marca, css/tokens.css --brand).
Uso: python3 scripts/gerar-icones.py   (requer Pillow)"""
from pathlib import Path
from PIL import Image, ImageDraw

BRAND, FG = "#0f766e", "#ffffff"
RAIZ = Path(__file__).resolve().parent.parent
BARRAS = [(0.26, 0.52), (0.46, 0.38), (0.66, 0.24)]  # (x, topo) em fração; base em 0.74; largura 0.14


def desenhar(n, margem):
    """margem: fração do lado livre em cada borda (maskable exige zona segura de 10%+)."""
    s = 4 * n  # supersampling
    im = Image.new("RGB", (s, s), BRAND)
    d = ImageDraw.Draw(im)
    k = 1 - 2 * margem
    f = lambda v: int((margem + v * k) * s)
    for x, topo in BARRAS:
        d.rounded_rectangle([f(x), f(topo), f(x + 0.14), f(0.74)], radius=int(0.03 * k * s), fill=FG)
    return im.resize((n, n), Image.LANCZOS)


out = RAIZ / "icons"
out.mkdir(exist_ok=True)
for nome, n, m in [("icon-192.png", 192, 0), ("icon-512.png", 512, 0),
                   ("maskable-512.png", 512, 0.1), ("apple-touch-icon.png", 180, 0)]:
    desenhar(n, m).save(out / nome)
desenhar(256, 0).save(RAIZ / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])

rects = "".join(f'<rect x="{round(x*64,1)}" y="{round(t*64,1)}" width="{round(.14*64,1)}" height="{round((.74-t)*64,1)}" rx="1.9" fill="{FG}"/>'
                for x, t in BARRAS)
(RAIZ / "favicon.svg").write_text(
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="{BRAND}"/>{rects}</svg>\n')
