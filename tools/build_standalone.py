#!/usr/bin/env python3
"""Assemble la page en UN seul fichier (dist/time2relax.html) à double-cliquer.

Le fichier contient tout : styles, scripts et icône. Il fonctionne sans serveur ni réseau.
(Pas de service worker ni d'installation « comme une appli » dans ce mode : il faut une adresse web.)
"""
import base64
import pathlib
import re

root = pathlib.Path(__file__).resolve().parent.parent
html = (root / 'index.html').read_text(encoding='utf-8')

css = (root / 'style.css').read_text(encoding='utf-8')
html = html.replace('<link rel="stylesheet" href="style.css">', f'<style>\n{css}\n</style>')

icon = base64.b64encode((root / 'icon-192.png').read_bytes()).decode()
html = html.replace('<link rel="icon" type="image/png" href="icon-192.png">',
                    f'<link rel="icon" type="image/png" href="data:image/png;base64,{icon}">')
html = re.sub(r'\s*<link rel="apple-touch-icon"[^>]*>', '', html)
html = re.sub(r'\s*<link rel="manifest"[^>]*>', '', html)


def inline(match):
    name = match.group(1)
    code = (root / name).read_text(encoding='utf-8').replace('</script>', '<\\/script>')
    return f'<script>\n{code}\n</script>'


html = re.sub(r'<script src="([^"]+)"></script>', inline, html)
# En mode fichier, la notification utilise l'icône intégrée.
html = html.replace("icon: 'icon-192.png'", f"icon: 'data:image/png;base64,{icon}'")

out = root / 'dist'
out.mkdir(exist_ok=True)
target = out / 'time2relax.html'
target.write_text(html, encoding='utf-8')
print(f'{target} ({target.stat().st_size // 1024} Ko)')
