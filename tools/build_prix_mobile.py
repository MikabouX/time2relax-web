#!/usr/bin/env python3
"""Fabrique la version mobile du simulateur (time2relax.app/prix-mobile/) à partir de conso-estimation-r8m3/index.html.

À relancer après chaque modification du simulateur :  python3 tools/build_prix_mobile.py
Différences avec la page principale :
  - sans les outils TVA et HR helper ;
  - mise en page pour petit écran : barre d'onglets en bas, tout sur une colonne ;
  - installable comme une appli (manifest + service worker dans prix-mobile/).
Les sous-pages (détails de prix, concurrence, avis) restent celles du simulateur : une balise <base> y renvoie.
"""
import pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'conso-estimation-r8m3' / 'index.html'
DST = ROOT / 'prix-mobile' / 'index.html'

s = SRC.read_text(encoding='utf-8')

def rep(old, new, count=1):
    global s
    if old not in s:
        sys.exit('Introuvable dans le simulateur : ' + old[:80])
    s = s.replace(old, new, count)

# 1. En-tête : liens relatifs vers le dossier du simulateur, appli installable
rep('<link rel="icon" href="icon.svg" type="image/svg+xml">',
    '<link rel="manifest" href="/prix-mobile/manifest.webmanifest">\n'
    '<meta name="theme-color" content="#0071b5">\n'
    '<meta name="apple-mobile-web-app-capable" content="yes">\n'
    '<meta name="mobile-web-app-capable" content="yes">\n'
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">\n'
    '<meta name="apple-mobile-web-app-title" content="Simulateur">\n'
    '<link rel="icon" href="icon.svg" type="image/svg+xml">')
rep('<link rel="apple-touch-icon" href="icon-180.png">', '<link rel="apple-touch-icon" href="/prix-mobile/icon-180.png">')
rep('href="icon.svg"', 'href="/conso-estimation-r8m3/icon.svg"')
rep('href="icon-32.png"', 'href="/conso-estimation-r8m3/icon-32.png"')
rep('<a class="avis" href="avis/">', '<a class="avis" href="/conso-estimation-r8m3/avis/">')
s = re.sub(r'<meta name="viewport"[^>]*>', '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">', s, count=1)

# 2. Sans les outils TVA et HR helper (masqués : le script de la page les attend)
rep('<div class="tools">', '<div class="tools" hidden>')

# 3. Mise en page mobile
CSS = r'''
  /* ===== Version mobile (prix-mobile) : générée par tools/build_prix_mobile.py ===== */
  .tools{display:none !important}
  #offl{display:none;position:sticky;top:0;z-index:50;background:#fff3cd;color:#7a5a00;font-size:12.5px;text-align:center;padding:5px 10px;border-bottom:1px solid #efd98a}
  #offl.on{display:block}
  @media (max-width:820px){
  html,body{overflow-x:hidden}
  body{font-size:15px;-webkit-text-size-adjust:100%}
  input,select,textarea{font-size:16px !important}
  header{padding:calc(8px + env(safe-area-inset-top)) 14px 12px}
  header h1{font-size:17px;margin:0} header p{display:none}
  main{max-width:640px;padding:8px 8px calc(78px + env(safe-area-inset-bottom));gap:10px}
  .tools{display:none !important}
  .banner{font-size:12px;padding:5px 10px;border-radius:8px}
  .hub{grid-template-columns:1fr !important;position:static !important;gap:8px;padding:0}
  .hub .tool{padding:8px 10px} .hub .tool > strong{font-size:13.5px} .hub .hint{font-size:12px}
  .cpbox,.cpbox input,#cp{width:100%;box-sizing:border-box}
  .cptel{font-size:12.5px;overflow-wrap:anywhere}
  .cptel a{white-space:normal}
  /* Onglets : barre fixe en bas, comme une appli */
  .zbtns{position:fixed;left:0;right:0;bottom:0;z-index:40;display:flex !important;flex-direction:row !important;gap:0;
    background:#fff;border-top:1px solid var(--line);box-shadow:0 -2px 10px rgba(0,0,0,.06);padding:4px 4px calc(4px + env(safe-area-inset-bottom))}
  .zbtns .zbtn{flex:1 1 0 !important;min-width:0;border:0 !important;border-radius:10px;background:transparent;color:#5d6b64;
    font-size:10.5px !important;font-weight:650;line-height:1.1;padding:6px 2px !important;white-space:normal !important;text-align:center;display:flex;flex-direction:column;align-items:center;gap:2px}
  .zbtns .zbtn::before{font-size:19px;line-height:1}
  .zbtns .zbtn[data-zone=est]::before{content:"🏠"}
  .zbtns .zbtn[data-zone=prix]::before{content:"🧾"}
  .zbtns .zbtn[data-zone=reg]::before{content:"📅"}
  .zbtns .zbtn[data-zone=akw]::before{content:"💶"}
  .zbtns .zlink::before{content:"🔎"}
  .zbtns .zbtn.on,.zbtns .zbtn[aria-selected=true]{color:var(--accent);background:var(--accent-soft,#e5f2fa)}
  .zbtns .zlink small{display:none}
  .actions.bar{bottom:calc(58px + env(safe-area-inset-bottom)) !important}
  .step{padding:10px 8px;border-radius:12px}
  .cols,.grid2,.two{grid-template-columns:1fr !important}
  .card.result{position:static !important}
  footer{font-size:11.5px}
  }
'''
rep('</style>', CSS + '</style>')

# 4. Libellés d'onglets courts
rep('data-zone="prix" role="tab">Les détails de prix</button>', 'data-zone="prix" role="tab">Prix</button>')
rep('data-zone="reg" role="tab">La régularisation</button>', 'data-zone="reg" role="tab">Régul</button>')
rep('data-zone="akw" role="tab">Acompte → kWh</button>', 'data-zone="akw" role="tab">Acompte → kWh</button>')
rep('href="concurrence/">Concurrence →</a>', 'href="concurrence/">Concurrence</a>')

# 5. Statistiques de visite séparées, service worker de l'appli
rep('<script src="../visit.js" data-page="conso"></script>',
    '<script src="../visit.js" data-page="prix-mobile"></script>\n'
    '<script>if (\'serviceWorker\' in navigator) navigator.serviceWorker.register(\'/prix-mobile/sw.js\', {scope: \'/prix-mobile/\'}).catch(function(){});</script>')

# 6. Changement d'onglet : remonter en haut de la zone
rep('<header>', '<div id="offl" role="status"></div>\n<header>')
rep('</body>', '<script>(function(){ var o = document.getElementById("offl"); function st(){ var t = ""; try { t = localStorage.getItem("pmSync") || ""; } catch (e){} o.textContent = "Hors ligne : prix en mémoire" + (t ? " (mis à jour le " + t + ")" : "") + "."; o.classList.toggle("on", !navigator.onLine); } addEventListener("online", st); addEventListener("offline", st); st(); if (navigator.serviceWorker) navigator.serviceWorker.addEventListener("message", function(e){ if (e.data && e.data.sync){ try { localStorage.setItem("pmSync", e.data.sync); } catch (er){} st(); } }); })();</script>\n</body>')
rep('</body>', '<script>document.querySelectorAll(".zbtn[data-zone]").forEach(function(b){ b.addEventListener("click", function(){ window.scrollTo({top: 0, behavior: "smooth"}); }); });</script>\n</body>')

s = s.replace('<!DOCTYPE html>', '<!DOCTYPE html>\n<!-- Fichier généré par tools/build_prix_mobile.py à partir de conso-estimation-r8m3/index.html : ne pas modifier à la main. -->', 1)
DST.write_text(s, encoding='utf-8')
print('OK :', DST.relative_to(ROOT))

# Sous-pages (détails de prix, concurrence) copiées dans prix-mobile/ pour être disponibles hors ligne
HEAD = '<!DOCTYPE html>\n<!-- Fichier généré par tools/build_prix_mobile.py : ne pas modifier à la main. -->'
SW = "<script>if ('serviceWorker' in navigator) navigator.serviceWorker.register('/prix-mobile/sw.js', {scope: '/prix-mobile/'}).catch(function(){});</script>\n</body>"
for sub in ('prix', 'concurrence'):
    t = (ROOT / 'conso-estimation-r8m3' / sub / 'index.html').read_text(encoding='utf-8')
    t = t.replace('href="../icon.svg"', 'href="/conso-estimation-r8m3/icon.svg"').replace('href="../icon-32.png"', 'href="/conso-estimation-r8m3/icon-32.png"').replace('href="../icon-180.png"', 'href="/prix-mobile/icon-180.png"')
    t = t.replace("fetch('cartes.json'", "fetch('/conso-estimation-r8m3/concurrence/cartes.json'")
    t = t.replace('<!DOCTYPE html>', HEAD, 1).replace('</body>', SW, 1)
    if sub == 'concurrence':
        t = t.replace('</style>', '  @media (max-width:820px){main{padding:10px 8px 30px} .card{padding:12px 10px} .ctl{gap:6px 12px} header h1{font-size:18px} .ctl input[type=number]{width:72px}}\n</style>', 1)
    d = ROOT / 'prix-mobile' / sub; d.mkdir(exist_ok=True)
    (d / 'index.html').write_text(t, encoding='utf-8')
    print('OK :', (d / 'index.html').relative_to(ROOT))
