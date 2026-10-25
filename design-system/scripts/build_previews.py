#!/usr/bin/env python3
"""Build a local preview + test harness for the Gav-IL design system.

Compiles tokens.json into .preview/tokens.css (the same layout the Design System
artifact generates) and wraps every components/<Name>/preview.html into
.preview/p/<Name>-<theme>.html with tokens, React 18, bundle.css and bundle.js loaded.

Usage (from design-system/):
    python3 scripts/build_previews.py
    python3 -m http.server 8765
    open http://localhost:8765/.preview/            # every preview, both themes
    open http://localhost:8765/tests/               # automated mobile test suite
"""
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, ".preview")
# The first script records page errors (window.__gvErrors), so the test suite can fail a preview that throws while it loads.
HEAD = """<script>window.__gvErrors=[];addEventListener('error',function(e){__gvErrors.push(String(e.message||e.type))});addEventListener('unhandledrejection',function(e){__gvErrors.push('unhandled rejection: '+String(e.reason))});</script>
<meta name="theme-color" content="__WOOD__"><link rel="stylesheet" href="/.preview/tokens.css"><link rel="stylesheet" href="/components/bundle.css">
<script src="https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js" onerror="window.__gvNoQR=true"></script>
<script src="/components/bundle.js"></script>"""
# qrcode-generator draws placard QR codes (TablePlacard). If it fails to load, placards fall back to the big printed code.


def css_value(v):
    # A token may reference another token, whole ("{gold}") or inline ("0 3px 0 {wood-deep}").
    return re.sub(r"\{([a-z0-9-]+)\}", lambda m: "var(--%s)" % m.group(1), v)


def compile_tokens(t):
    themes = [x["id"] for x in t["color"]["themes"]]
    first = themes[0]
    blocks = []
    for th in themes:
        sel = ':root, [data-theme="%s"]' % th if th == first else '[data-theme="%s"]' % th
        decl = []
        for fam in ("color", "shadow", "asset"):
            for tok in t.get(fam, {}).get("tokens", []):
                v = tok["value"]
                # The asset family mixes themed art (a dict per theme) with plain art and numbers (emitted below, once).
                if fam == "asset" and not isinstance(v, dict):
                    continue
                if isinstance(v, str):
                    v = v if th == first else None
                elif th not in v:
                    # A themed token must name every theme; a silent fallback would paint night in sunset colors.
                    raise SystemExit("tokens.json: %s has no value for theme '%s'" % (tok["name"], th))
                else:
                    v = v[th]
                if v:
                    decl.append("--%s:%s;" % (tok["name"], css_value(v)))
        blocks.append(sel + "{" + "".join(decl) + "}")
    decl = []
    for fam in ("spacing", "radius", "size", "motion", "asset"):
        for tok in t.get(fam, {}).get("tokens", []):
            if isinstance(tok["value"], dict):
                continue
            decl.append("--%s:%s;" % (tok["name"], tok["value"]))
    for k, v in t["type"]["families"].items():
        decl.append("--font-%s:%s;" % (k, v))
    # Type styles: --type-<name> is a font shorthand, --tracking-<name> its letter-spacing.
    for g in t["type"].get("groups", []):
        for st in g["styles"]:
            fam = st.get("family", g["family"])
            decl.append("--type-%s:%s %s/%s var(--font-%s);" % (st["name"], st["fontWeight"], st["fontSize"], st["lineHeight"], fam))
            decl.append("--tracking-%s:%s;" % (st["name"], st.get("letterSpacing", "normal")))
    blocks.append(":root{" + "".join(decl) + "}")
    # Reduced motion lives in tokens: each motion token may carry a 'reduced' value.
    red = "".join("--%s:%s;" % (tok["name"], tok["reduced"]) for tok in t.get("motion", {}).get("tokens", []) if "reduced" in tok)
    if red:
        blocks.append("@media (prefers-reduced-motion: reduce){:root{" + red + "}}")
        blocks.append(':root[data-motion="reduce"]{' + red + "}")
    return "\n".join(blocks), themes


def token_value(t, name):
    for fam in ("color", "shadow"):
        for tok in t.get(fam, {}).get("tokens", []):
            if tok["name"] == name:
                v = tok["value"]
                return v if isinstance(v, str) else next(iter(v.values()))
    return None


def check_policy():
    # The AI-on consent script and team notice in the bundle are web/lib/talk/policy.ts's words: a drift fails the build.
    r = subprocess.run([sys.executable, os.path.join(ROOT, "scripts", "sync_policy.py"), "--check"], capture_output=True, text=True)
    print(r.stdout.strip() or r.stderr.strip())
    if r.returncode:
        raise SystemExit("build_previews: the bundle's consent copy drifted from web/lib/talk/policy.ts")


def check_docs():
    # Every component README, preview and index.d.ts is generate_component_docs.py's output (AGENTS.md rule 9): a hand edit fails the build.
    r = subprocess.run([sys.executable, os.path.join(ROOT, "scripts", "generate_component_docs.py"), "--check"], capture_output=True, text=True)
    print(r.stdout.strip() or r.stderr.strip())
    if r.returncode:
        raise SystemExit("build_previews: a README, preview or index.d.ts differs from the generator (edit scripts/generate_component_docs.py and rerun it)")


def main():
    check_policy()
    check_docs()
    tokens = json.load(open(os.path.join(ROOT, "tokens.json")))
    css, themes = compile_tokens(tokens)
    os.makedirs(os.path.join(OUT, "p"), exist_ok=True)
    open(os.path.join(OUT, "tokens.css"), "w").write(css)
    comps = sorted(d for d in os.listdir(os.path.join(ROOT, "components"))
                   if os.path.isfile(os.path.join(ROOT, "components", d, "preview.html")))
    for c in comps:
        src = open(os.path.join(ROOT, "components", c, "preview.html")).read()
        # Every page names its language (WCAG 3.1.1): keep a source's own lang, add "en" when it has none.
        src = re.sub(r"<html\b([^>]*)>", lambda m: "<html%s data-theme=\"__TH__\">" % (m.group(1) if "lang=" in m.group(1) else m.group(1) + ' lang="en"'), src, count=1)
        src = src.replace("<head>", "<head>" + HEAD.replace("__WOOD__", token_value(tokens, "wood")), 1)
        for th in themes:
            open(os.path.join(OUT, "p", "%s-%s.html" % (c, th)), "w").write(src.replace("__TH__", th))
    rows = "".join("<li>%s: %s</li>" % (c, " ".join('<a href="p/%s-%s.html">%s</a>' % (c, th, th) for th in themes)) for c in comps)
    open(os.path.join(OUT, "index.html"), "w").write("<!doctype html><meta charset=utf-8><title>Gav-IL previews</title><ul>%s</ul>" % rows)
    print("%d previews x %d themes -> %s" % (len(comps), len(themes), OUT))


if __name__ == "__main__":
    main()
