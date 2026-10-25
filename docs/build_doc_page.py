"""Render docs/design-doc.md as a styled, shareable HTML page (the published "Gav-IL Design Doc" artifact).

Usage: python3 docs/build_doc_page.py [out.html]   (default: docs/.build/design-doc.html)
Edit the Markdown, not the HTML. The look follows design-system/ (paper, wood, Ultra/Oswald/Manrope/Rye).
"""
import os, re, sys
import markdown

HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, "design-doc.md")).read()
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, ".build", "design-doc.html")

# Title + byline come from the first lines; the rest is the body.
lines = src.split("\n")
title = lines[0].lstrip("# ").strip()
byline = markdown.markdown(lines[2].strip())[3:-4]
body_md = "\n".join(lines[3:])
html = markdown.markdown(body_md, extensions=["tables", "fenced_code", "sane_lists"])

# Section ids + table of contents from h2s
toc = []
def h2(m):
    text = re.sub("<[^>]+>", "", m.group(1))
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    slug = re.sub(r"^\d+-", "", slug) or "summary"
    toc.append((slug, text))
    return '<h2 id="%s">%s</h2>' % (slug, m.group(1))
html = re.sub(r"<h2>(.*?)</h2>", h2, html)
html = html.replace("<table>", '<div class="tbl"><table>').replace("</table>", "</table></div>")
html = html.replace("<hr />", "")
html = re.sub(r'(https://claude\.ai/artifact/\w+)', r'<a href="\1">\1</a>', html)
toc_html = "".join('<li><a href="#%s">%s</a></li>' % (s, re.sub(r"^\d+\.\s*", "", t)) for s, t in toc)

PAGE = """<meta charset="utf-8"><title>Gav-IL Design Doc</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700&family=Oswald:wght@400;500&family=Rye&family=Ultra&display=swap">
<style>
/* Layout: one reading column of poster paper on a sunset ground, a saloon-plank masthead, a sticky contents rail on wide screens. */
:root{--ground:#513379;--paper:#fbf4e4;--paper-2:#f1e4c8;--ink:#3d2854;--ink-soft:#5a4d68;--rule:#80705e;--wood:#6a3f22;--wood-deep:#4a2a16;--on-wood:#fbefd4;--gold:#edae33;--accent:#a84a26;
  --f-display:Ultra,Georgia,serif;--f-sign:Rye,Ultra,Georgia,serif;--f-label:Oswald,"Arial Narrow",sans-serif;--f-body:Manrope,system-ui,sans-serif}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--ground:#272b6e;--paper:#1f1a2b;--paper-2:#2a2338;--ink:#f3ead6;--ink-soft:#cfc3b0;--rule:#8e7f6c;--accent:#f2bd4f;color-scheme:dark}}
:root[data-theme="dark"]{--ground:#272b6e;--paper:#1f1a2b;--paper-2:#2a2338;--ink:#f3ead6;--ink-soft:#cfc3b0;--rule:#8e7f6c;--accent:#f2bd4f;color-scheme:dark}
body{background:var(--ground);color:var(--ink);font:400 16px/1.65 var(--f-body);-webkit-font-smoothing:antialiased;padding-inline:16px;padding-block:0 48px}
.mast{margin-inline:-16px;padding:22px 16px 18px;background:repeating-linear-gradient(177deg,transparent 0 7px,rgba(0,0,0,.12) 7px 8px,transparent 8px 19px),linear-gradient(var(--wood),var(--wood-deep));color:var(--on-wood);box-shadow:0 3px 0 #2e190c;text-align:center}
.mast__k{font:500 12px/16px var(--f-label);letter-spacing:.2em;text-transform:uppercase;color:var(--gold)}
.mast h1{font:400 clamp(30px,6vw,48px)/1.1 var(--f-display);margin:6px 0 4px;text-shadow:0 3px 0 var(--wood-deep);text-wrap:balance}
.mast p{margin:0;font:400 14px/20px var(--f-body);opacity:.85}
.sky{height:6px;margin-inline:-16px;background:linear-gradient(90deg,#673e5b 0 25%,#d96a42 25% 50%,#f7952d 50% 75%,#edae33 75%)}
.wrap{max-width:1120px;margin:28px auto 0;display:grid;grid-template-columns:220px minmax(0,1fr);gap:28px;align-items:start}
nav{position:sticky;top:16px;font:500 14px/20px var(--f-label);letter-spacing:.04em}
nav b{display:block;font:400 15px/20px var(--f-sign);color:var(--gold);margin-bottom:8px;letter-spacing:.06em}
nav ol{margin:0;padding:0 0 0 18px;color:#f3ead6}
nav a{color:#f3ead6;text-decoration:none;display:block;padding:3px 0}
nav a:hover,nav a:focus-visible{color:var(--gold);outline:none;text-decoration:underline}
article{background:var(--paper);border-radius:6px;padding:clamp(20px,4vw,48px);box-shadow:inset 0 0 0 1px rgba(128,112,94,.35),inset 0 0 0 6px var(--paper),inset 0 0 0 7px rgba(128,112,94,.35),0 5px 0 #2a1c3a;min-width:0}
article>p:first-child{margin-top:0}
h2{font:400 26px/1.25 var(--f-display);margin:44px 0 12px;text-wrap:balance;display:flex;align-items:center;gap:12px}
h2::after{content:"";flex:1;height:6px;border-radius:9px;background:repeating-linear-gradient(115deg,#c49a5c 0 5px,#8a6a42 5px 8px);opacity:.75}
h2:first-of-type{margin-top:0}
h3{font:500 18px/1.3 var(--f-label);letter-spacing:.04em;text-transform:uppercase;margin:24px 0 8px}
p,li{max-width:72ch} p{margin:10px 0} ul,ol{padding-left:22px} li{margin:4px 0}
strong{font-weight:700;color:var(--ink)}
a{color:var(--accent);font-weight:600}
code{font:500 .9em/1 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--paper-2);padding:1px 5px;border-radius:3px}
pre{background:var(--wood-deep);color:var(--on-wood);padding:16px;border-radius:6px;overflow-x:auto;font:500 13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
pre code{background:none;padding:0;color:inherit}
.tbl{overflow-x:auto;margin:14px 0;border-radius:4px;box-shadow:inset 0 0 0 1px rgba(128,112,94,.45)}
table{border-collapse:collapse;width:100%;font-size:14.5px;line-height:1.5}
th{text-align:left;font:500 12px/16px var(--f-label);letter-spacing:.14em;text-transform:uppercase;color:var(--ink-soft);background:var(--paper-2);padding:10px 12px}
td{padding:10px 12px;vertical-align:top;border-top:1px solid rgba(128,112,94,.3)}
td:first-child{font-weight:600;min-width:110px}
.foot{max-width:1120px;margin:20px auto 0;text-align:center;color:#f3ead6;font:500 13px/20px var(--f-label);letter-spacing:.08em}
@media (max-width:860px){.wrap{grid-template-columns:1fr}nav{position:static;background:rgba(0,0,0,.18);padding:12px 14px;border-radius:6px}nav ol{columns:2;column-gap:16px}}
@media (max-width:480px){nav ol{columns:1}td:first-child{min-width:90px}}
</style>
<header class="mast"><div class="mast__k">HackIllinois 2027 · Judging platform</div><h1>{{title}}</h1><p>{{byline}}</p></header>
<div class="sky" aria-hidden="true"></div>
<div class="wrap">
<nav aria-label="Contents"><b>Contents</b><ol start="0">{{toc}}</ol></nav>
<article>{{body}}</article>
</div>
<p class="foot">Source: docs/design-doc.md in the Gav-IL repo · Edit there, then rebuild this page.</p>
"""
os.makedirs(os.path.dirname(out), exist_ok=True)
page = PAGE
for k, v in {"title": title.replace("Gav-IL: ", "Gav-IL "), "byline": byline, "toc": toc_html, "body": html}.items():
    page = page.replace("{{%s}}" % k, v)
open(out, "w").write(page)
print(out)
