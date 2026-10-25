#!/usr/bin/env bun
// make_spec_sheet.mjs: generates design/gavil-spec.fig, the Gav-IL OpenPencil spec sheet, from the design system.
//
//   cd design-system && ~/.bun/bin/bun scripts/make_spec_sheet.mjs                 # design/gavil-spec.fig + design/png/NN-<page>.png (about a minute)
//   ~/.bun/bin/bun scripts/make_spec_sheet.mjs --only=buttons,placard              # a subset of pages -> design/gavil-spec.partial.fig + their PNGs
//   ~/.bun/bin/bun scripts/make_spec_sheet.mjs --no-png                            # skip the PNG export (the .fig is still written)
//   ~/.bun/bin/bun scripts/make_spec_sheet.mjs --check                             # audit only: contrast pairs, component gaps, copy drift; nothing written; exit 1 on any failure
//   ~/.bun/bin/bun scripts/make_spec_sheet.mjs --strict                            # a full run that also exits 1 on contrast failures or copy drift (it still writes the files)
//   ~/.bun/bin/bun scripts/make_spec_sheet.mjs --check --copy                      # also list the specimen strings that are not found in the sources (specimen data, or copy to wrap in S())
//   pages: foundations, buttons, inputs, judge, talk, placard, screens
//   exit codes: 0 ok · 1 audit failed (--check / --strict) or the run was aborted · 2 bad arguments · 3 --check / --strict found only component gaps in components/bundle.css (the sheet itself is clean).
//   An aborted run (a font that will not load, a text layer that cannot be shaped) leaves the sheet alone: the existing
//   design/gavil-spec.fig and design/png/*.png stay exactly as they were (only the cached brand crops in design/brand-raster/ may be rewritten). Fonts are cached in ~/.cache/gavil-spec-fonts
//   (SPEC_FONT_CACHE to move it), so only the first run needs the network.
//
// Audits (printed at the end; --check runs the first four without building the sheet, --strict makes any of them an exit code):
//   contrast pairs · copy drift (S()) · every state bundle.js documents for TableCheck and TableTalk has a specimen · a brand file the sheet places is in assets/brand/
//   and, in a full run only (it needs real text heights): the placard fits its 7.5 x 9.9 in box.
// What it reads, at run time (nothing is copied by hand, so a rerun refreshes the sheet after the components change):
//   tokens.json                colors per theme, type styles, spacing, cuts, shadows, motion      -> Foundations, every swatch, size and shadow
//   components/bundle.css      button variants, control heights, paddings, cuts, the wood plank's focus band (colour, width, its three polygons) -> sizes and fills of the specimens, the wood focus rings, the contrast audit
//   components/bundle.js       icon paths, consent script and notice, demo/recall labels, copy     -> labels, and the "copy drift" check (S())
//   components/JudgePrototype  button labels of the screens ("I'm at the table", "Submit evaluation")
//   assets/brand/*, MANIFEST   real 2027 exports (lockup, longhorn, characters, planks, garlands)  -> placed where the spec shows them
// It drives @open-pencil/core under bun (no desktop app, no MCP server): new SceneGraph + FigmaAPI, builds nodes with the same
// property mapping as the JSX renderer, binds every color to a variable, exports the PNGs, then saves the .fig (export first:
// the export is what loads the fonts and re-measures text). Needs network for Google Fonts on first use. Characters are
// rasterized once with Playwright (demo/node_modules) into design/brand-raster/; without it their tiles are placeholders.
// See design/README.md for the recipe, the lint/analyze summary and what is deliberately not solved.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

if (typeof Bun === 'undefined') { console.error('Run this with bun: ~/.bun/bin/bun scripts/make_spec_sheet.mjs'); process.exit(2); }

const HOME = process.env.HOME;
const NODE_MODULES = process.env.OPENPENCIL_NODE_MODULES ?? `${HOME}/.bun/install/global/node_modules`;
const CORE = `${NODE_MODULES}/@open-pencil/core/dist`;
const DS = path.resolve(import.meta.dir, '..');                 // design-system/
const OUT = process.env.SPEC_OUT ?? path.join(DS, 'design');
const BRAND = path.join(DS, 'assets', 'brand');
const KNOWN_FLAGS = new Set(['only', 'no-png', 'check', 'strict', 'copy']);
const PAGE_KEYS = ['foundations', 'buttons', 'inputs', 'judge', 'talk', 'placard', 'screens'];   // keep in step with PAGE_DEFS below (checked at startup)
const ARGS = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const usageExit = (msg) => { console.error(`make_spec_sheet: ${msg}\nusage: bun scripts/make_spec_sheet.mjs [--only=${PAGE_KEYS.join(',')}] [--no-png] [--check] [--strict] [--copy]`); process.exit(2); };
for (const k of Object.keys(ARGS)) if (!KNOWN_FLAGS.has(k)) usageExit(`unknown argument "${k}"`);
if (ARGS.only !== undefined) {
  if (ARGS.only === true || !String(ARGS.only).trim()) usageExit('--only needs page names, e.g. --only=buttons,placard');
  const bad = String(ARGS.only).split(',').map((x) => x.trim()).filter((x) => !PAGE_KEYS.includes(x));
  if (bad.length) usageExit(`--only: unknown page ${bad.map((b) => `"${b}"`).join(', ')}`);
}
const ONLY = ARGS.only ? String(ARGS.only).split(',').map((x) => x.trim()) : null;
const NO_PNG = !!ARGS['no-png'];
const STRICT = !!ARGS.strict || !!ARGS.check;
const T0 = Date.now();
const log = (...a) => console.log(`[spec ${((Date.now() - T0) / 1000).toFixed(1)}s]`, ...a);
const WARN = [];                                                  // collected for the end-of-run report and README
const warn = (m) => { if (!WARN.includes(m)) { WARN.push(m); console.warn('  warn:', m); } };
// A run that cannot produce a faithful sheet stops before anything is written (see the exit codes in the header).
class Abort extends Error {}
const abort = (m) => { throw new Abort(m); };

// ------------------------------------------------------------------------------------------------------ inputs
const read = (...p) => fs.readFileSync(path.join(DS, ...p), 'utf8');
const tokens = JSON.parse(read('tokens.json'));
const CSS_SRC = read('components', 'bundle.css');
const JS_SRC = read('components', 'bundle.js');
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 8);
const SOURCES = `tokens v${tokens.version} ${sha(JSON.stringify(tokens))} · bundle.css ${sha(CSS_SRC)} · bundle.js ${sha(JS_SRC)}`;
const THEMES = tokens.color.themes.map((t) => t.id);              // ['sunset', 'night']
const THEME_NAME = Object.fromEntries(tokens.color.themes.map((t) => [t.id, t.name]));

// ------------------------------------------------------------------------------------------------------ tokens
const COLORS = new Map(tokens.color.tokens.map((t) => [t.name, t]));
const MISSING = new Set();
const cstr = (name, theme) => {
  const d = COLORS.get(name);
  if (!d) { if (!MISSING.has(name)) { MISSING.add(name); warn(`tokens.json has no color "${name}" any more: drawn magenta; update make_spec_sheet.mjs`); } return '#ff00ff'; }
  return typeof d.value === 'string' ? d.value : d.value[theme];
};
const pxNum = (v) => { const m = /^(-?[\d.]+)(px|in)?$/.exec(String(v).trim()); return m ? parseFloat(m[1]) * (m[2] === 'in' ? 96 : 1) : null; };
const NUM = {};                                                    // spacing, radius, size tokens as px numbers (the names CSS uses in var(--x))
for (const g of ['spacing', 'radius', 'size', 'asset']) for (const t of tokens[g].tokens) { if (typeof t.value === 'object') continue; const n = pxNum(t.value); if (n != null) NUM[t.name] = n; }   // asset: the plank numbers (plank-cap-flat 68, plank-cap-arrow 96, plank-art-h 192, ...)
const MOTION = Object.fromEntries(tokens.motion.tokens.map((t) => [t.name, t]));
const tokenUsage = (t) => String(t.usage || '').replace(/\s+/g, ' ');
// usage notes can run long: the first full sentence if it fits, else cut at a word
const firstSentence = (s, max = 110) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); const m = /^(.+?[.])(\s|$)/.exec(t); let o = m && m[1].length <= max ? m[1] : t; if (o.length > max) o = o.slice(0, max).replace(/\s+\S*$/, '').replace(/[\s,;:(]+$/, '') + '…'; return o; };

// Fonts by family key; the first name of each stack is the real face (Google Fonts, loaded on demand by OpenPencil).
const FAMILY = Object.fromEntries(Object.entries(tokens.type.families).map(([k, v]) => [k, v.split(',')[0].trim().replace(/"/g, '')]));
const TYPE = {};
for (const g of tokens.type.groups) for (const s of g.styles) {
  const size = pxNum(s.fontSize), em = s.letterSpacing ? parseFloat(s.letterSpacing) : 0;
  TYPE[s.name] = { name: s.name, group: g.name, familyKey: g.family, family: FAMILY[g.family], size, line: pxNum(s.lineHeight), weight: s.fontWeight, ls: +(em * size).toFixed(3), em, sample: s.sample, usage: tokenUsage(s) };
}

// Shadows: "0 4px 0 #2a1c3a, inset 0 0 0 1px {line}" -> layers. {refs} resolve per theme.
function splitTop(s, sep = ',') { const out = []; let d = 0, cur = ''; for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (ch === sep && d === 0) { out.push(cur.trim()); cur = ''; } else cur += ch; } if (cur.trim()) out.push(cur.trim()); return out; }
function shadowLayers(name, theme) {
  const def = tokens.shadow.tokens.find((t) => t.name === name); if (!def) { warn(`tokens.json has no shadow "${name}" any more`); return []; }
  let v = typeof def.value === 'string' ? def.value : def.value[theme];
  v = v.replace(/\{([\w-]+)\}/g, (_, n) => (COLORS.has(n) ? cstr(n, theme) : NUM[n] != null ? NUM[n] + 'px' : n));
  return splitTop(v).map((layer) => {
    const inset = /^inset\s/.test(layer); const l = layer.replace(/^inset\s+/, '');
    const m = /^((?:-?[\d.]+(?:px)?\s+){2,4})(.+)$/.exec(l);
    const nums = m[1].trim().split(/\s+/).map(pxNum);
    return { inset, x: nums[0], y: nums[1], blur: nums[2] ?? 0, spread: nums[3] ?? 0, color: m[2].trim() };
  });
}

// ------------------------------------------------------------------------------------------------------ bundle.css
// A small depth-aware CSS reader: enough to ask "what does .gv-btn--primary set?" and evaluate calc(var(--tap-min) + var(--space-2)).
function parseCss(src) {
  src = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import[^;]*;/g, '');
  const rules = [];
  (function walk(s, ctx) {
    let i = 0;
    while (i < s.length) {
      const open = s.indexOf('{', i); if (open < 0) break;
      const head = s.slice(i, open).trim(); let d = 1, j = open + 1;
      while (j < s.length && d > 0) { if (s[j] === '{') d++; else if (s[j] === '}') d--; j++; }
      const body = s.slice(open + 1, j - 1);
      if (head.startsWith('@')) { if (/^@(media|supports)/.test(head)) walk(body, head); }
      else rules.push({ sel: splitTop(head), decl: Object.fromEntries(splitTop(body, ';').map((x) => { const k = x.indexOf(':'); return k < 0 ? null : [x.slice(0, k).trim(), x.slice(k + 1).trim()]; }).filter(Boolean)), ctx });
      i = j;
    }
  })(src, null);
  return rules;
}
const CSS = parseCss(CSS_SRC);
const cssDecl = (sel) => Object.assign({}, ...CSS.filter((r) => !r.ctx && r.sel.includes(sel)).map((r) => r.decl));
// The declarations a selector gets inside @media (max-width:600px) (the phone rules: 16px text, 48px targets).
const cssPhone = (sel) => Object.assign({}, ...CSS.filter((r) => r.ctx && /max-width:\s*600px/.test(r.ctx) && r.sel.includes(sel)).map((r) => r.decl));
function evalLen(expr, vars = {}) {
  if (expr == null) return null;
  let s = String(expr).trim();
  s = s.replace(/var\(--([\w-]+)(?:,[^)]*)?\)/g, (_, n) => { const v = vars[n] ?? NUM[n]; return v == null ? 'NaN' : String(v); });
  s = s.replace(/calc/g, '').replace(/(-?[\d.]+)px/g, '$1');
  if (!/^[\d\s+\-*/().]+$/.test(s)) return null;
  try { const v = Function(`"use strict";return (${s})`)(); return Number.isFinite(v) ? v : null; } catch { return null; }
}
// css(sel, prop, fallback): the px value CSS gives, else the fallback (and a warning, so a renamed class is noticed).
function css(sel, prop, fallback, vars) {
  const d = cssDecl(sel); const v = evalLen(d[prop], { ...Object.fromEntries(Object.entries(d).filter(([k]) => k.startsWith('--')).map(([k, x]) => [k.slice(2), evalLen(x, vars)])), ...vars });
  if (v == null) { warn(`bundle.css: ${sel} { ${prop} } not readable, using ${fallback}`); return fallback; }
  return v;
}
// "var(--gold)" -> "gold"; "linear-gradient(var(--select-tint),var(--select-tint)),var(--surface)" -> {tok:'select-tint', over:'surface'}
function cssColor(v) {
  if (!v) return null; const vars = [...String(v).matchAll(/var\(--([\w-]+)\)/g)].map((m) => m[1]).filter((n) => COLORS.has(n));
  if (!vars.length) return null;
  if (/linear-gradient/.test(v) && vars.length >= 2) return { tok: vars[0], over: vars[vars.length - 1] };
  return vars[0];
}

// ------------------------------------------------------------------------------------------------------ bundle.js
// Strings the specimens show. Two ways in: extract (icon paths, consent copy, labels) and S(): a literal that is checked against
// the bundle, so when the components are reworded the sheet says "copy drift" instead of silently showing old words.
const norm = (s) => String(s).replace(/\\(['"])/g, '$1').replace(/[‘’]/g, "'").replace(/ /g, ' ').replace(/\s+/g, ' ');
const PROTO_SRC = ['JudgePrototype', 'AdminConsole'].map((n) => { try { return read('components', n, 'preview.html'); } catch { return ''; } }).join('\n');   // the judge screens' button labels live in JudgePrototype, the admin confirms and switches in AdminConsole
const JS_NORM = norm(JS_SRC + PROTO_SRC);
const DRIFT = new Set(), S_CALLS = new Set();
const S = (str) => { S_CALLS.add(str); if (!JS_NORM.includes(norm(str))) DRIFT.add(str); return str; };
function extractIcons() {
  const m = /var PATHS = \{([\s\S]*?)\n  \};/.exec(JS_SRC); const out = {}; if (!m) { warn('bundle.js: PATHS block not found; icons will be blank'); return out; }
  for (const x of m[1].matchAll(/(?:'([\w-]+)'|\b([\w]+)):\s*'([^']*)'/g)) out[x[1] || x[2]] = x[3];
  return out;
}
const ICONS = extractIcons();
// A JS string literal -> its value ("..." or '...' with the usual escapes).
const jsLiteral = (lit) => { try { return lit[0] === '"' ? JSON.parse(lit) : JSON.parse('"' + lit.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"') + '"'); } catch { return null; } };
// The words of the consent sheet and the placard notice. bundle.js keeps them in `var COPY = { on: {...}, off: {...} }`, where a field is either a string
// literal or the name of a `var NAME = "..."` above it (the AI-on words are POLICY_SCRIPT and POLICY_NOTICE, copied from web/lib/talk/policy.ts).
function extractCopy() {
  const out = { on: {}, off: {}, retention: null };
  const strVar = (name) => { const m = new RegExp(`var ${name}\\s*=\\s*("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')\\s*;`).exec(JS_SRC); return m ? jsLiteral(m[1]) : null; };
  const field = (b, key) => { const m = new RegExp(`${key}:\\s*("(?:[^"\\\\]|\\\\.)*"|[A-Z_][A-Z0-9_]*)`).exec(b); if (!m) return null; return /^[A-Z_]/.test(m[1]) ? strVar(m[1]) : jsLiteral(m[1]); };
  const blk = /var COPY = \{([\s\S]*?)\n    \};/.exec(JS_SRC)?.[1] ?? '';
  const parts = blk.split(/\n\s*off:\s*\{/); const key = ['on', 'off'];
  parts.forEach((b, i) => { out[key[i]] = { script: field(b, 'script'), notice: field(b, 'notice'), sends: [...b.matchAll(/\['(Cloudflare|Anthropic)',\s*'([^']*)'\]/g)].map((m) => [m[1], m[2]]) }; });
  out.retention = strVar('RETENTION');   // the line the placard and the consent sheet print under the notice (absent in older bundles)
  for (const k of key) for (const f of ['script', 'notice']) if (!out[k][f]) warn(`bundle.js: the consent ${f} (AI summaries ${k}) was not found in COPY: the specimen shows a marker instead of the words`);
  return out;
}
const COPY = extractCopy();
function pairs(name) { const m = new RegExp(`var ${name} = \\[(\\[[\\s\\S]*?\\])\\];`).exec(JS_SRC); return m ? [...m[1].matchAll(/\['([\w]+)',\s*'([^']*)'(?:,\s*'([^']*)')?\]/g)].map((x) => [x[1], x[2], x[3]]) : null; }
const DEMO_OPTS = (pairs('DEMO') || [['ran_live', 'Ran live'], ['partly_ran', 'Partly ran'], ['not_shown', 'Not shown live'], ['did_not_run', 'Didn’t run']]).map((x) => [x[0], x[1].replace(/\\u2019/g, '’')]);
const RECALL_ROWS = pairs('RECALL') || [['does', 'Does'], ['demo', 'Demo'], ['standout', 'Notable'], ['open', 'Open']];
const SKIP_REASONS = (() => { const m = /var ALL_SKIP_REASONS = \[([\s\S]*?)\];/.exec(JS_SRC); return m ? [...m[1].matchAll(/\['(\w[\w-]*)',\s*'([^']*)',\s*'([^']*)'\]/g)].map((x) => [x[1], x[2], x[3]]) : []; })();
// The state lists the components document above TableCheck and TableTalk ("state: idle | scanning | ..."; a list may continue on the next
// comment line after a trailing "|"). The Judge and Table talk pages are checked against them: a state with no specimen is reported
// (checkStateCoverage), so a component that gains a state cannot slip past the sheet unnoticed.
function docStates(fn) {
  const at = JS_SRC.indexOf(`function ${fn}(`); if (at < 0) return [];
  const lines = JS_SRC.slice(Math.max(0, at - 9000), at).split('\n'); let found = null;
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*\/\/\s+state:\s+(idle\b.*)$/.exec(lines[i]); if (!m) continue;
    let txt = m[1].trim(); for (let j = i + 1; /\|\s*$/.test(txt) && j < lines.length; j++) txt += ' ' + lines[j].replace(/^\s*\/\/\s*/, '').trim();
    found = txt;   // the last one before the function is the component's own
  }
  return found ? found.split('|').map((x) => x.trim()).filter(Boolean) : [];
}
const TC_STATES = docStates('TableCheck'), TT_STATES = docStates('TableTalk');
// Which component state each specimen on the sheet shows (several specimens can show one state: a wrong check and a look-alike hint are both needs-check).
const TC_SHOWS = { idle: 'idle', scanning: 'scanning', checking: 'checking', matched: 'matched', 'matched-code': 'matched', mismatch: 'mismatch', 'mismatch-none': 'mismatch', 'mismatch-offline': 'mismatch', 'not-found': 'not-found', 'needs-check': 'needs-check', 'wrong-check': 'needs-check', 'look-alike': 'needs-check', offline: 'offline', name: 'name', 'name-ask': 'name', 'name-open': 'idle', locked: 'locked', 'no-camera': 'no-camera', failed: 'failed' };
const DRAWN = { TableCheck: new Set(), TableTalk: new Set() };   // filled by the specimen builders, compared with the lists above after the pages are built

// ------------------------------------------------------------------------------------------------------ color math
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
const contrast = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
const bright = (c, k) => ({ r: clamp01(c.r * k), g: clamp01(c.g * k), b: clamp01(c.b * k), a: c.a });
const fmtRatio = (r) => `${r.toFixed(1)}:1`;

// ------------------------------------------------------------------------------------------------------ OpenPencil core
const { SceneGraph } = await import(`${CORE}/scene-graph/index.js`);
const { FigmaAPI } = await import(`${CORE}/figma-api/index.js`);
const { ALL_TOOLS } = await import(`${CORE}/tools/index.js`);
const { IORegistry, BUILTIN_IO_FORMATS } = await import(`${CORE}/io/index.js`);
const { propsToOverrides } = await import(`${CORE}/design-jsx/props-overrides.js`);
const { parseColor, colorToFill } = await import(`${CORE}/color/index.js`);
const { parseSVGPath } = await import(`${CORE}/io/formats/svg/parse-path.js`);
const { computeAllLayouts } = await import(`${CORE}/layout.js`);
const { extractPaths } = await import(`${CORE}/icons/svg.js`);
const { buildParagraph } = await import(`${CORE}/canvas/text.js`);
const { fontManager } = await import(`${CORE}/text/fonts.js`);
const { initCanvasKit } = await import(`${CORE}/io/formats/raster/headless.js`);
const { getGlyphOutlineMetricsSync } = await import(`${CORE}/text/opentype.js`);
const { weightToStyle } = await import(`${CORE}/text/fonts.js`);
const { encodePathCommandsBlob } = await import(`${CORE}/kiwi/fig/node-change/path-commands.js`);
// OpenPencil 0.13.2: once Oswald or Inter are loaded, .fig save calls opentype.js stringToGlyphs, which throws
// "lookupType: 6 - substFormat: 2 is not yet supported" on their GSUB table. Fall back to a plain cmap lookup for those strings.
const opentype = (await import(`${NODE_MODULES}/opentype.js/dist/opentype.js`)).default;
const _s2g = opentype.Font.prototype.stringToGlyphs;
opentype.Font.prototype.stringToGlyphs = function (s, o) { try { return _s2g.call(this, s, o); } catch { return Array.from(s).map((ch) => this.charToGlyph(ch)); } };

// Fonts come from Google Fonts on first use and are cached on disk, so a rerun on a bad network still has them (and a run
// that cannot get a font stops instead of writing a sheet without text: see warmFonts and the checks before the writes).
const FONT_CACHE = process.env.SPEC_FONT_CACHE ?? path.join(HOME, '.cache', 'gavil-spec-fonts');
const fontFile = (family, style) => path.join(FONT_CACHE, `${family}-${style}`.replace(/[^\w.-]+/g, '_') + '.font');
fontManager.setDownloadedFontCache({
  read: async (family, style) => { const f = fontFile(family, style); if (!fs.existsSync(f)) return null; const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); },
  write: async (family, style, data) => { fs.mkdirSync(FONT_CACHE, { recursive: true }); fs.writeFileSync(fontFile(family, style), Buffer.from(data)); },
});

const graph = new SceneGraph();
const figma = new FigmaAPI(graph);
const io = new IORegistry(BUILTIN_IO_FORMATS);
const tool = (name, args) => ALL_TOOLS.find((t) => t.name === name).execute(figma, args);
const parse = (s) => parseColor(s);
const solid = (c) => colorToFill(c);

// ------------------------------------------------------------------------------------------------------ variables
// Two color collections, one per theme (OpenPencil has no per-frame variable modes, and the sheet shows both themes side
// by side, so each theme's stages bind to their own collection). One numbers collection holds the type sizes and families.
const COLLECTIONS = {};
function colorCollection(theme) {
  if (COLLECTIONS[theme]) return COLLECTIONS[theme];
  const coll = graph.createCollection(`Gav-IL color · ${THEME_NAME[theme]}`);
  graph.renameMode(coll.id, coll.defaultModeId, THEME_NAME[theme]);
  const byKey = new Map();
  for (const t of tokens.color.tokens) {
    const v = graph.createVariable(`color/${t.name}`, 'COLOR', coll.id, parse(cstr(t.name, theme)));
    v.description = tokenUsage(t); byKey.set(t.name, v.id);
  }
  return (COLLECTIONS[theme] = { coll, byKey });
}
// A color the sheet needs that is not a token by itself: a tint composited over paper, a pressed fill (brightness .94).
function colorInfo(ref, theme) {
  if (typeof ref === 'string') return { key: ref, c: parse(cstr(ref, theme)), derived: false };
  if (ref.raw) return { key: null, c: parse(ref.raw), derived: false };
  const base = colorInfo(ref.tok, theme); let c = base.c, key = base.key;
  if (ref.over) { const bg = colorInfo(ref.over, theme); c = over(c, bg.c); key = `${key} on ${bg.key}`; }
  if (ref.bright) { c = bright(c, ref.bright); key = `${key} x${ref.bright}`; }
  if (ref.alpha != null) { c = { ...c, a: ref.alpha }; key = `${key} @${ref.alpha}`; }
  return { key, c, derived: key !== ref.tok };
}
function colorVarId(theme, info) {
  if (!info.key) return null;
  const cc = colorCollection(theme);
  if (cc.byKey.has(info.key)) return cc.byKey.get(info.key);
  const v = graph.createVariable(`derived/${info.key}`, 'COLOR', cc.coll.id, info.c);
  v.description = 'Composited from tokens (tints sit over paper; pressed = brightness filter).'; cc.byKey.set(info.key, v.id); return v.id;
}
let NUMS = null;
function numbers() {
  if (NUMS) return NUMS;
  const coll = graph.createCollection('Gav-IL numbers'); graph.renameMode(coll.id, coll.defaultModeId, 'Default');
  const by = new Map();
  for (const g of ['spacing', 'radius', 'size']) for (const t of tokens[g].tokens) { const n = pxNum(t.value); if (n == null) continue; const v = graph.createVariable(`${g}/${t.name}`, 'FLOAT', coll.id, n); v.description = tokenUsage(t); by.set(`${g}/${t.name}`, v.id); }
  for (const s of Object.values(TYPE)) { const v = graph.createVariable(`type/${s.name}/font-size`, 'FLOAT', coll.id, s.size); v.description = s.usage; by.set(`size:${s.name}`, v.id); }
  for (const [k, fam] of Object.entries(FAMILY)) { const v = graph.createVariable(`type/font-family/${k}`, 'STRING', coll.id, fam); by.set(`family:${k}`, v.id); }
  return (NUMS = { coll, by });
}

// ------------------------------------------------------------------------------------------------------ images, icons, shapes
const IMAGES = new Map();
function imageFill(file, mode = 'FILL') {
  if (!IMAGES.has(file) && file.startsWith('derived/')) { brandMissing(file); return null; }   // loaded by loadDerived(); a file that did not decode is already a warning
  if (!IMAGES.has(file)) {
    const fp = file.startsWith('@raster/') ? path.join(OUT, 'brand-raster', file.slice(8)) : path.join(BRAND, file); if (!fs.existsSync(fp)) { brandMissing(file); return null; }
    IMAGES.set(file, figma.createImage(new Uint8Array(fs.readFileSync(fp))).hash);
  }
  return { type: 'IMAGE', color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true, imageHash: IMAGES.get(file), imageScaleMode: mode };
}
// A brand file the sheet places by name that is not in assets/brand/ is never silent: it is a warning, which --check and --strict count as a problem,
// and the sheet shows a labelled placeholder (a typeset stand-in for the logo would break AGENTS.md rule 2). Wood planks fall back to the flat wood token fill.
const PLACEHOLDER_NOTE = 'the sheet draws a labelled placeholder in its place', WOOD_NOTE = 'wood surfaces and buttons fall back to the flat wood fill';
const brandMissing = (f, note = PLACEHOLDER_NOTE) => warn(`assets/brand/${f} is missing: ${note}`);
const hasBrand = (f, note) => { const ok = fs.existsSync(path.join(BRAND, f)); if (!ok) brandMissing(f, note); return ok; };
// Brand SVGs too heavy for vector import (the characters have hundreds of paths, gradients and strokes): rasterized once by Chromium
// (Playwright from demo/node_modules) to design/brand-raster/, then placed as images. Without Chromium the tile is a labelled placeholder.
function rasterOf(file, px = 640) {
  const src = path.join(BRAND, file), outDir = path.join(OUT, 'brand-raster'), out = path.join(outDir, file.replace(/\.svg$/, '.png'));
  if (!fs.existsSync(src)) { brandMissing(file, 'its tile is a labelled placeholder'); return null; }
  if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(src).mtimeMs) return '@raster/' + path.basename(out);
  fs.mkdirSync(outDir, { recursive: true });
  const pw = path.join(DS, '..', 'demo', 'node_modules', 'playwright', 'index.mjs');
  if (!fs.existsSync(pw)) { warn('Playwright not found in demo/node_modules: character art stays a placeholder'); return null; }
  const code = `import { chromium } from ${JSON.stringify(pw)}; const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: ${px}, height: ${px} } });\nconst svg = (await import('node:fs')).readFileSync(${JSON.stringify(src)}).toString('base64'); await p.setContent('<body style="margin:0;background:transparent"><img id=i src="data:image/svg+xml;base64,' + svg + '" style="width:${px}px;height:auto;display:block"></body>'); await p.waitForFunction(() => document.getElementById('i').complete && document.getElementById('i').naturalWidth > 0); const el = await p.$('img'); await el.screenshot({ path: ${JSON.stringify(out)}, omitBackground: true }); await b.close();`;
  const r = spawnSync('node', ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 120000 });
  if (r.status !== 0 || !fs.existsSync(out)) { warn(`could not rasterize ${file}: ${(r.stderr || '').slice(0, 120)}`); return null; }
  return '@raster/' + path.basename(out);
}
// The art the screens actually load (assets/brand/derived/*.webp: the same pixels as the originals, cropped to their alpha bounds, see MANIFEST.md).
// OpenPencil/Figma want PNG, so each file is decoded once with the headless CanvasKit and re-encoded as PNG in memory (nothing is retouched or resampled),
// and registered under its own name ('derived/signpost.webp'). The decoded images are kept for plank3().
const DEC = new Map();
let CKI = null;
async function loadDerived() {
  const dir = path.join(BRAND, 'derived'); if (!fs.existsSync(dir)) { warn('assets/brand/derived/ is missing: the screens, planks, stars and props fall back to the originals or a placeholder'); return; }
  CKI = await initCanvasKit();
  for (const f of fs.readdirSync(dir).filter((x) => /\.webp$/.test(x))) {
    const name = `derived/${f}`;
    try {
      const img = CKI.MakeImageFromEncoded(fs.readFileSync(path.join(dir, f))); if (!img) throw new Error('not decodable');
      const png = img.encodeToBytes(CKI.ImageFormat.PNG); if (!png) throw new Error('re-encode failed');
      IMAGES.set(name, figma.createImage(new Uint8Array(png)).hash); DEC.set(name, img);
    } catch (e) { warn(`could not decode ${name} (${e.message}): its art is left out`); }
  }
}
// A 3-slice plank, drawn the way bundle.css does it (border-image: the two end caps keep their cut and their proportions, only the middle stretches).
// `cap` is in the art's own px (plank-cap-flat 68, plank-cap-arrow 96; the art is plank-art-h high); the caps are drawn at h x cap / art-h.
// The result is a PNG of the exact pixels at 2x, registered under a key and used as an image fill by the plate that is the button's shape.
const SLICES = new Map();
function plank3(name, w, h, cap, scale = 2, veil = true) {
  const src = `derived/${name}.webp`, img = DEC.get(src); if (!img || !CKI) return null;
  const vc = veil && COLORS.has('plank-scrim') ? parse(cstr('plank-scrim', 'sunset')) : null;   // bundle.css: .gv-btn--wood::before and .gv-way::before, the plank-scrim veil
  const key = `@plank/${name}/${Math.round(w)}x${Math.round(h)}${vc ? '/veil' : ''}`; if (IMAGES.has(key)) return key;
  const W = Math.max(2, Math.round(w * scale)), H = Math.max(2, Math.round(h * scale)), iw = img.width(), ih = img.height();
  const capD = Math.min(Math.round((H * cap) / ih), Math.floor(W / 2));
  const surf = CKI.MakeSurface(W, H), c = surf.getCanvas(), paint = new CKI.Paint(), R = (x, y, ww, hh) => CKI.XYWHRect(x, y, ww, hh);
  const draw = (sx, sw, dx, dw) => c.drawImageRectOptions(img, R(sx, 0, sw, ih), R(dx, 0, dw, H), CKI.FilterMode.Linear, CKI.MipmapMode.None, paint);
  draw(0, cap, 0, capD); draw(cap, iw - 2 * cap, capD, W - 2 * capD); draw(iw - cap, cap, W - capD, capD);
  // The veil sits between the art and the lettering: inset by the stroke top and bottom, full strength between the caps and fading to nothing across each cap (the mask in bundle.css).
  if (vc) {
    const a = vc.a ?? 1, col = CKI.Color4f(vc.r, vc.g, vc.b, a), none = CKI.Color4f(vc.r, vc.g, vc.b, 0), edge = Math.min(0.5, capD / W), v = new CKI.Paint(), st = Math.round((NUM.stroke ?? 2) * scale);
    v.setShader(CKI.Shader.MakeLinearGradient([0, 0], [W, 0], [none, col, col, none], [0, edge, 1 - edge, 1], CKI.TileMode.Clamp)); c.drawRect(R(0, st, W, H - 2 * st), v); v.delete();
  }
  const png = surf.makeImageSnapshot().encodeToBytes(); if (!png) return null;
  IMAGES.set(key, figma.createImage(new Uint8Array(png)).hash); SLICES.set(key, 1); surf.delete(); paint.delete();
  return key;
}
const USED_BRAND = new Set();
// [w, h] of an image in assets/brand: a derived webp (from geometry.json), a PNG (IHDR) or a JPEG (first SOF marker)
let GEOM = null;
function pngSize(file) {
  try {
    if (/^derived\/.*\.webp$/.test(file)) { GEOM ??= JSON.parse(fs.readFileSync(path.join(BRAND, 'derived', 'geometry.json'), 'utf8')); const s = GEOM.sizes[file.slice(8)]; return s ? [s[0], s[1]] : null; }
    const b = fs.readFileSync(file.startsWith('@raster/') ? path.join(OUT, 'brand-raster', file.slice(8)) : path.join(BRAND, file));
    if (b.readUInt32BE(0) === 0x89504e47) return [b.readUInt32BE(16), b.readUInt32BE(20)];
    for (let i = 2; i < b.length - 9;) { if (b[i] !== 0xff) { i++; continue; } const m = b[i + 1]; if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)]; i += 2 + b.readUInt16BE(i + 2); }
  } catch { /* unreadable: callers fall back to a default ratio */ }
  return null;
}
// A garland divider (the horse rows from the brand sheet) at a given width; null if the art is not exported.
function Garland(file, w) { const ok = hasBrand(file, 'the garland divider under its heading is left out'), sz = ok && pngSize(file); if (ok && !sz) warn(`assets/brand/${file} could not be read as an image: its garland divider is left out`); if (!sz) return null; return Rc({ name: 'Garland divider', w, h: Math.max(8, Math.round((w * sz[1]) / sz[0])), fill: { img: file, mode: 'FIT' } }); }

const SHAPES = [];   // vectors and bars sized from their frame after layout: [{vec, frame, kind, a}]
function shapePath(kind, w, h, a = {}) {
  const f = (n) => +n.toFixed(2);
  switch (kind) {
    case 'chamfer': { const { cx, cy } = a; return `M${f(cx)} 0H${f(w - cx)}L${f(w)} ${f(cy)}V${f(h - cy)}L${f(w - cx)} ${f(h)}H${f(cx)}L0 ${f(h - cy)}V${f(cy)}Z`; }
    case 'next': { const { tip, notch } = a; return `M0 0H${f(w - tip)}L${f(w)} ${f(h / 2)}L${f(w - tip)} ${f(h)}H0L${f(notch)} ${f(h / 2)}Z`; }
    case 'back': { const { tip, notch } = a; return `M0 ${f(h / 2)}L${f(tip)} 0H${f(w)}L${f(w - notch)} ${f(h / 2)}L${f(w)} ${f(h)}H${f(tip)}Z`; }
    case 'way': { const { tip } = a; return `M0 0H${f(w - tip)}L${f(w)} ${f(h / 2)}L${f(w - tip)} ${f(h)}H0Z`; }
    case 'ticket': { const { r } = a; return `M0 0H${f(w)}V${f(h / 2 - r)}A${r} ${r} 0 0 0 ${f(w)} ${f(h / 2 + r)}V${f(h)}H0V${f(h / 2 + r)}A${r} ${r} 0 0 0 0 ${f(h / 2 - r)}Z`; }
    case 'rect': return `M0 0H${f(w)}V${f(h)}H0Z`;
    case 'rrect': { const r = Math.max(0, Math.min(a.r ?? 4, w / 2, h / 2)); if (!r) return `M0 0H${f(w)}V${f(h)}H0Z`; return `M${f(r)} 0H${f(w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(w)} ${f(r)}V${f(h - r)}A${f(r)} ${f(r)} 0 0 1 ${f(w - r)} ${f(h)}H${f(r)}A${f(r)} ${f(r)} 0 0 1 0 ${f(h - r)}V${f(r)}A${f(r)} ${f(r)} 0 0 1 ${f(r)} 0Z`; }
    default: throw new Error(`shape ${kind}`);
  }
}
// Inset a cut shape by d (a ring inside a chamfer): the corner legs shrink by d * tan(22.5 deg)
const insetArgs = (kind, a, d) => (kind === 'rrect' ? { r: Math.max(0, (a.r ?? 4) - d) } : kind === 'chamfer' ? { cx: Math.max(0.5, a.cx - d * 0.4142), cy: Math.max(0.5, a.cy - d * 0.4142) } : kind === 'next' || kind === 'back' ? { tip: Math.max(1, a.tip - d * 0.6), notch: Math.max(1, a.notch - d * 0.6) } : a);
function refitShapes() { for (const e of SHAPES) { if (e.nail) { const f = graph.getNode(e.frame); const x = e.nail.endsWith('l') ? e.off - e.r : f.width - e.off - e.r, y = e.nail.startsWith('t') ? e.off - e.r : f.height - e.off - e.r; graph.updateNode(e.vec, { x, y }); } else if (e.bar) { const f = graph.getNode(e.frame); graph.updateNode(e.vec, e.bar === 'left' ? { x: 0, y: 0, width: e.w, height: f.height } : { x: 0, y: f.height - e.w, width: f.width, height: e.w }); } } }

// ------------------------------------------------------------------------------------------------------ node builder
// A spec is {t:'frame'|'text'|'rect'|'ellipse'|'icon'|'svg', p:{...}, c:[...]}. Colors are token names (or {tok, over, bright}):
// they are resolved for the stage's theme and bound to that theme's color variables, so nothing in the file is a loose hex.
const F = (p, ...c) => ({ t: 'frame', p, c: c.flat(Infinity).filter(Boolean) });
const Tx = (text, p = {}) => ({ t: 'text', p: { ...p, text }, c: [] });
const Rc = (p) => ({ t: 'rect', p, c: [] });
const El = (p) => ({ t: 'ellipse', p, c: [] });
const Ic = (name, size = 16, color = 'ink', p = {}) => ({ t: 'icon', p: { name, size, color, ...p }, c: [] });
const Svg = (file, p = {}) => ({ t: 'svg', p: { file, ...p }, c: [] });
const KEEP = ['name', 'w', 'h', 'flex', 'gap', 'wrap', 'rowGap', 'justify', 'items', 'grow', 'p', 'px', 'py', 'pt', 'pr', 'pb', 'pl', 'rounded', 'roundedTL', 'roundedTR', 'roundedBL', 'roundedBR', 'opacity', 'rotate', 'x', 'y', 'minW', 'maxW'];
let CUR = 'sunset';                // the theme being built
const TEXT_STYLES_USED = new Set();
const SPEC_TEXT = new Set();    // text layers written for the spec itself (captions, notes, stage headers): not UI copy, so not part of the copy check
const BALANCES = [];                // text the CSS sets with text-wrap: balance (see applyBalance)
const CLAMPS = [];                  // text cut to N lines with an ellipsis: done on the string (see applyClamps), because the .fig does not keep maxLines

function paintFor(ref, theme, boundTo, size) {
  if (ref == null || ref === 'none') return null;
  if (ref.grad) {   // a linear gradient top to bottom (bundle.css --gv-wood on the bars): the stops are token colors, resolved for the theme. A gradient paint cannot be bound to a variable, so these stops are the one place a color is not a variable.
    const stops = ref.grad.map(([tok, position]) => ({ position, color: colorInfo(tok, theme).c }));
    return { type: 'GRADIENT_LINEAR', color: stops[0].color, opacity: 1, visible: true, gradientStops: stops, gradientTransform: { m00: 0, m01: 1, m02: 0, m10: -1, m11: 0, m12: 1 } };
  }
  if (ref.plank) {   // a 3-slice plank cut to the plate's own size (see plank3); without the art (or before the plate is measured) it is the flat wood token
    const key = size ? plank3(ref.plank, size.w, size.h, ref.cap ?? NUM['plank-cap-flat'] ?? 68) : null;
    if (key) USED_BRAND.add(`derived/${ref.plank}.webp`);
    const info = colorInfo(ref.base ?? 'wood', theme); boundTo.info = info;
    return key ? [solid(info.c), { type: 'IMAGE', color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true, imageHash: IMAGES.get(key), imageScaleMode: 'FILL' }] : solid(info.c);
  }
  if (ref.img) {   // an image, optionally over a flat base color (the plank art has transparent margins; the base is the wood token)
    const f = imageFill(ref.img, ref.mode || 'FILL'); if (f) USED_BRAND.add(ref.img);
    if (ref.base) { const info = colorInfo(ref.base, theme); boundTo.info = info; return f ? [solid(info.c), f] : solid(info.c); }
    return f;
  }
  const info = colorInfo(ref, theme); boundTo.info = info; return solid(info.c);
}
function bindColor(nodeId, field, info, theme) { const id = colorVarId(theme, info); if (id) graph.bindVariable(nodeId, field, id); }

function build(spec, parentId, theme = CUR) {
  const parent = graph.getNode(parentId), P = { ...(spec.p ?? {}) };
  if (P.theme) theme = P.theme;
  if (spec.t === 'icon') return buildIcon(P, parentId, theme);
  if (spec.t === 'path') return buildPath(P, parentId, theme);
  if (spec.t === 'svg') return buildSvg(P, parentId, theme);
  const isText = spec.t === 'text';
  const jsx = {}; for (const k of KEEP) if (P[k] !== undefined) jsx[k] = P[k];
  if (!isText && spec.t === 'frame' && jsx.flex === undefined && (P.p !== undefined || P.px !== undefined || P.py !== undefined || P.justify || P.items)) jsx.flex = 'col';
  let text = null, ts = null;
  if (isText) {
    ts = P.style ? TYPE[P.style] : null; if (P.style && !ts) { warn(`tokens.json has no type style "${P.style}" any more: using body`); ts = TYPE.body; }
    if (ts) TEXT_STYLES_USED.add(ts.name);
    text = P.upper ? String(P.text).toUpperCase() : String(P.text);
    jsx.font = P.font ?? ts?.family; jsx.size = P.size ?? ts?.size; jsx.weight = P.weight ?? ts?.weight;
    if (jsx.font === 'Rye' || jsx.font === 'Ultra') jsx.weight = 400;   // single-weight faces: a Medium request has nothing to resolve to
    const lh = P.lineHeight ?? ts?.line; if (lh) jsx.lineHeight = lh;
    const ls = P.ls ?? ts?.ls; if (ls) jsx.letterSpacing = ls;
    if (P.align) jsx.textAlign = P.align; if (P.valign) jsx.textAlignVertical = P.valign;
    jsx.name = P.name ?? text.replace(/\s+/g, ' ').slice(0, 40);
  }
  if (!isText) jsx.name = P.name ?? ({ frame: jsx.flex === 'row' ? 'Row' : jsx.flex === 'col' ? 'Column' : 'Box', rect: 'Fill', ellipse: 'Disc' }[spec.t]);
  if (spec.t === 'ellipse' || spec.t === 'rect') { jsx.w = P.w; jsx.h = P.h; }
  const o = propsToOverrides(jsx, isText, parent?.layoutMode ?? 'NONE');
  if (isText) o.text = text;
  const type = { frame: 'FRAME', text: 'TEXT', rect: 'RECTANGLE', ellipse: 'ELLIPSE' }[spec.t];
  const binds = {};
  // paint
  if (isText) { const b = {}; const f = paintFor(P.color ?? 'ink', theme, b); o.fills = [f]; binds.fills = b.info; }
  else if (P.fill !== undefined) { const b = {}; const f = paintFor(P.fill, theme, b); o.fills = Array.isArray(f) ? f : f ? [f] : []; if (b.info) binds.fills = b.info; if (P.fillOp != null) o.fills = o.fills.map((x) => ({ ...x, opacity: P.fillOp })); }   // fillOp 0: a fill that paints nothing but names the color the text sits on (art cannot be read by the contrast lint)
  if (P.stroke) {
    const info = colorInfo(P.stroke, theme); binds.strokes = info;
    o.strokes = [{ color: info.c, opacity: info.c.a, visible: true, weight: P.sw ?? 1, align: P.sa ?? 'INSIDE' }];
  }
  if (P.fx) o.effects = effectsFor(P.fx, theme);
  if (P.clip) o.clipsContent = true;
  if (P.layoutIgnore) o.layoutPositioning = 'ABSOLUTE';
  const node = graph.createNode(type, parentId, o);
  if (binds.fills) bindColor(node.id, 'fills', binds.fills, theme);
  if (binds.strokes) bindColor(node.id, 'strokes', binds.strokes, theme);
  if (isText && P.clamp) CLAMPS.push({ id: node.id, lines: P.clamp, full: text });
  if (isText && P.balance) BALANCES.push({ id: node.id, full: text });
  if (isText && P.spec) SPEC_TEXT.add(node.id);
  if (isText && ts) { const n = numbers(); if (o.fontSize === ts.size) graph.bindVariable(node.id, 'fontSize', n.by.get(`size:${ts.name}`)); graph.bindVariable(node.id, 'fontFamily', n.by.get(`family:${ts.familyKey}`)); }
  // plates: chamfered / arrow / ticket shapes drawn behind the label (OpenPencil has no clip-path), then rings and accent bars
  for (const pl of [].concat(P.plate ?? [])) addPlate(node, pl, theme);
  if (P.accent) addAccent(node, P.accent, theme);
  if (P.nails) addNails(node, theme);
  for (const ch of spec.c ?? []) build(ch, node.id, theme);
  return node;
}
function effectsFor(names, theme) {
  const out = [];
  for (const nm of [].concat(names)) {
    if (nm && typeof nm === 'object') { if (nm.blur) out.push({ type: 'LAYER_BLUR', color: nm.tok ? parse(cstr(nm.tok, theme)) : { r: 0, g: 0, b: 0, a: 0 }, offset: { x: 0, y: 0 }, radius: nm.blur, spread: 0, visible: true }); continue; }
    for (const l of shadowLayers(nm, theme)) {
    const c = parse(l.color);
    out.push({ type: l.inset ? 'INNER_SHADOW' : 'DROP_SHADOW', color: c, offset: { x: l.x, y: l.y }, radius: l.blur, spread: l.spread, visible: true });
    }
  }
  return out;
}
// Plates (chamfers, arrows, rings) are vectors sized from their frame. OpenPencil's renderer caches a vector's path by node id, so a plate is created
// only after the layout pass has measured its frame (materializeShapes), never resized afterwards.
const PENDING = [];
function addPlate(frame, pl, theme) { PENDING.push({ frame: frame.id, pl, theme }); }
const PLATE_COUNT = new Map();
function materializeShapes() {
  for (const { frame, pl: pl0, theme } of PENDING) {
    let pl = pl0; const f = graph.getNode(frame); if (!f) continue;
    if (pl.ring?.band) {   // a focus band: the filled polygon of bundle.css's ::after, in the button's own box (a ring drawn flush as a stroke if the polygon could not be read)
      const d = woodBandPath(pl.kind, f.width, f.height, pl.ring.band.h);
      if (d) {
        const info = colorInfo(pl.ring.tok, theme), vec = graph.createNode('VECTOR', frame, { name: pl.name ?? 'Focus ring (band)', x: 0, y: 0, width: f.width, height: f.height, layoutPositioning: 'ABSOLUTE', vectorNetwork: parseSVGPath(d, 'EVENODD') });
        graph.updateNode(vec.id, { fills: [solid(info.c)], strokes: [] }); bindColor(vec.id, 'fills', info, theme);
        const k = PLATE_COUNT.get(frame) ?? 0; PLATE_COUNT.set(frame, k + 1); graph.reorderChild(vec.id, frame, k); continue;
      }
      pl = { ...pl, ring: { ...pl.ring, band: undefined, inset: 0, w: NUM['stroke-focus'] ?? 3 } };
    }
    const a = pl.a ?? {}, b = {}, o = pl.ring ? pl.ring.inset + pl.ring.w / 2 : 0;
    const entry = { frame, kind: pl.kind, a: pl.ring ? insetArgs(pl.kind, a, o) : a, inset: o };
    const W = Math.max(2, f.width - 2 * o), H = Math.max(2, f.height - 2 * o);
    const vec = graph.createNode('VECTOR', frame, { name: pl.name ?? (pl.ring ? `Ring / ${pl.kind}` : `Plate / ${pl.kind}`), x: o, y: o, width: W, height: H, layoutPositioning: 'ABSOLUTE', vectorNetwork: parseSVGPath(shapePath(pl.kind, W, H, entry.a), 'NONZERO') });
    entry.vec = vec.id; SHAPES.push(entry);
    if (pl.ring) {
      const info = colorInfo(pl.ring.tok, theme);
      graph.updateNode(vec.id, { fills: [], strokes: [{ color: info.c, opacity: info.c.a, visible: true, weight: pl.ring.w, align: 'CENTER', cap: 'NONE', join: 'MITER' }] });
      bindColor(vec.id, 'strokes', info, theme);
    } else {
      const fl = paintFor(pl.fill, theme, b, { w: W, h: H }); graph.updateNode(vec.id, { fills: Array.isArray(fl) ? fl : fl ? [fl] : [] }); if (b.info) bindColor(vec.id, 'fills', b.info, theme);
      if (pl.stroke) { const info = colorInfo(pl.stroke, theme); graph.updateNode(vec.id, { strokes: [{ color: info.c, opacity: info.c.a, visible: true, weight: pl.sw ?? 1, align: 'INSIDE', cap: 'NONE', join: 'MITER' }] }); bindColor(vec.id, 'strokes', info, theme); }
      if (pl.fx) graph.updateNode(vec.id, { effects: effectsFor(pl.fx, theme) });
    }
    const k = PLATE_COUNT.get(frame) ?? 0; PLATE_COUNT.set(frame, k + 1); graph.reorderChild(vec.id, frame, k);   // behind the label, in the order given
  }
  PENDING.length = 0;
}
function addAccent(frame, ac, theme) {   // the 4px edge in a card's inset shadow: a bar down the left (or along the bottom)
  const info = colorInfo(ac.tok, theme);
  const bar = graph.createNode('RECTANGLE', frame.id, { name: `Accent / ${ac.side ?? 'left'}`, width: ac.w ?? NUM['space-1'], height: 10, layoutPositioning: 'ABSOLUTE', fills: [solid(info.c)] });
  bindColor(bar.id, 'fills', info, theme); SHAPES.push({ vec: bar.id, frame: frame.id, bar: ac.side ?? 'left', w: ac.w ?? NUM['space-1'] });
}
function buildPath(P, parentId, theme) {   // a stroked or filled SVG path (viewfinder brackets, motion curves, the star)
  const vn = parseSVGPath(P.d, 'NONZERO'); const fills = [], strokes = [], binds = {};
  if (P.fill) { const info = colorInfo(P.fill, theme); fills.push(solid(info.c)); binds.fills = info; }
  if (P.stroke) { const info = colorInfo(P.stroke, theme); strokes.push({ color: info.c, opacity: info.c.a, visible: true, weight: P.sw ?? 1, align: 'CENTER', cap: P.cap ?? 'ROUND', join: 'ROUND', ...(P.dash ? { dashPattern: P.dash } : {}) }); binds.strokes = info; }
  const node = graph.createNode('VECTOR', parentId, { name: P.name ?? 'Path', width: P.w, height: P.h, vectorNetwork: vn, fills, strokes, ...(P.layoutIgnore ? { layoutPositioning: 'ABSOLUTE' } : {}) });
  if (P.x != null) graph.updateNode(node.id, { x: P.x }); if (P.y != null) graph.updateNode(node.id, { y: P.y });
  if (P.fx) graph.updateNode(node.id, { effects: effectsFor(P.fx, theme) });
  if (binds.fills) bindColor(node.id, 'fills', binds.fills, theme); if (binds.strokes) bindColor(node.id, 'strokes', binds.strokes, theme);
  return node;
}
function addNails(frame, theme) {   // four brass nail heads, 12px in from each corner (--gv-nails)
  const info = colorInfo('brass', theme), rim = colorInfo('wood-deep', theme), r = NUM.nail ?? 2.5, off = sp(3);
  ['tl', 'tr', 'bl', 'br'].forEach((corner) => {
    const n = graph.createNode('ELLIPSE', frame.id, { name: `Nail ${corner}`, width: r * 2, height: r * 2, layoutPositioning: 'ABSOLUTE', fills: [solid(info.c)], strokes: [{ color: rim.c, opacity: 1, visible: true, weight: 1, align: 'OUTSIDE' }] });
    bindColor(n.id, 'fills', info, theme); bindColor(n.id, 'strokes', rim, theme); SHAPES.push({ vec: n.id, frame: frame.id, nail: corner, off, r });
  });
}
function buildIcon(P, parentId, theme) {
  const d = ICONS[P.name]; if (!d) warn(`icon "${P.name}" is not in bundle.js PATHS`);
  const size = P.size ?? 16, s = size / 24, vn = parseSVGPath(d ?? 'M0 0', 'NONZERO');
  for (const v of vn.vertices) { v.x *= s; v.y *= s; }
  for (const sg of vn.segments) { for (const t of [sg.tangentStart, sg.tangentEnd]) if (t) { t.x *= s; t.y *= s; } }
  const info = colorInfo(P.color ?? 'ink', theme);
  const node = graph.createNode('VECTOR', parentId, { name: `Glyph / ${P.name}`, width: size, height: size, vectorNetwork: vn, fills: [], strokes: [{ color: info.c, opacity: info.c.a, visible: true, weight: +(((P.sw ?? 2) * size) / 24).toFixed(2), align: 'CENTER', cap: 'ROUND', join: 'ROUND' }] });
  bindColor(node.id, 'strokes', info, theme); return node;
}
// Brand SVGs (h-mark, lockup, longhorn): imported as vectors. The clipPath rect in the exports is dropped (it would import as a white box).
function buildSvg(P, parentId, theme) {
  const fp = path.join(BRAND, P.file);
  if (!fs.existsSync(fp)) { brandMissing(P.file); return build(placeholder(P.file, P.w ?? 120, P.h ?? 120), parentId, theme); }
  USED_BRAND.add(P.file);
  const raw = fs.readFileSync(fp, 'utf8');
  let svg = raw.replace(/<defs>[\s\S]*?<\/defs>/g, '').replace(/\sclip-path="[^"]*"/g, '');
  // the same steps as OpenPencil's import_svg tool, synchronously: one frame, one vector per <path>
  const paths = extractPaths(svg); const vb = /viewBox="([^"]+)"/.exec(svg)?.[1].split(/[\s,]+/).map(Number);
  const wAttr = parseFloat(/\swidth="([\d.]+)"/.exec(svg)?.[1]), hAttr = parseFloat(/\sheight="([\d.]+)"/.exec(svg)?.[1]);
  const width = wAttr || vb?.[2] || 24, height = hAttr || vb?.[3] || 24;
  // OpenPencil's import ignores clip-path, so art that runs past the artboard (the alt longhorn's horn tip) would draw outside it. The exports clip to their
  // own artboard (a rect the size of the viewBox), which is exactly what a clipping frame does; the clip-path attributes themselves are dropped above.
  const cr = /<clipPath[^>]*>\s*<rect[^>]*?\swidth="([\d.]+)"[^>]*?\sheight="([\d.]+)"/.exec(raw), clip = !!cr && Math.abs(+cr[1] - width) < 1 && Math.abs(+cr[2] - height) < 1;
  const fr = graph.createNode('FRAME', parentId, { name: P.name ?? P.file, width, height, fills: [], clipsContent: clip }); const s = (P.w ?? fr.width) / fr.width;
  for (const pt of paths) {
    const vec = graph.createNode('VECTOR', fr.id, { name: 'path', width, height, vectorNetwork: parseSVGPath(pt.d, pt.fillRule) }); vec.x = 0; vec.y = 0;
    const dflt = { r: 1, g: 1, b: 1, a: 1 };
    if (pt.fill && pt.fill !== 'none') graph.updateNode(vec.id, { fills: [solid(pt.fill === 'currentColor' ? dflt : parse(pt.fill))] });
    else if (pt.fill === null && !pt.stroke) graph.updateNode(vec.id, { fills: [solid(dflt)] });
    else graph.updateNode(vec.id, { fills: [] });
    if (pt.stroke && pt.stroke !== 'none') graph.updateNode(vec.id, { strokes: [{ color: pt.stroke === 'currentColor' ? dflt : parse(pt.stroke), weight: pt.strokeWidth, opacity: 1, visible: true, align: 'CENTER', cap: 'NONE', join: 'MITER' }] });
  }
  for (const c of graph.getChildren(fr.id)) {
    if (c.vectorNetwork) { const vn = structuredClone(c.vectorNetwork); for (const v of vn.vertices) { v.x *= s; v.y *= s; } for (const sg of vn.segments) for (const t of [sg.tangentStart, sg.tangentEnd]) if (t) { t.x *= s; t.y *= s; } graph.updateNode(c.id, { vectorNetwork: vn, width: c.width * s, height: c.height * s, x: c.x * s, y: c.y * s }); }
    for (const field of ['fills', 'strokes']) {   // brand paints: named variables, so the file has no loose colors
      const pt = c[field]?.[0]; if (pt?.type === 'SOLID') { const hexv = hex(pt.color); bindColor(c.id, field, brandInfo(hexv, pt.color), theme); }
    }
  }
  graph.updateNode(fr.id, { width: fr.width * s, height: fr.height * s });
  return graph.getNode(fr.id);
}
const hex = (c) => '#' + [c.r, c.g, c.b].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
function brandInfo(hexv, c) {   // pure white is on-ground; other brand colors get a "brand/#HEX" variable
  if (hexv === '#FFFFFF') return { key: 'on-ground', c: { ...c, a: 1 } };
  return { key: `brand/${hexv}`, c: { ...c, a: 1 }, derived: true };
}
const placeholder = (label, w, h) => F({ name: `Placeholder / ${label}`, w, h, flex: 'col', justify: 'center', items: 'center', p: 8, fill: 'surface-sunken', stroke: 'line-strong', sw: 1 }, Tx(`${label}\n(placeholder: not exported yet)`, { style: 'label', color: 'ink-soft', align: 'center', w: 'fill' }));

// ------------------------------------------------------------------------------------------------------ pages, export
const PAGES = {};
function newPage(key, name) {
  const pages = graph.getPages(); const first = pages.length === 1 && !Object.keys(PAGES).length;
  const pg = first ? pages[0] : graph.addPage(name); if (first) graph.updateNode(pg.id, { name }); PAGES[key] = { id: pg.id, name, tops: [] }; return PAGES[key];
}
// Top-level frames of a page stack in a column (x = 0) once their heights are known.
// An entry of pg.tops is a frame id, or an array of ids that sit side by side (equal height, so no gap shows).
function stackTops(pg, gap = 0) {
  let y = 0;
  for (const e of pg.tops) {
    const ids = [].concat(e), hs = ids.map((id) => Math.floor(graph.getNode(id).height)), h = Math.max(...hs); let x = 0;
    ids.forEach((id, i) => { const n = graph.getNode(id); if (n.height < h) graph.updateNode(id, { primaryAxisSizing: 'FIXED', height: h }); graph.updateNode(id, { x, y }); x += n.width; });
    y += h + gap;
  }
}
const topIds = (pg) => pg.tops.flat();
async function renderNodes(pg, scale) { // trimTransparent only for page scope, so a selection keeps its exact frame
  return headlessRender(graph, pg.id, topIds(pg), scale);
}
const { headlessRenderNodes } = await import(`${CORE}/io/formats/raster/headless.js`);
async function headlessRender(g, pageId, ids, scale) { return headlessRenderNodes(g, pageId, ids, { scale, format: 'PNG' }); }

// OpenPencil 0.13.2 writes every text layer's derived glyphs as ONE line (no wrapping, no letter spacing), and its reader then draws
// those baked glyphs as they are, so a reloaded .fig shows wrapped text as a single long line. Give each text layer the glyphs the live
// renderer laid out (CanvasKit paragraph: line breaks, alignment, tracking) so the saved file looks like the PNGs.
// shapeTextForClipboard from core, but on the headless renderer's CanvasKit (core's own helper creates a second instance whose font provider does not match)
async function shapeNode(node) {
  const ck = await initCanvasKit(), fontProvider = fontManager.provider(); if (!fontProvider) return null;
  const paragraph = buildParagraph({ ck, fontProvider, fontsLoaded: true }, node);
  if (node.textAutoResize === 'WIDTH_AND_HEIGHT') { paragraph.layout(1e6); paragraph.layout(Math.max(node.width || 1, Math.ceil(paragraph.getLongestLine()))); } else paragraph.layout(node.width);   // as buildParagraph does
  const lines = paragraph.getShapedLines(), metrics = paragraph.getLineMetrics(); const glyphs = [], baselines = [];
  // shaped-run offsets are UTF-8 byte offsets (line metrics are UTF-16 indexes): map bytes back to string indexes ("·" is two bytes)
  const b2c = []; for (let c = 0, byte = 0; c < node.text.length;) { const cp = node.text.codePointAt(c), n = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4; for (let k = 0; k < n; k++) b2c[byte + k] = c; byte += n; c += cp > 0xffff ? 2 : 1; }
  for (let li = 0; li < lines.length; li++) {
    const m = metrics[li] ?? metrics[0]; if (!m) continue;
    for (const run of lines[li].runs) for (let i = 0; i < run.glyphs.length; i++) glyphs.push({ firstCharacter: b2c[run.offsets[i]] ?? run.offsets[i] ?? i, x: run.positions[i * 2] ?? 0, y: m.baseline });
    if (m.startIndex < node.text.length) baselines.push({ firstCharacter: m.startIndex, endCharacter: m.endIndex, width: m.width });
  }
  paragraph.delete(); return glyphs.length ? { glyphs, baselines } : null;
}
// `clamp: n` on a text layer means "show at most n lines, then an ellipsis" (a CompareCard description, a Removed row). OpenPencil's live
// renderer ellipsizes with maxLines, but the .fig format does not keep maxLines/textTruncation, so a reloaded file spilled onto the
// next row. So the cut is made on the string itself, once the real width is known: the layer holds exactly what is drawn, in the
// editor, in Figma and in the PNG. (The layer name keeps the first 40 characters of the full sentence.)
async function applyClamps() {
  if (!CLAMPS.length) return 0;
  const ck = await initCanvasKit(), fontProvider = fontManager.provider(); if (!fontProvider) return 0;
  let cut = 0;
  for (const c of CLAMPS) {
    const node = graph.getNode(c.id); if (!node || !(node.width > 0)) continue;
    const lines = (text) => { const para = buildParagraph({ ck, fontProvider, fontsLoaded: true }, { ...node, text }); para.layout(node.width); const n = para.getLineMetrics().length; para.delete(); return n; };
    let want = c.full;
    if (lines(c.full) > c.lines) {   // largest prefix whose "prefix…" still fits in c.lines lines
      let lo = 0, hi = c.full.length;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lines(c.full.slice(0, mid).trimEnd() + '…') <= c.lines) lo = mid; else hi = mid - 1; }
      want = c.full.slice(0, lo).trimEnd() + '…'; cut++;
    }
    if (node.text !== want) graph.updateNode(c.id, { text: want });
  }
  return cut;
}
// bundle.css sets `text-wrap: balance` on the primary button of a sheet or action bar, on question and title lines, and on card and sheet titles:
// a line that wraps is split into lines of about equal length (the browser finds the narrowest width that wraps to the same number of lines).
// OpenPencil wraps greedily, which left "EVERYONE AGREED ·" over "START" where the component shows "EVERYONE" over "AGREED · START".
// So a layer marked `balance: true` is broken the way the browser breaks it: the line breaks are written into the layer's text, like applyClamps does for an ellipsis.
async function applyBalance() {
  if (!BALANCES.length) return 0;
  const ck = await initCanvasKit(), fontProvider = fontManager.provider(); if (!fontProvider) return 0;
  let changed = 0;
  for (const b of BALANCES) {
    const node = graph.getNode(b.id); if (!node || !(node.width > 0)) continue;
    const para = (width) => { const pr = buildParagraph({ ck, fontProvider, fontsLoaded: true }, { ...node, text: b.full }); pr.layout(width); return pr; };
    const lineCount = (width) => { const pr = para(width), n = pr.getLineMetrics().length; pr.delete(); return n; };
    const n = lineCount(node.width);
    let want = b.full;
    if (n > 1) {
      let lo = 1, hi = Math.ceil(node.width);
      while (lo < hi) { const mid = (lo + hi) >> 1; if (lineCount(mid) <= n) hi = mid; else lo = mid + 1; }
      const pr = para(lo), lm = pr.getLineMetrics(); pr.delete();
      want = lm.map((l) => b.full.slice(l.startIndex, l.endExcludingWhitespaces ?? l.endIndex).trim()).join('\n');
    }
    if (node.text !== want) { graph.updateNode(b.id, { text: want }); changed++; }
  }
  return changed;
}
async function bakeTextGlyphs() {
  const cache = new Map(), chars = new Map(); let baked = 0, skipped = 0; const lost = [];
  // one outline per character (not per shaped glyph): stringToGlyphs on a whole string applies ligatures ("tt"), which shifts every later index
  const outline = (family, style, ch, size) => { const k = `${family}|${style}|${ch}|${size}`; if (!chars.has(k)) chars.set(k, getGlyphOutlineMetricsSync(family, style, ch, size)?.[0] ?? null); return chars.get(k); };
  for (const node of [...graph.getAllNodes()]) {
    if (node.type !== 'TEXT' || !node.text || !/\S/.test(node.text)) continue;
    const key = [node.text, node.fontFamily, node.fontWeight, node.fontSize, node.lineHeight, node.letterSpacing, node.width, node.textAlignHorizontal, node.textAutoResize].join('|');
    if (!cache.has(key)) {
      let glyphs = null;
      try {
        const shaped = await shapeNode(node), style = weightToStyle(node.fontWeight, node.italic);
        if (shaped) {
          glyphs = [];
          shaped.glyphs.forEach((g, k) => {
            const end = Math.min(shaped.glyphs[k + 1]?.firstCharacter ?? node.text.length, node.text.length); let x = g.x;
            for (let c = g.firstCharacter; c < end; c++) {   // a cluster is normally one character; a ligature spans several
              const ch = node.text[c], o = outline(node.fontFamily, style, ch, node.fontSize);
              if (o && !/\s/.test(ch)) glyphs.push({ commandsBlob: encodePathCommandsBlob(o.commands, node.fontSize), x, y: g.y, fontSize: node.fontSize });   // run positions already include the alignment offset
              x += (o?.advance ?? 0) + (node.letterSpacing || 0);
            }
          });
          if (!glyphs.length) glyphs = null;
        }
      } catch { glyphs = null; }
      cache.set(key, glyphs);
    }
    const g = cache.get(key); if (g) { graph.updateNode(node.id, { figmaDerivedTextGlyphs: g }); baked++; } else { skipped++; if (lost.length < 3) lost.push(node.text.replace(/\s+/g, ' ').slice(0, 30)); }
  }
  log(`text glyphs baked for ${baked} layers${skipped ? ` (${skipped} skipped)` : ''}`);
  // A layer that could not be shaped has no letters in the saved file. That only happens when a font is missing, so stop: do not write a sheet without words.
  if (skipped) abort(`${skipped} of ${baked + skipped} text layers could not be shaped (for example "${lost.join('", "')}"): their font did not load. Check the network or ${FONT_CACHE}.`);
}

// Fonts load on demand at the first export (Google Fonts, then the on-disk cache); do it once up front so every later layout uses real metrics.
// If a face cannot be had the run stops here: without it every text layer would be skipped and the sheet would have shapes but no words.
const FACES = [['Ultra', 400], ['Rye', 400], ['Oswald', 400], ['Oswald', 500], ['Oswald', 600], ['Manrope', 400], ['Manrope', 500], ['Manrope', 600], ['Manrope', 700]];
const missingFaces = (faces) => faces.filter(([fam, w]) => !fontManager.isStyleLoaded(fam, weightToStyle(w, false)));
async function warmFonts() {
  const pg = graph.getPages()[0];
  const fr = graph.createNode('FRAME', pg.id, { name: 'warm', width: 600, height: 400, fills: [solid({ r: 1, g: 1, b: 1, a: 1 })] });
  FACES.forEach(([fam, w], i) => graph.createNode('TEXT', fr.id, { name: 'w', text: `${fam} ${w} Table A12 K7`, fontFamily: fam, fontWeight: w, fontSize: 16, x: 0, y: i * 24, width: 400, height: 24 }));
  await headlessRender(graph, pg.id, [fr.id], 0.1); graph.deleteNode(fr.id);
  const miss = missingFaces(FACES);
  if (miss.length) abort(`fonts could not be loaded: ${miss.map(([f, w]) => `${f} ${w}`).join(', ')}. The generator fetches them from Google Fonts on first use and caches them in ${FONT_CACHE}; check the network (or copy a populated cache there) and run again.`);
  log(`fonts ready: ${[...new Set(FACES.map((f) => f[0]))].join(', ')} (${FACES.length} faces)`);
}
// Before anything is written: every text layer must use a face that is loaded (a layer in a missing face is drawn in a fallback or not at all).
function assertFontsUsed() {
  const used = new Map();
  for (const n of graph.getAllNodes()) if (n.type === 'TEXT' && n.text) used.set(`${n.fontFamily}|${n.fontWeight}|${n.italic ? 1 : 0}`, [n.fontFamily, n.fontWeight, n.italic]);
  const miss = [...used.values()].filter(([fam, w, it]) => !fontManager.isStyleLoaded(fam, weightToStyle(w, it)));
  if (miss.length) abort(`text layers use fonts that are not loaded: ${miss.map(([f, w]) => `${f} ${w}`).join(', ')}. Add the face to FACES in make_spec_sheet.mjs, or check the network.`);
}

// ------------------------------------------------------------------------------------------------------ kit: sizes read from bundle.css
ICONS.spinner ??= 'M12 3a9 9 0 1 1-9 9';   // the busy arc inside a loading Button (CSS draws it with a border); not in PATHS
const sp = (n) => NUM[`space-${n}`] ?? n * 4;
const RSM = NUM['radius-sm'], RMD = NUM['radius-md'], RLG = NUM['radius-lg'], TAP = NUM['tap-min'];
const T = (text, style, color = 'ink', p = {}) => Tx(text, { style, color, ...p });
const row = (p, ...c) => F({ flex: 'row', items: 'center', ...p }, ...c);
const col = (p, ...c) => F({ flex: 'col', ...p }, ...c);
const lastPart = (v) => (v ? splitTop(String(v), ' ').pop() : null);
const padParts = (sel) => { const v = cssDecl(sel).padding; return v ? splitTop(v, ' ').map((x) => evalLen(x)) : null; };   // top right bottom left (CSS order)
const BTN = (() => {
  const base = cssDecl('.gv-btn'), cxOf = (sel, fb) => css(sel, '--cx', fb);
  const mdCx = cxOf('.gv-btn', NUM['cut-sm']);
  const pad = (sel, fb) => { const p = padParts(sel); return p ? p[p.length === 2 ? 1 : 1] : fb; };
  return {
    md: { h: css('.gv-btn', 'min-height', TAP), px: pad('.gv-btn', sp(5)), style: 'button', cx: mdCx, cy: mdCx * 0.75 },
    lg: { h: css('.gv-btn--lg', 'min-height', TAP + sp(2)), px: pad('.gv-btn', sp(5)), style: 'button-lg', cx: cxOf('.gv-btn--lg', NUM['cut-md']), cy: cxOf('.gv-btn--lg', NUM['cut-md']) * 0.75 },
    sm: { h: css('.gv-btn--sm', 'min-height', TAP - sp(3)), px: pad('.gv-btn--sm', sp(3)), style: 'caps', cx: cxOf('.gv-btn--sm', NUM['cut-sm'] * 0.75), cy: cxOf('.gv-btn--sm', NUM['cut-sm'] * 0.75) * 0.75 },
    next: (() => { const p = padParts('.gv-btn.gv-btn--next') ?? [0, sp(8), 0, sp(6)]; return { pl: p[3], pr: p[1] }; })(),
    back: (() => { const p = padParts('.gv-btn.gv-btn--back') ?? [0, sp(6), 0, sp(8)]; return { pl: p[3], pr: p[1] }; })(),
    variants: [...new Set([...CSS_SRC.matchAll(/\.gv-btn--([a-z-]+)/g)].map((m) => m[1]))].filter((v) => !['sm', 'lg', 'block', 'next', 'back'].includes(v)),
    gap: css('.gv-btn', 'gap', sp(2)),
  };
})();
if (BTN.variants.length < 5) warn(`bundle.css: only ${BTN.variants.join(', ')} button variants found`);

// The focus ring bundle.css really gives a focused .gv-btn--wood (the plank is its own ground, so the ring must show on brown art), read at run time so the sheet follows the component:
//  1. today's rule: `.gv-btn--wood:focus-visible` turns the generic ring off and the ring is a `::after` band in `background` (on-wood), the evenodd polygon of
//     `clip-path` between two copies of the plank's own cut, inset `--o1` and `--o2` (one stroke-focus in from the edge, one stroke-focus wide), so the plank keeps its
//     dark edge outside the ring. The polygons of the three planks (the flat chamfer, Next, Back) are read and evaluated, not retyped (see woodBandPath);
//  2. an older rule: an inset box-shadow or an outline of stroke-focus in a token (a ring flush with the edge, geometry {inset 0, width stroke-focus});
//  3. no own rule: the generic `:where(.gv-btn, ...):focus-visible` ring (var(--focus)), which is not visible on a brown plank: a component gap, reported by the audit.
const WOOD_RING_CSS = (() => {
  const sels = (r) => r.sel;
  const own = CSS.find((r) => !r.ctx && sels(r).some((x) => /^\.gv-btn--wood:focus-visible$/.test(x)));
  const generic = CSS.find((r) => !r.ctx && sels(r).some((x) => x.startsWith(':where(') && x.endsWith('):focus-visible') && /[(,]\.gv-btn[,)]/.test(x)));
  const after = (sel) => CSS.find((r) => !r.ctx && sels(r).some((x) => x === sel));
  const band = after('.gv-btn--wood:focus-visible::after'), stroke = NUM['stroke-focus'] ?? 3;
  if (band && /^polygon\(\s*evenodd/.test(band.decl['clip-path'] ?? '') && /^none$/.test(own?.decl['box-shadow'] ?? 'none')) {
    const tok = /var\(--([\w-]+)\)/.exec(band.decl.background ?? '')?.[1], o1 = evalLen(band.decl['--o1']), o2 = evalLen(band.decl['--o2']);
    // each plank's polygon: a list of [x expression, y expression]
    const pointsOf = (r) => { const m = /^polygon\(\s*evenodd\s*,([\s\S]*)\)$/.exec(r?.decl['clip-path'] ?? ''); return m ? splitTop(m[1]).map((pt) => splitTop(pt.trim(), ' ')).filter((p) => p.length === 2) : null; };
    const clip = { flat: pointsOf(band), next: pointsOf(after('.gv-btn--wood.gv-btn--next:focus-visible::after')), back: pointsOf(after('.gv-btn--wood.gv-btn--back:focus-visible::after')) };
    if (tok && COLORS.has(tok) && o1 != null && o2 != null && o2 > o1 && clip.flat?.length) return { tok, rule: '.gv-btn--wood:focus-visible::after', geom: { inset: o1, w: o2 - o1 }, clip };
  }
  const rule = own ?? generic, tok = rule && (/inset 0 0 0 var\(--stroke-focus\) var\(--([\w-]+)\)/.exec(rule.decl['box-shadow'] ?? '')?.[1] ?? /var\(--stroke-focus\) solid var\(--([\w-]+)\)/.exec(rule.decl['outline'] ?? '')?.[1]);   // an older plank ring: an inset outline (the art paints over an inset shadow)
  if (!tok || !COLORS.has(tok)) { warn('bundle.css: could not read the focus ring of .gv-btn--wood (neither the ::after band, nor an inset shadow or outline); the wood ring audit pairs are skipped'); return null; }
  return { tok, rule: own ? '.gv-btn--wood:focus-visible' : ':where(.gv-btn, ...):focus-visible', geom: { inset: 0, w: stroke }, clip: null };
})();
// The wood plank's own numbers, as `.gv-btn--wood` computes them from the button height h: its end cut (--cx, --cy), and for Next and Back the tip and the notch (--arrow-tip, --cut-md).
function woodDims(h, shape) {
  const base = cssDecl('.gv-btn--wood'), arrow = cssDecl('.gv-btn--wood:is(.gv-btn--next,.gv-btn--back)'), v = { h };
  const get = (d, k, fb) => evalLen(d[k], v) ?? fb;
  return shape ? { tip: get(arrow, '--arrow-tip', h * (NUM['plank-tip'] ?? 0.5)), notch: get(arrow, '--cut-md', h * (NUM['plank-tip'] ?? 0.5)) } : { cx: get(base, '--cx', h * (NUM['plank-cut-x'] ?? 0.354)), cy: get(base, '--cy', h * (NUM['plank-cut-y'] ?? 0.234)) };
}
// The focus band of a wood button as an SVG path in the button's own box (W x H, height h): the points of bundle.css's clip-path, evaluated with the plank's numbers.
// The polygon is one closed loop (outer copy, bridge, inner copy), filled evenodd, exactly as the browser fills it.
function woodBandPath(kind, W, H, h) {
  const pts = WOOD_RING_CSS?.clip?.[kind === 'chamfer' ? 'flat' : kind]; if (!pts) return null;
  const d = woodDims(h, kind === 'chamfer' ? null : kind), o1 = WOOD_RING_CSS.geom.inset, o2 = o1 + WOOD_RING_CSS.geom.w, vars = { h, o1, o2, cx: d.cx, cy: d.cy, 'arrow-tip': d.tip, 'cut-md': d.notch };
  const ev = (ex, size) => evalLen(String(ex).replace(/(-?[\d.]+)%/g, (_, n) => `(${size} * ${+n / 100})`), vars);
  const xy = pts.map(([x, y]) => [ev(x, W), ev(y, H)]);
  if (xy.some((p) => p[0] == null || p[1] == null)) return null;
  return 'M' + xy.map(([x, y]) => `${+x.toFixed(2)} ${+y.toFixed(2)}`).join('L') + 'Z';
}

// Focus rings from bundle.css (inset box-shadow bands, outside in): [inset, width, token]
// A ring is a list of bands, outside in: [inset, width, token]. The wood plank's is one cream band, flagged 'band': it is drawn as the filled polygon of bundle.css's ::after (woodBandPath), not as a stroke.
const WOOD_RING = [[WOOD_RING_CSS?.geom.inset ?? 0, WOOD_RING_CSS?.geom.w ?? 3, WOOD_RING_CSS?.tok ?? 'on-wood', !!WOOD_RING_CSS?.clip]];
const RINGS = {
  // wood: the carved plank is brown, so the plum `focus` ring is 1.4:1 on it (and 1.0:1 on the sunset ground-deep band it sits on in this sheet).
  // The sheet draws the cream ring the wood container rule uses (:where(.gv-wood) :focus-visible); see WOOD_RING_CSS for what bundle.css draws today.
  paper: { primary: [[0, 3, 'focus']], secondary: [[0, 3, 'focus'], [3, 2, 'surface'], [5, 2, 'ink']], ghost: [[0, 3, 'focus'], [3, 2, 'surface']], 'ghost-danger': [[0, 3, 'focus'], [3, 2, 'surface']], danger: [[0, 3, 'focus'], [3, 2, 'surface']], wood: WOOD_RING },
  wood: { primary: [[0, 3, 'wood-deep'], [3, 3, 'on-wood']], secondary: [[0, 3, 'focus']], ghost: [[0, 3, 'on-wood']], 'ghost-danger': [[0, 3, 'on-wood']], danger: [[0, 3, 'focus'], [3, 2, 'surface']], wood: WOOD_RING },
};
function look(v, st, ctx, shape) {
  const wood = ctx === 'wood', pr = st === 'pressed';
  let L;
  switch (v) {
    case 'primary': L = { kind: shape ?? 'chamfer', fill: pr ? { tok: 'gold', bright: 0.94 } : 'gold', text: 'on-gold' }; break;
    case 'secondary': L = wood || shape ? { kind: shape ?? 'chamfer', fill: 'surface-sunken', text: 'ink' } : { kind: 'outline', fill: pr ? 'surface-sunken' : 'surface', stroke: 'ink', sw: 2, text: 'ink' }; break;
    case 'ghost': L = { kind: 'ghost', fill: pr ? (wood ? { tok: 'hover-tint-on-wood', over: 'wood' } : { tok: 'hover-tint', over: 'surface' }) : null, text: wood ? 'on-wood' : 'ink' }; break;
    case 'ghost-danger': L = { kind: 'ghost', fill: pr ? { tok: 'danger-tint', over: 'surface' } : null, text: 'danger' }; break;
    case 'danger': L = { kind: 'chamfer', fill: pr ? { tok: 'danger', bright: 0.9 } : 'danger', text: 'on-select' }; break;
    // The wood button draws the plank as a 3-slice (bundle.css: border-image): the flat plank, or the arrow plank that points where the button goes (Next points right, Back left: the exports are named for their notch, see MANIFEST.md)
    case 'wood': L = { kind: shape ?? 'chamfer', fill: hasBrand('derived/plank-flat.webp', WOOD_NOTE) ? { plank: shape === 'next' ? 'plank-point-right' : shape === 'back' ? 'plank-point-left' : 'plank-flat', cap: shape ? NUM['plank-cap-arrow'] : NUM['plank-cap-flat'], base: 'wood' } : 'wood', text: 'on-wood' }; break;
    default: throw new Error(`button variant ${v}`);
  }
  if (st === 'disabled') {   // never fades: a readable sunken plate (wood-deep on wood)
    const plate = wood ? 'wood-deep' : 'surface-sunken', text = wood ? 'on-wood-soft' : 'ink-muted';
    if ((v === 'ghost' || v === 'ghost-danger') && !wood) L = { kind: 'ghost', fill: null, text };
    else L = { kind: L.kind === 'outline' ? 'outline' : L.kind, fill: plate, text, ...(L.kind === 'ghost' ? {} : {}) };
  }
  L.rings = st === 'focus' ? RINGS[wood ? 'wood' : 'paper'][v === 'next' ? 'primary' : v === 'back' ? 'secondary' : v] ?? RINGS.paper.primary : [];
  return L;
}
// One button specimen. `w` fixes the width (a matrix column); otherwise it hugs its label.
function Btn(o) {
  const { label, variant = 'primary', size = 'md', state = 'default', icon, iconRight, shape, ctx = 'paper', w } = o;
  const m = { ...BTN[size], ...(o.h ? { h: o.h } : {}) }, L = look(variant, state, ctx, shape), gap = BTN.gap;
  const kids = [];
  if (state === 'loading') kids.push(Ic('spinner', 16, L.text)); else if (icon) kids.push(Ic(icon, 16, L.text));
  const fillW = w === 'fill';
  kids.push(T(label, m.style, L.text, { upper: true, ...(o.balance ? { balance: true } : {}), ...(fillW ? { w: 'fill', align: 'center' } : {}) }));
  if (iconRight && state !== 'loading') kids.push(Ic(iconRight, 16, L.text));
  const name = o.name ?? `Button / ${variant}${shape ? ' ' + shape : ''} / ${state} / ${size}`;
  const base = { name, flex: 'row', justify: 'center', items: 'center', h: m.h, gap, w };
  const ringPlates = (kind, a) => L.rings.map(([inset, rw, tok, band], i) => ({ kind, a, ring: { inset, w: rw, tok, ...(band ? { band: { h: m.h } } : {}) }, name: band ? 'Focus ring (band)' : `Focus ring ${i + 1}` }));
  // The Label frame repeats the plate color so the text has a solid fill behind it (the lint, and a reader of the file, find the
  // contrast there). It is only needed when the label would not pass on the paper behind the plate.
  const behind = o.bg ?? 'surface', direct = ctx === 'paper' && !(L.fill && (L.fill.img || L.fill.plank)) && THEMES.every((th) => contrast(colorInfo(L.text, th).c, colorInfo(behind, th).c) >= 4.5);
  if (['chamfer', 'next', 'back'].includes(L.kind)) {
    // the wood plank has its own cut and arrow numbers (bundle.css: .gv-btn--wood computes them from the button's height), the other buttons the cut tokens
    const wd = variant === 'wood' ? woodDims(m.h, L.kind === 'chamfer' ? null : L.kind) : null;
    const a = wd ?? (L.kind === 'chamfer' ? { cx: m.cx, cy: m.cy } : { tip: NUM['arrow-tip'], notch: NUM['cut-md'] });
    const wp = variant === 'wood' && L.kind !== 'chamfer' ? (cssDecl(`.gv-btn.gv-btn--wood.gv-btn--${L.kind}`).padding ? splitTop(cssDecl(`.gv-btn.gv-btn--wood.gv-btn--${L.kind}`).padding, ' ').map((x) => evalLen(x, { h: m.h })) : null) : null;   // top right bottom left, from the plank's own padding rule
    const pads = wp && wp.length === 4 && wp.every((x) => x != null) ? { pl: wp[3], pr: wp[1] } : L.kind === 'next' ? { pl: BTN.next.pl, pr: BTN.next.pr } : L.kind === 'back' ? { pl: BTN.back.pl, pr: BTN.back.pr } : { px: m.px };
    const img = L.fill && (L.fill.img || L.fill.plank);
    // The plate is a vector behind the label, so the text's parent has no fill the contrast lint can read. Where the label would not pass on paper, the button frame repeats the plate color as a fill that paints nothing (opacity 0): the contrast chain is real and there is no extra Label layer.
    return F({ ...base, ...pads, plate: [{ kind: L.kind, a, fill: L.fill }, ...ringPlates(L.kind, a)], ...(direct ? {} : { fill: img ? 'wood' : L.fill, fillOp: 0 }) }, kids);
  }
  // outline and ghost: a radius-sm control (a clip-path would cut the outline); the frame itself is the plate
  const props = { ...base, px: m.px, rounded: RSM, fill: L.fill ?? 'none', stroke: L.stroke, sw: L.sw, plate: ringPlates('rrect', { r: RSM }) };
  return F(props, kids);
}
// .gv-link: caps text link, 48px tall, select color
function LinkBtn(o) {
  const { label, icon, state = 'default', w } = o, pr = state === 'pressed', dis = state === 'disabled';
  const color = dis ? 'ink-muted' : 'select';
  return F({ name: `Link button / ${state}`, flex: 'row', items: 'center', gap: sp(2), h: TAP, px: sp(3), w, rounded: RSM, fill: pr ? { tok: 'select-tint', over: 'surface' } : 'none',
    plate: state === 'focus' ? [{ kind: 'rrect', a: { r: RSM }, ring: { inset: 0, w: 3, tok: 'focus' }, name: 'Focus ring' }] : [] },
    icon ? Ic(icon, 16, color) : null, T(label, 'caps', color, { upper: true }));
}

// ------------------------------------------------------------------------------------------------------ kit: paper, badges, chips
// Cards are poster paper: surface fill, hairline rule, the hard ledge below. (Bevelled corners are CSS corner-shape; the
// documented fallback is radius-md, which a frame fill can carry; a chamfer plate would break the text contrast chain.)
function Card(o = {}, ...c) {
  return F({ name: o.name ?? 'Card', w: o.w ?? 'fill', flex: 'col', gap: o.gap ?? sp(3), ...(o.px != null || o.py != null ? { px: o.px, py: o.py } : { p: o.pad ?? sp(5) }), fill: o.fill ?? 'surface', rounded: RMD, stroke: 'line', sw: 1, fx: o.fx === null ? undefined : o.fx ?? ['shadow-ledge'], h: o.h,
    plate: o.rule === false ? [] : [{ kind: 'rrect', a: { r: 2 }, ring: { inset: 5, w: 1, tok: 'line' }, name: 'Printed rule' }],
    accent: o.accent }, c);
}
const eyebrow = (text, color = 'ink-soft', p = {}) => T(text, 'eyebrow', color, { upper: true, ...p });
const specLabel = (text) => eyebrow(text, 'ink-soft', { spec: true, w: 'fill' });   // a label written for the spec (which state a specimen is), not UI copy
const BADGE_TONES = { neutral: ['surface-sunken', 'ink-soft'], pro: [{ tok: 'pro-tint', over: 'surface' }, 'pro'], general: [{ tok: 'general-tint', over: 'surface' }, 'general'], brand: [{ tok: 'select-tint', over: 'surface' }, 'select'], warn: [{ tok: 'warn-tint', over: 'surface' }, 'warn'], danger: [{ tok: 'danger-tint', over: 'surface' }, 'danger'], success: [{ tok: 'success-tint', over: 'surface' }, 'success'] };
function Badge(label, tone = 'neutral', o = {}) {
  const nm = (o.name ?? label).replace(/\bTable\b/i, 'code');   // layer names avoid words the lint reads as controls ("Table" -> "tab")
  if (o.stamp) {   // rubber stamp: an outline in the stamp color, never a fill
    const [, fg] = BADGE_TONES[tone];
    return F({ name: `Stamp / ${nm}`, flex: 'row', items: 'center', h: sp(6), px: sp(2), rounded: RSM, stroke: fg, sw: 2, rotate: -2, fill: o.paper ? 'surface' : undefined }, T(label, 'eyebrow', fg, { upper: true }));
  }
  const [bg, fg] = BADGE_TONES[tone];
  return F({ name: `Badge / ${nm}`, flex: 'row', items: 'center', gap: sp(1), h: sp(6), px: sp(2), rounded: NUM['radius-pill'], fill: bg }, o.icon ? Ic(o.icon, 12, fg) : null, o.mono ? T(label, 'caps', fg, { upper: true }) : T(label, 'label', fg));
}
function Chip(label, o = {}) {   // ToggleChip (a nomination or prize) and ChoiceChips (a radio dot)
  const { selected = false, disabled = false, focus = false, radio = false, tag } = o;
  const base = selected ? { tok: 'select-tint', over: 'surface' } : disabled ? 'surface' : 'surface-sunken';
  const stroke = selected ? 'select' : disabled ? 'line' : 'line-strong', sw = selected ? 2 : 1, color = selected ? 'select' : disabled ? 'ink-soft' : 'ink';
  const mark = radio
    ? F({ name: 'Option dot', w: 16, h: 16, flex: 'row', justify: 'center', items: 'center', rounded: 9999, fill: selected ? 'select' : 'surface', stroke: selected ? undefined : 'line-strong', sw: 2 }, selected ? El({ name: 'Dot center', w: 6, h: 6, fill: 'surface' }) : null)
    : Ic(selected ? 'check' : 'plus', 16, color, { sw: selected ? 2.5 : 2 });
  const rings = focus ? (selected ? [[0, 3, 'focus'], [3, 2, 'surface'], [5, 2, 'select']] : [[0, 3, 'focus']]).map(([inset, w, tok], i) => ({ kind: 'rrect', a: { r: RSM }, ring: { inset, w, tok }, name: `Focus ring ${i + 1}` })) : [];
  return F({ name: `Chip / ${label}${selected ? ' selected' : ''}${disabled ? ' disabled' : ''}${focus ? ' focus' : ''}`, flex: 'row', items: 'center', gap: sp(2), h: TAP, pl: sp(3), pr: sp(4), rounded: RSM, fill: base, stroke, sw, plate: rings },
    mark, T(label, 'body-sm', color, { weight: 600 }),
    tag ? F({ name: 'Badge / suggested', flex: 'row', items: 'center', px: sp(1), rounded: RSM, fill: 'surface', stroke: 'select', sw: 1 }, T(tag, 'eyebrow', 'select', { upper: true })) : null);
}
// A text field of the table-code kind (Oswald 24, caps) or a plain text field.
function Field(o) {
  const { value = '', placeholder, state = 'default', w = 'fill', h = TAP + sp(2), kind = 'code' } = o;   // default | focus | error | disabled
  const dis = state === 'disabled', err = state === 'error', foc = state === 'focus';
  const fill = dis ? 'surface' : 'surface-sunken';
  const stroke = err ? 'danger' : dis ? 'line' : 'line-strong', sw = err ? 2 : 1;
  const color = dis ? 'ink-soft' : value ? 'ink' : 'ink-soft';
  const shown = value || placeholder || '';
  const txt = !shown ? null : kind === 'code' ? T(shown, 'title', color, { ls: +(TYPE.eyebrow.em * TYPE.title.size).toFixed(2), upper: true, w: 'fill', name: 'Field text' }) : T(shown, 'body', color, { w: 'fill', name: 'Field text' });
  return F({ name: `Field / ${kind} / ${state}`, flex: 'row', items: 'center', w, h, px: sp(4), rounded: RSM, fill, stroke, sw, plate: foc ? [{ kind: 'rrect', a: { r: RSM }, ring: { inset: 0, w: 3, tok: 'focus' }, name: 'Focus ring' }] : [] }, txt);
}
const helpLine = (text, tone) => row({ name: 'Help', items: 'start', gap: sp(1), w: 'fill' }, tone ? F({ name: 'Glyph box', flex: 'row', pt: 2 }, Ic('alert', 14, tone)) : null, T(text, 'label', tone ?? 'ink-muted', { weight: tone ? 700 : 500, w: 'fill' }));
const alertBox = (tone, title, body, acts, icon) => F({ name: `Alert / ${tone}`, w: 'fill', flex: 'col', gap: sp(1), px: sp(4), py: sp(3), fill: 'surface', rounded: RMD, stroke: 'line', sw: 1, fx: ['shadow-ledge'], accent: { tok: tone === 'warn' ? 'warn' : 'danger' } },
  row({ w: 'fill', gap: sp(3), items: 'start' }, Ic(icon ?? (tone === 'warn' ? 'map' : 'alert'), 18, tone === 'warn' ? 'warn' : 'danger'), T(title, 'body-sm', tone === 'warn' ? 'warn' : 'danger', { weight: 600, w: 'fill' })),
  body ? F({ name: 'Alert body', w: 'fill', flex: 'row', pl: sp(8) }, T(body, 'body-sm', 'ink-soft', { weight: 400, w: 'fill' })) : null,
  acts ? F({ name: 'Alert actions', w: 'fill', flex: 'row', gap: sp(2), pl: sp(8), pt: sp(2) }, acts) : null);
function Toast(message, tone = 'success', icon) {
  const t = { success: 'success', warn: 'warn', danger: 'danger' }[tone];
  return F({ name: `Toast / ${tone}`, w: 'fill', flex: 'row', items: 'center', gap: sp(2), px: sp(4), py: sp(3), fill: 'surface', rounded: RMD, stroke: 'line', sw: 1, fx: ['shadow-ledge-lg'], accent: { tok: t } },
    Ic(icon ?? (tone === 'success' ? 'check' : 'alert'), 16, t), T(message, 'body-sm', 'ink', { weight: 600, w: 'fill' }));
}

// ------------------------------------------------------------------------------------------------------ kit: wood, chrome, signposts
// Wide wood surfaces (app bar, action bar, wood rows) are bundle.css's --gv-wood: wood-hi at the top, wood from 35% to 70%, wood-deep at the bottom (the faint grain lines are left out). Buttons and the inline Wayfinding sign use the planks.
const WOOD_GRAD = [['wood-hi', 0], ['wood', 0.35], ['wood', 0.7], ['wood-deep', 1]];
const woodFill = () => ({ grad: WOOD_GRAD });
// Where the lockup goes when assets/brand/hackillinois-lockup.svg is missing: a labelled box, never a typeset wordmark (AGENTS.md rule 2).
const LogoPlaceholder = () => F({ name: 'Placeholder / hackillinois-lockup.svg', flex: 'row', items: 'center', h: sp(8), px: sp(2), fill: 'surface-sunken', stroke: 'line-strong', sw: 1 }, T('hackillinois-lockup.svg · placeholder', 'label', 'ink-soft', { weight: 500 }));
// The paper tags that take the wordmark's place in the app bar (JudgeShell): Recording (red, with its time), Offline, and "n not sent" once back online. One at a time, plus the Recording tag beside Offline.
const RecTag = (time, paused = false) => F({ name: paused ? 'Recording tag / paused' : 'Recording tag', flex: 'row', items: 'center', gap: sp(2), h: TAP - sp(1), px: sp(3), rounded: RSM, fill: 'surface', stroke: paused ? 'line-strong' : 'rec', sw: 2 },
  El({ name: 'Recording dot', w: sp(2), h: sp(2), fill: paused ? 'ink-muted' : 'rec' }), T(paused ? 'Recording paused' : 'Recording', 'caps', paused ? 'ink-soft' : 'rec', { upper: true }), T(time, 'caps', 'ink', { upper: true }));
// Beside the Recording tag the Offline tag has room for one line only: a container query on its own width keeps "Offline." and drops the count (it is the rule in bundle.css: the line that fits whole, never an ellipsis).
const OfflineTag = (n, narrow = false) => F({ name: narrow ? 'Offline tag / narrow' : 'Offline tag', flex: 'row', items: 'center', gap: sp(2), px: sp(3), py: sp(1), h: TAP - sp(1), rounded: RSM, fill: { tok: 'warn-tint', over: 'surface' }, accent: { tok: 'warn' } },
  ...(narrow ? [T('Offline.', 'label', 'warn', { weight: 700 })] : [Ic('alert', 14, 'warn'), col({}, T('Offline.', 'label', 'warn', { weight: 700 }), T(`${n}${S(' saved here')}`, 'label', 'ink', { weight: 600 }))]));
const UnsentTag = (n) => F({ name: 'Unsent tag', flex: 'row', items: 'center', gap: sp(2), px: sp(3), py: sp(1), h: TAP, rounded: RSM, fill: { tok: 'warn-tint', over: 'surface' }, accent: { tok: 'warn' } },
  Ic('alert', 14, 'warn'), col({}, T(`${n} not sent`, 'label', 'warn', { weight: 700 }), T(S('Tap to retry'), 'label', 'ink-soft', { weight: 500 })));
const skyStripe = () => row({ name: 'Sky stripe', w: 'fill', gap: 0 }, ['sky-1', 'sky-2', 'sky-3', 'sky-4'].map((t) => Rc({ name: t, w: 'fill', h: sp(1), fill: t })));
// JudgeShell's top: the wood bar (the 2027 lockup at mark-h, or one of the tags, and My notes), then the four-colour sky stripe when no timer follows.
function AppBar(o = {}) {
  const lockup = hasBrand('hackillinois-lockup.svg') ? Svg('hackillinois-lockup.svg', { w: Math.round(((NUM['mark-h'] ?? 40) * 221) / 73), name: 'HackIllinois lockup' }) : LogoPlaceholder();
  const tag = o.offline != null ? OfflineTag(o.offline, !!o.recording) : o.unsent != null ? UnsentTag(o.unsent) : null;
  const lead = o.recording ? row({ name: 'App bar lead', gap: sp(2) }, RecTag(o.recording, o.paused), tag) : tag ?? lockup;
  const bar = F({ name: 'App bar', w: 'fill', flex: 'row', justify: 'between', items: 'center', h: TAP + sp(2), pl: sp(4), pr: sp(2), fill: woodFill(), fx: ['shadow-plank-edge'] },
    lead, o.notes === false ? null : o.back ? Btn({ label: 'Back', variant: 'secondary', shape: 'back', ctx: 'wood' }) : Btn({ label: 'My notes', variant: 'ghost', icon: 'notes', ctx: 'wood', name: 'Button / ghost / My notes' }));
  return o.stripe ? col({ name: 'App bar and sky stripe', w: 'fill', gap: 0 }, bar, skyStripe()) : bar;
}
function ActionBar(...c) { return F({ name: 'Action bar', w: 'fill', flex: 'row', items: 'center', gap: sp(2), px: sp(4), py: sp(2), fill: woodFill(), fx: ['shadow-plank-edge-up'] }, c); }
// Hero signpost, drawn the way bundle.css does it: the real signpost art (art-signpost, 718 x 1135) at sign-w wide, five tan boards on a post, lettered with live
// text in ink-sign. Every board's place, size and tilt is the percentage in .gv-sign (read from the same numbers here); CSS tilts a box about its centre and so does the
// sheet. The lettering is text, never part of the picture. Without the art the sign is a labelled placeholder (AGENTS.md rule 2).
const SIGN_W = NUM['sign-w'] ?? 280, SIGN_H = +((SIGN_W * 1135) / 718).toFixed(1);
const SIGN_BOARDS = { k: [8.4, 3.5, 83.2, 13.7, 1.8], noun: [26.5, 22, 55.7, 12.3, -3.6], room: [20.9, 37.4, 68.2, 14.5, 2.5], map: [20.9, 56.4, 64, 14.1, -6.3], board: [13.9, 77.8, 72.4, 17.5, 2] };
// The fit rule (bundle.css .gv-sign__fit, tokens sign-glyph / sign-fit-min / sign-fit-chars): the noun and the value are one line set at min(their type size, the board's width / (characters x
// sign-glyph)); a value past sign-fit-chars drops to title-sm on two lines. Counted in characters, never guessed from the width.
const SIGN_GLYPH = NUM['sign-glyph'] ?? 0.62, SIGN_FIT_MIN = NUM['sign-fit-min'] ?? 16, SIGN_FIT_CHARS = NUM['sign-fit-chars'] ?? 12;
const signFit = (base, boxW, n, floor = 0) => Math.max(floor, Math.min(base, +(boxW / (Math.max(1, n) * SIGN_GLYPH)).toFixed(1)));
// o: label (top board), noun ("Table" / "Room"), room (the value), map (the link's words, or none), board + boardLabel (the last board, blank without them), hint (under the sign).
// o.state: 'ready' (the art, over the sign-scrim glow) | 'failed' (the art did not arrive, or is still loading after dur-delay: the same five boxes become flat wood plates lettered in cream, so the table is readable at any moment).
function Signpost(o) {
  const ready = (o.state ?? 'ready') === 'ready' && hasBrand('derived/signpost.webp'), ink = ready ? 'ink-sign' : 'on-wood', fx = ready ? undefined : ['shadow-sign'];
  const glow = COLORS.has('sign-scrim');
  const box = (key, name, ...c) => {
    const [l, t, w, h, deg] = SIGN_BOARDS[key], bw = +((SIGN_W * w) / 100).toFixed(1), bh = +((SIGN_H * h) / 100).toFixed(1), cx = NUM['cut-sm'] ?? 6;
    const kids = [ready && glow ? Rc({ name: 'Sign glow (sign-scrim, blurred)', w: bw, h: bh, x: 0, y: 0, layoutIgnore: true, fill: 'sign-scrim', fx: [{ blur: sp(2) * 2, tok: 'sign-scrim' }] }) : null, ...c];
    return F({ name, w: bw, h: bh, x: +((SIGN_W * l) / 100).toFixed(1), y: +((SIGN_H * t) / 100).toFixed(1), rotate: deg, flex: key === 'board' ? 'col' : 'row', justify: 'center', items: 'center', gap: key === 'map' ? sp(2) : 0, fill: ready ? 'rope' : 'wood', fillOp: 0,   // the tan of the art (rope) or the plate (wood), for the contrast chain

      plate: ready ? [] : [{ kind: 'chamfer', a: { cx, cy: +(cx * 0.75).toFixed(2) }, fill: woodFill() }] }, kids);
  };
  const bw = (key) => (SIGN_W * SIGN_BOARDS[key][2]) / 100, nNoun = Array.from(`${o.noun ?? 'Table'} `).length, nRoom = Array.from(String(o.room).trim()).length || 1, longRoom = nRoom > SIGN_FIT_CHARS;
  const noun = T(o.noun ?? 'Table', 'title', ink, { upper: true, ls: +(TYPE.eyebrow.em * TYPE.title.size).toFixed(2), align: 'center', w: 'fill', fx, size: signFit(TYPE.title.size, bw('noun'), nNoun, SIGN_FIT_MIN) });
  const value = longRoom ? T(o.room, 'title-sm', ink, { align: 'center', w: 'fill', fx }) : T(o.room, 'sign', ink, { align: 'center', w: 'fill', fx, size: signFit(TYPE.sign.size, bw('room'), nRoom), lineHeight: TYPE.sign.line });
  const bigBoard = o.board && Array.from(o.board).length > 14;
  const boards = [
    box('k', 'Board / label', T(o.label, 'caps', ink, { upper: true, align: 'center', w: 'fill', balance: true, fx })),
    box('noun', 'Board / noun', noun),
    box('room', 'Board / value', value),
    o.map ? box('map', 'Board / floor plan link', Ic('map', 16, ink), T(o.map, 'caps', ink, { upper: true, fx })) : (ready ? null : box('map', 'Board / floor plan (blank plate)')),
    o.board ? box('board', 'Board / look for', o.boardLabel ? T(o.boardLabel, 'caps', ink, { upper: true, align: 'center', fx }) : null, T(o.board, bigBoard ? 'title-sm' : 'title', ink, { align: 'center', w: 'fill', fx, ...(bigBoard ? { clamp: 2 } : {}) })) : (ready ? null : box('board', 'Board / blank plate')),
  ];
  const art = ready ? F({ name: 'Signpost art (brand export)', w: SIGN_W, h: SIGN_H, fill: { img: 'derived/signpost.webp', mode: 'FILL' } }, boards)
    : F({ name: 'Signpost without art (flat wood plates)', w: SIGN_W, h: SIGN_H }, Rc({ name: 'Post', w: sp(4), h: SIGN_H - sp(8), x: (SIGN_W - sp(4)) / 2, y: sp(4), fill: 'wood-deep' }), boards);
  return col({ name: `Signpost${ready ? '' : ' / no art'}`, w: 'fill', items: 'center', gap: sp(3) }, art, o.hint ? T(o.hint, 'body-sm', 'on-ground-soft', { weight: 500, align: 'center', w: 232 }) : null);
}
const LinkOnWood = (label, icon) => F({ name: 'Link button / on wood', flex: 'row', items: 'center', gap: sp(2), h: TAP, px: sp(3) }, Ic(icon, 16, 'on-wood'), T(label, 'caps', 'on-wood', { upper: true }));
// Inline Wayfinding: the arrow plank that points right (the export named wood-plank-left; see MANIFEST.md), cut to size as a 3-slice, a brass pin, the room and table, Map.
const PLANK_H = TAP + sp(2), PLANK_TIP = PLANK_H * (NUM['plank-tip'] ?? 0.5);
function WayPlank(o) {
  return F({ name: 'Wayfinding plank', w: 'fill', h: PLANK_H, flex: 'row', items: 'center', gap: sp(3), pl: PLANK_TIP + sp(1), pr: PLANK_TIP / 2 + sp(2), py: sp(1), plate: [{ kind: 'way', a: { tip: PLANK_TIP }, fill: hasBrand('derived/plank-point-right.webp', WOOD_NOTE) ? { plank: 'plank-point-right', cap: NUM['plank-cap-arrow'], base: 'wood-deep' } : 'wood-deep' }] },
    F({ name: 'Pin disc', flex: 'row', justify: 'center', items: 'center', w: TAP - sp(3), h: TAP - sp(3), rounded: 9999, fill: 'brass', stroke: 'wood-deep', sw: 2 }, Ic('pin', 18, 'wood-deep')),
    col({ w: 'fill', gap: 0 }, T(o.k, 'eyebrow', 'on-wood', { upper: true, w: 'fill', clamp: 1 }), T(o.v, 'title', 'on-wood', { w: 'fill', clamp: 1 })),   // .gv-way__k and __v are nowrap with an ellipsis: one line each, cut on the string
    LinkOnWood('Map', 'map'));
}
// TableProgress: one sheriff-star medallion per table (filled = judged, half = the table you are at, outline = still to come; the real art, derived/star-*.webp)
// and the count in words beside them, on a paper tag or, on the painted ground, a plum plaque (tone="plaque").
function TableProgress(o) {
  const { total, done, current = false, tone = 'paper', label } = o, ss = NUM['star-size'] ?? 24;
  const stars = Array.from({ length: total }, (_, i) => { const st = i < done ? 'filled' : current && i === done ? 'half' : 'outline', f = `derived/star-${st}.webp`; return hasBrand(f, 'its star is left out') ? Rc({ name: `Star ${i + 1} / ${st}`, w: ss, h: ss, fill: { img: f, mode: 'FIT' } }) : null; });
  const plaque = tone === 'plaque', text = T(label ?? `${done} of ${total} ${total === 1 ? 'table' : 'tables'}`, 'numeral', plaque ? 'gold-on-ground' : 'ink-soft', { upper: true, ls: +(TYPE.caps.em * TYPE.numeral.size).toFixed(2) });
  return F({ name: `Progress / ${tone} / ${done} of ${total}${current ? ' (current)' : ''}`, flex: 'row', items: 'center', gap: sp(3), px: sp(3), py: plaque ? sp(1) : sp(2), rounded: plaque ? RSM : RMD, fill: plaque ? 'ground-deep' : 'surface', stroke: plaque ? undefined : 'line', sw: 1, fx: plaque ? undefined : ['shadow-ledge'] },
    row({ name: 'Stars', gap: sp(1) }, stars), text);
}
// A garland divider (derived/garland-cream.webp on the painted ground, garland-brown.webp on paper) across a column of width w.
function GarlandArt(tone, w) {
  const f = tone === 'paper' ? 'derived/garland-brown.webp' : 'derived/garland-cream.webp', sz = pngSize(f);
  return hasBrand(f, 'the garland divider is left out') && sz ? Rc({ name: `Garland / ${tone}`, w, h: Math.round((w * sz[1]) / sz[0]), fill: { img: f, mode: 'FIT' } }) : null;
}
// A prop (derived/<name>.webp), sized by height (prop-h 112, or prop-h-sm 72), width from the art's own ratio.
function PropArt(name, small = false) {
  const f = `derived/${name}.webp`, sz = pngSize(f), h = small ? NUM['prop-h-sm'] ?? 72 : NUM['prop-h'] ?? 112;
  return hasBrand(f, 'its prop is left out') && sz ? Rc({ name: `Prop / ${name}`, w: Math.round((h * sz[0]) / sz[1]), h, fill: { img: f, mode: 'FIT' } }) : null;
}
// The sheriff star of "Round 1 complete" (.gv-star): a brass six-point star with a gold disc and a wood-deep ring, the check on it. CSS draws it (clip-path, no art exists), so the sheet draws it too.
const STAR_POINTS = [[50, 0], [61, 31], [93, 25], [72, 50], [93, 75], [61, 69], [50, 100], [39, 69], [7, 75], [28, 50], [7, 25], [39, 31]];   // clip-path of .gv-star in bundle.css, in percent
const STAR_PATH = (D) => 'M' + STAR_POINTS.map(([x, y]) => `${+((x * D) / 100).toFixed(1)} ${+((y * D) / 100).toFixed(1)}`).join('L') + 'Z';
function StarSeal(icon = 'check') {
  const D = sp(12) * 2, d = STAR_PATH(D), ring = D * 0.4;
  return F({ name: 'Sheriff star seal', w: D, h: D, flex: 'row', justify: 'center', items: 'center' },
    { t: 'path', p: { name: 'Sheriff star polygon', d, w: D, h: D, fill: 'brass', x: 0, y: 0, layoutIgnore: true, fx: ['shadow-star'] }, c: [] },
    F({ name: 'Disc', w: ring, h: ring, flex: 'row', justify: 'center', items: 'center', rounded: 9999, fill: 'gold', stroke: 'wood-deep', sw: 2 }, Ic(icon, 24, 'wood-deep', { sw: 3 })));
}

// ------------------------------------------------------------------------------------------------------ kit: timer, notes, nominations, project poster
const TIMER_TONES = { calm: ['on-wood-soft', 'on-wood', 'gold'], warn: ['gold-on-ground', 'gold-on-ground', 'gold'], urgent: ['alert-on-ground', 'alert-on-ground', 'alert-fill'], over: ['alert-on-ground', 'alert-on-ground', 'alert-fill'] };
function TimerStrip(o = {}) {   // wood-deep band: label, tabular time and the track; the tone changes at 10 min, 2 min and time up
  const tone = o.tone ?? 'calm', [lab, tim, fill] = TIMER_TONES[tone], frac = o.frac ?? 0.62;
  const time = o.time ?? { calm: '01:14:48', warn: '09:48', urgent: '01:12', over: '00:00' }[tone];
  return F({ name: `Timer band / ${tone}`, w: 'fill', flex: 'col', gap: sp(1), pt: sp(1), pb: sp(2), px: sp(4), fill: 'wood-deep' },
    row({ justify: 'between', w: 'fill' }, row({ gap: sp(2) }, El({ name: 'Live dot', w: sp(2), h: sp(2), fill: lab }), T(tone === 'over' ? 'Time is up' : 'Judging ends in', 'eyebrow', lab, { upper: true })), tone === 'over' ? null : T(time, 'timer', tim)),
    F({ name: 'Timer track', w: 'fill', h: sp(1), rounded: NUM['radius-pill'], fill: 'ground-track', clip: true }, Rc({ name: 'Timer fill', w: Math.round(358 * (tone === 'over' ? 0 : frac)), h: sp(1), fill })),
    tone === 'over' ? row({ name: 'Time is up box', w: 'fill', gap: sp(2), px: sp(3), py: sp(2), fill: 'surface', rounded: RSM }, Ic('clock', 14, 'danger'), T('Finish this project, then cast your last vote.', 'body-sm', 'danger', { weight: 600, w: 'fill' })) : null);
}
const STATUS_LINE = { idle: null, saved: ['check', 'Saved', 'success'], saving: [null, 'Saving…', 'ink-soft'], local: ['check', 'Saved on this phone', 'success'], error: ['alert', 'Not saved', 'danger'] };
function NotesCard(state, text) {   // NotesField: card, autosave status, 16px text area
  const st = STATUS_LINE[state === 'locked' ? 'idle' : state === 'typed' ? 'saved' : state === 'focus' ? 'idle' : state] ?? null;
  const dis = state === 'locked', foc = state === 'focus', filled = ['typed', 'saved', 'local', 'error', 'saving', 'focus'].includes(state);
  const body = filled ? (text ?? 'Live demo worked. Routing recovered about 3 s after a node was pulled.') : 'What stood out? Did the demo work? Technical depth?';
  const status = st ? row({ name: 'Status', gap: sp(1) }, st[0] ? Ic(st[0], 12, st[2]) : null, T(st[1], 'label', st[2], { weight: 600 }), state === 'error' ? T('·', 'label', 'danger') : null, state === 'error' ? T('Retry', 'caps', 'danger', { upper: true }) : null) : null;
  return Card({ name: `NotesField / ${state}`, gap: sp(3) },
    row({ w: 'fill', justify: 'between' }, row({ gap: sp(2) }, Ic('notes', 20, 'select'), T('Private notes', 'body-strong', 'ink')), status),
    F({ name: `Notes field / ${state}`, w: 'fill', h: sp(12) * 2, flex: 'col', py: sp(3), px: sp(4), rounded: RSM, fill: dis ? 'surface' : 'surface-sunken', stroke: foc ? 'focus' : dis ? 'line' : 'line-strong', sw: foc ? 3 : 1 },
      T(body, 'body', filled && !dis ? 'ink' : 'ink-soft', { w: 'fill' })),
    dis ? row({ w: 'fill', gap: sp(1), items: 'start' }, Ic('lock', 12, 'ink-muted'), T(S('Check the table first: scan its placard or type its code.'), 'label', 'ink-muted', { w: 'fill' })) : null);
}
function SelectField(label, state = 'default', o = {}) {   // .gv-select: 36px admin select, chevron at the right; phone: 16px text and a 48px target (the max-width 600px rule)
  const dis = state === 'disabled', foc = state === 'focus', ph = !!o.phone, pd = cssPhone('.gv-select');
  const h = ph ? evalLen(pd['min-height']) ?? TAP : css('.gv-select', 'min-height', TAP - sp(3)), style = ph && /type-body\)/.test(pd.font ?? '') ? 'body' : 'body-sm';
  if (ph && !pd['min-height']) warn('bundle.css: the .gv-select phone rule (max-width 600px) is not readable, using 48px and 16px text');
  return F({ name: `Select / ${state}${ph ? ' / phone' : ''}`, w: 'fill', h, flex: 'row', items: 'center', justify: 'between', pl: sp(3), pr: sp(3), rounded: RSM, fill: dis ? 'surface' : 'surface-sunken', stroke: foc ? 'focus' : dis ? 'line' : 'line-strong', sw: foc ? 3 : 1 },
    T(label, style, dis ? 'ink-soft' : 'ink'), Ic('chevron', 16, dis ? 'ink-soft' : 'ink'));   // the token's own weight: body 400, body-sm 500
}
function ProjectPoster(o = {}) {   // ProjectHeader: path badge, track, ruled eyebrow ("Now judging" in the prototype, else "Table A12"), name, tagline, and the location row unless the screen hides it
  const eb = o.eyebrow ?? `Table ${NM.table}`;
  return Card({ name: 'ProjectHeader', gap: sp(2) },
    row({ w: 'fill', justify: 'center', gap: sp(2) }, PathBadge('pro'), Badge(`${NM.track} track`, 'neutral', { icon: 'flag' })),
    row({ name: 'Ruled eyebrow', w: 'fill', gap: sp(3), pt: sp(2), items: 'center' }, Rc({ name: 'Rule', w: 'fill', h: 1, fill: 'line-strong' }), T(eb, 'numeral', 'ink-soft', { upper: true, font: FAMILY.western, ls: +(TYPE.eyebrow.em * 14).toFixed(2) }), Rc({ name: 'Rule', w: 'fill', h: 1, fill: 'line-strong' })),
    T(NM.name, 'display', 'ink', { align: 'center', w: 'fill', balance: true }), o.compact ? null : T(NM.tagline, 'body', 'ink-soft', { align: 'center', w: 'fill' }),
    o.meta === false ? null : row({ w: 'fill', justify: 'center', gap: sp(3) }, row({ gap: sp(1) }, Ic('table', 13, 'ink-muted'), T(`Table ${NM.table}`, 'caps', 'ink-muted', { upper: true })), row({ gap: sp(1) }, Ic('pin', 13, 'ink-muted'), T(`Room ${NM.room}`, 'caps', 'ink-muted', { upper: true }))));
}
// PathBadge: Pro or General, the one path word on every card (never "track").
const PathBadge = (path) => Badge(path === 'pro' ? 'Pro' : 'General', path === 'pro' ? 'pro' : 'general', { name: `PathBadge / ${path === 'pro' ? 'Pro' : 'General'}` });
// Disclosure: a closed (or open) 48px row on paper, an icon, the title, a meta word and a chevron.
function DisclosureRow(icon, title, meta, body) {
  const head = row({ name: 'Disclosure head', w: 'fill', gap: sp(3), h: TAP, items: 'center' }, Ic(icon, 20, 'select'), T(title, 'body-strong', 'ink', { w: 'fill' }), meta ? T(meta, 'eyebrow', 'ink-soft', { upper: true }) : null, Ic('chevron', 20, 'ink'));
  return F({ name: `Disclosure / ${title}`, w: 'fill', flex: 'col', px: sp(4), fill: 'surface', rounded: RMD, stroke: 'line', sw: 1, fx: ['shadow-ledge'] }, head, body ? F({ name: 'Disclosure body', w: 'fill', flex: 'col', pb: sp(4) }, T(body, 'body-sm', 'ink-soft', { weight: 400, w: 'fill' })) : null);
}
const PRIZES = ['Best UI/UX', 'Most Creative', 'Best Social Impact', 'Most Useless', 'Most Popular'];
function NominationCard(selected = ['Most Creative']) {
  return Card({ name: 'NominationPicker', gap: sp(3) }, row({ w: 'fill', justify: 'between' }, row({ gap: sp(2) }, Ic('star', 20, 'select'), T('Nominate for prizes', 'body-strong', 'ink')), T(selected.length ? `${selected.length}${S(' nominated')}` : S('Optional'), 'eyebrow', 'ink-soft', { upper: true })),
    row({ w: 'fill', gap: sp(2), wrap: true, rowGap: sp(2) }, [...PRIZES, 'Modal'].map((p) => Chip(p, { selected: selected.includes(p) }))));
}

// ------------------------------------------------------------------------------------------------------ canonical data (see the task's dataset)
const NM = { name: 'NeuralMesh', table: 'A12', room: '4217', team: ['Ana Ruiz', 'Dev Patel', 'Kim Lee'], path: 'Pro', tagline: 'Self-healing P2P mesh networking with RL routing.', track: 'Modal', loc: 'Siebel Center, 4th floor', repo: 'github.com/neuralmesh/core', commits: 48, description: 'A self-organizing peer-to-peer mesh network powered by reinforcement learning. Nodes reroute traffic around failures with zero central coordination.' };
const ECO = { name: 'EcoLens', table: 'A17', path: 'Pro', tagline: 'Carbon footprint of anything you point your camera at.' };
const firstNames = (team) => team.map((n) => n.split(' ')[0]);
const spinnerLine = (n, w) => Rc({ name: `Skeleton line ${n}`, w, h: sp(4), rounded: RSM, fill: 'surface-sunken' });

// ------------------------------------------------------------------------------------------------------ kit: judge components
function Sheet(o, ...c) {   // bottom sheet: rope handle, title, lede, content, pinned actions
  return F({ name: o.name ?? 'Sheet', w: o.w ?? 'fill', flex: 'col', gap: sp(3), px: sp(4), pb: sp(4), fill: 'surface', roundedTL: RLG, roundedTR: RLG, rounded: 0, fx: ['shadow-ledge-lg'] },
    col({ name: 'Sheet head', w: 'fill', items: 'center', gap: sp(2), pt: sp(2) }, Rc({ name: 'Rope handle', w: TAP, h: sp(2), rounded: NUM['radius-pill'], fill: 'rope' }), T(o.title, 'title', 'ink', { w: 'fill', balance: true })),
    o.lede ? T(o.lede, 'body-sm', 'ink-muted', { weight: 400, w: 'fill' }) : null, c,
    o.actions ? row({ name: 'Sheet actions', gap: sp(2), w: 'fill', pt: sp(2) }, o.actions) : null);
}
const dimmed = (top, ...c) => F({ name: 'Dimmed page', w: 'fill', flex: 'col', justify: 'end', pt: top, fill: { tok: 'scrim', over: 'ground' } }, c);
function Option(title, sub, selected) {
  const dot = F({ name: 'Option dot', w: sp(5), h: sp(5), flex: 'row', justify: 'center', items: 'center', rounded: 9999, fill: selected ? 'select' : 'surface', stroke: selected ? undefined : 'line-strong', sw: 2 }, selected ? El({ name: 'Option center', w: 8, h: 8, fill: 'surface' }) : null);
  return F({ name: `Option / ${title}`, w: 'fill', flex: 'row', gap: sp(3), p: sp(3), rounded: RSM, fill: selected ? { tok: 'select-tint', over: 'surface' } : 'surface-sunken', stroke: selected ? 'select' : 'line-strong', sw: selected ? 2 : 1 },
    dot, col({ w: 'fill' }, T(title, 'body-strong', 'ink', { w: 'fill' }), T(sub, 'body-sm', 'ink-soft', { weight: 400, w: 'fill' })));
}
function SkipSheet() {
  const reasons = SKIP_REASONS.length ? SKIP_REASONS : [['absent', 'Team isn’t at the table', 'We’ll send another judge later.'], ['busy', 'Team is busy with another judge', 'No penalty. It comes back after your next table.'], ['cant-find', 'Can’t find the table', 'Staff get a ping to check the seating chart.'], ['conflict', 'I know this team', 'Conflict of interest. You won’t see it again.']];
  return dimmed(120, Sheet({ title: 'Skip NeuralMesh?', lede: S('Pick a reason so we can get it judged by someone else.'), name: 'Sheet / Skip',
    actions: [Btn({ label: 'Back', variant: 'secondary', size: 'lg', ctx: 'paper' }), Btn({ label: 'Skip project', size: 'lg', w: 'fill', balance: true })] },
    reasons.slice(0, 4).map((r, i) => Option(r[1], r[2], i === 1))));
}
function Viewfinder() {
  const br = (n, d, x, y) => ({ t: 'path', p: { name: `Bracket ${n}`, d, w: sp(8), h: sp(8), stroke: 'on-viewfinder', sw: 3, x, y, layoutIgnore: true }, c: [] });
  const L = sp(8), c0 = 71, c1 = 358 - 40 - 71 - L;     // brackets sit 1.5 * space-12 from the centre line
  return F({ name: 'Viewfinder', w: 'fill', h: sp(12) * 4 + sp(6), rounded: RMD, fill: 'viewfinder', clip: true },
    br('top left', `M0 ${L}V4A4 4 0 0 1 4 0H${L}`, 98, 24), br('top right', `M0 0H${L - 4}A4 4 0 0 1 ${L} 4V${L}`, 358 - 40 - 98 - L, 24),
    br('bottom left', `M0 0V${L - 4}A4 4 0 0 0 4 ${L}H${L}`, 98, 216 - 24 - L), br('bottom right', `M${L} 0V${L - 4}A4 4 0 0 1 ${L - 4} ${L}H0`, 358 - 40 - 98 - L, 216 - 24 - L),
    Rc({ name: 'Scan line', w: 120, h: 2, rounded: NUM['radius-pill'], fill: 'gold', x: 99, y: 107, layoutIgnore: true }));
}
const orRule = () => row({ name: 'or', w: 'fill', gap: sp(3) }, Rc({ name: 'Rule left', w: 'fill', h: 1, fill: 'line-strong' }), T('or type the placard code', 'eyebrow', 'ink-muted', { upper: true }), Rc({ name: 'Rule right', w: 'fill', h: 1, fill: 'line-strong' }));
// TableCheck: every state of the right-table check (the states come from bundle.js; the copy is checked against it)
const TC_HELP = 'The table code, then the 2 characters after the dot.';
function TableCheck(state, o = {}) {
  DRAWN.TableCheck.add(TC_SHOWS[state] ?? state);
  const pr = NM, team = firstNames(pr.team);
  if (['matched', 'matched-code', 'offline', 'name'].includes(state)) {
    // `matched-code` is the matched strip after the judge typed the code (the component says "Checked by the placard code" unless the check came from a scan: p.via 'qr' or 'scan')
    const matched = state === 'matched' || state === 'matched-code', soft = !matched;
    const title = matched ? `${S('Right table · ')}${pr.table} · ${pr.name}` : `Table ${pr.table} · ${pr.name}`;
    const sub = state === 'name' ? S('Confirmed by name · staff may check') : state === 'offline' ? S('Offline · checked when you reconnect') : state === 'matched-code' ? S('Checked by the placard code') : S('Checked by the placard QR');
    const stamp = F({ name: 'Stamp', w: sp(8) + sp(2), h: sp(8) + sp(2), flex: 'row', justify: 'center', items: 'center', rounded: 9999, fill: soft ? { tok: 'warn-tint', over: 'surface' } : 'success', stroke: soft ? 'warn' : undefined, sw: 2 },
      Ic(matched ? 'check' : state === 'name' ? 'users' : 'clock', 20, soft ? 'warn' : 'on-select', { sw: matched ? 3 : 2 }));
    return F({ name: `TableCheck / ${state}`, w: 'fill', flex: 'row', items: 'center', gap: sp(3), px: sp(4), py: sp(3), fill: 'surface', rounded: RMD, stroke: 'line', sw: 1, fx: ['shadow-ledge'], accent: { tok: soft ? 'warn' : 'success' } },
      stamp, col({ w: 'fill' }, T(title, 'body-strong', 'ink', { w: 'fill' }), T(sub, 'body-sm', 'ink-soft', { w: 'fill' })));
  }
  const v = { idle: ['', null], checking: ['A12K7', null], mismatch: ['A14', 'error'], 'mismatch-none': ['A14', 'error'], 'mismatch-offline': ['A14', 'error'], 'not-found': ['A99', 'error'], 'needs-check': ['A12', null], 'wrong-check': ['A12K9', null], 'look-alike': ['A12KO', null], locked: ['A12K9', 'disabled'], 'no-camera': ['', null], failed: ['A12K7', null], 'name-ask': ['', null], 'name-open': ['', null], scanning: ['', null] }[state];
  const show = (r) => (r.length > 3 ? `${r.slice(0, 3)} · ${r.slice(3)}` : r);
  const tries = state === 'wrong-check' ? ' 3 tries left.' : state === 'look-alike' ? ' 4 tries left.' : '';
  const help = {
    'needs-check': [S('Type the 2 characters after the dot on the placard.'), 'warn'], 'wrong-check': [S('Type the 2 characters after the dot on the placard.') + tries, 'warn'],
    'look-alike': [S('Checks never use O, 0, I, 1 or L. Look again at the 2 characters after the dot.') + tries, 'warn'],
    'not-found': [`${S('There’s no table ')}A99${S(' in Room ')}${pr.room}. Check the placard and type it again.`, 'danger'], locked: [S('Too many tries. Scan the QR on the placard, or ask the team their name.'), 'danger'],
    'no-camera': [S('The camera is blocked, so the scan can’t start. Type the placard code instead.'), 'warn'], failed: [S('Couldn’t check that just now. Try again.'), 'danger'],
  }[state] ?? [TC_HELP, null];
  const busy = state === 'checking', dis = state === 'locked' || busy;
  const parts = [eyebrow(S('At the table · ask the team')), T(`“Are you ${pr.name}?”`, 'display-sm', 'ink', { w: 'fill', balance: true }), T(`${S('Team: ')}${team.join(', ')}`, 'body', 'ink-soft', { w: 'fill' })];
  if (state === 'scanning') parts.push(Viewfinder(), T(S('Point the camera at the QR on the placard.'), 'body-sm', 'ink-soft', { weight: 500, align: 'center', w: 'fill' }), Btn({ label: 'Cancel scan', variant: 'secondary', w: 'fill' }));
  else parts.push(Btn({ label: 'Scan table QR', variant: 'secondary', size: 'lg', icon: 'qr-code', w: 'fill', state: busy || state === 'locked' ? 'default' : 'default' }), orRule());
  parts.push(T('Placard code', 'body-sm', 'ink', { weight: 600 }),
    row({ name: 'Code and check', w: 'fill', gap: sp(2) }, Field({ value: show(v[0]), state: v[1] ?? 'default', w: 'fill' }), Btn({ label: busy ? 'Checking' : 'Check', variant: 'secondary', size: 'lg', state: busy ? 'loading' : (!v[0] || state === 'locked') ? 'disabled' : 'default' })),
    helpLine(help[0], help[1]));
  // The mismatch alert has three wordings (bundle.js): it names the project at that code; says the code has no project tonight; or, offline, cannot say which team is there.
  if (state === 'mismatch' || state === 'mismatch-none' || state === 'mismatch-offline') {
    const head = state === 'mismatch-none' ? `A14${S(' has no project tonight')}.` : state === 'mismatch-offline' ? `A14${S(' isn’t ')}${pr.name}${S('’s table')}.` : `A14${S(' is ')}LedgerLite.`;
    const body = `${pr.name}${S(' is at ')}${pr.table}${state === 'mismatch' ? ', two tables to your right' : ''}.${state === 'mismatch-offline' ? `${S(' You’re offline, so the app can’t say which team is at ')}A14.` : ''}${S(' Find that placard and check again.')}`;
    parts.push(alertBox('danger', head, body, [Btn({ label: 'Try again', variant: 'secondary', icon: 'rotate-ccw' }), Btn({ label: 'Map', variant: 'ghost', icon: 'map' })]));
  }
  if (state === 'name-ask' || state === 'name-open') parts.push(Rc({ name: 'Rule', w: 'fill', h: 1, fill: 'line' }),
    row({ name: 'Name link (open)', gap: sp(2), h: TAP }, Ic('up', 16, 'select'), T(S('No placard, or it won’t scan?'), 'caps', 'select', { upper: true })),
    T(`${S('Ask the team to say their project’s name, without a hint. Only confirm if they say ')}${pr.name}.`, 'body-sm', 'ink-soft', { weight: 400, w: 'fill' }),
    state === 'name-ask'
      ? InlineConfirmBox({ tone: 'neutral', size: 'lg', lead: `${S('Did the team say “')}${pr.name}${S('” themselves?')}`, text: S('Only confirm if you gave no hint.'), cancel: 'Back', confirm: S('Yes, they said it') })
      : Btn({ label: `${S('They told me they’re ')}${pr.name}`, variant: 'secondary', icon: 'users', w: 'fill' }),
    T(S('Staff may check name check-ins. Without the placard you can’t report this team absent, and Table talk stays off.'), 'label', 'ink-muted', { weight: 500, w: 'fill' }));
  else if (state !== 'scanning') parts.push(Rc({ name: 'Rule', w: 'fill', h: 1, fill: 'line' }), row({ name: 'Name link', gap: sp(2), h: TAP }, Ic('chevron', 16, 'select'), T(S('No placard, or it won’t scan?'), 'caps', 'select', { upper: true })));
  return Card({ name: `TableCheck / ${state}`, gap: sp(3) }, parts);
}
// Table talk, the recorder -------------------------------------------------------------------------------------------
const AUDIO = S('The audio isn’t kept: it’s deleted once it’s transcribed.');
const ttHead = (title, aside = 'Only you see these') => row({ name: 'Head', w: 'fill', justify: 'between' }, row({ gap: sp(2) }, Ic('mic', 20, 'select'), T(title, 'body-strong', 'ink')), T(aside, 'eyebrow', 'ink-soft', { upper: true }));
const fine = (text, icon) => row({ name: 'Fine print', gap: sp(1), w: 'fill', items: 'start' }, icon ? Ic(icon, 14, 'ink-muted') : null, T(text, 'label', 'ink-muted', { weight: 500, w: 'fill' }));
function msg(icon, tone, text, sub, acts) {
  const bg = tone === 'warn' ? { tok: 'warn-tint', over: 'surface' } : tone === 'danger' ? { tok: 'danger-tint', over: 'surface' } : 'surface-sunken', fg = tone ?? 'ink-soft';
  return [row({ name: 'Message', w: 'fill', items: 'start', gap: sp(3) },
    F({ name: 'Message disc', w: sp(8), h: sp(8), flex: 'row', justify: 'center', items: 'center', rounded: 9999, fill: bg }, Ic(icon, 18, fg)),
    col({ w: 'fill', gap: sp(1) }, T(text, 'body-strong', 'ink', { w: 'fill' }), sub ? T(sub, 'body-sm', 'ink-soft', { weight: 400, w: 'fill' }) : null)),
    acts ? row({ name: 'Message actions', w: 'fill', gap: sp(3), items: 'start' }, Rc({ name: 'Text column offset', w: sp(8), h: 1, fill: 'none' }), row({ name: 'Actions', w: 'fill', gap: sp(2), wrap: true }, acts)) : null];   // the actions sit in the text column: after the 32px disc and its 12px gap
}
const askBtn = (label = 'Ask and record', state) => Btn({ label, variant: 'secondary', size: 'lg', icon: 'mic', w: 'fill', state });
function LevelMeter(level = 0.7, paused = false) {
  const bars = [0.45, 0.7, 0.9, 1, 0.85, 0.62, 0.42].map((w, i) => Rc({ name: `Meter bar ${i + 1}`, w: sp(1), h: Math.max(4, Math.round(sp(6) * (paused ? 0.1 : level * w))), rounded: NUM['radius-pill'], fill: 'select' }));
  return row({ name: 'Level meter', gap: sp(1), h: sp(6) }, bars);
}
function RecControls(o) {
  const paused = o.paused, memo = o.memo;
  const side = (icon, label, dis) => F({ name: `Control / ${label}`, w: 'fill', h: NUM['rec-size'], flex: 'col', justify: 'center', items: 'center', gap: sp(1), p: sp(2), rounded: RMD, fill: dis ? 'surface-sunken' : 'surface', stroke: dis ? undefined : 'ink', sw: 2 }, Ic(icon, 20, dis ? 'ink-muted' : 'ink'), T(label, 'caps', dis ? 'ink-muted' : 'ink', { upper: true }));
  const R = NUM['rec-size'], H = R + sp(4), G = +(R * 0.34).toFixed(2);   // .gv-rec__stop is rec-size x .34
  // One flat frame (the lint allows 6 levels of nesting): the disc, its halo and the glyph are absolute, and the label is given its own one-line
  // height. A text layer in a frame without auto layout is never re-measured, so without `h` it kept the 100px default box and hung over the controls below.
  const disc = F({ name: 'Stop control', w: H, h: H + sp(6) }, paused ? null : El({ name: 'Recording halo', w: H, h: H, x: 0, y: 0, fill: 'rec-ring' }), El({ name: 'Disc', w: R, h: R, x: (H - R) / 2, y: (H - R) / 2, fill: 'surface', stroke: 'rec', sw: NUM['stroke-focus'], fx: ['shadow-ledge'] }), Rc({ name: 'Stop glyph', w: G, h: G, x: (H - G) / 2, y: (H - G) / 2, rounded: RSM, fill: 'rec' }),
    T('Stop', 'caps', 'ink', { upper: true, align: 'center', w: H, h: TYPE.caps.line, x: 0, y: H + 2 }));
  return row({ name: 'Controls', w: 'fill', gap: sp(3), items: 'start' }, side(paused ? 'play' : 'pause', paused ? 'Resume' : 'Pause'), disc, memo ? Rc({ name: 'Spacer', w: 'fill', h: R }) : side('bookmark', 'Mark this', paused));
}
function TableTalk(state, o = {}) {
  DRAWN.TableTalk.add(state === 'locked' ? 'disabled' : state);   // 'locked' is the component's `disabled` prop, not a state
  const who = 'EcoLens', memo = !!o.memo;
  const head = ttHead(state === 'ready' ? (memo ? 'Memo' : 'From table talk') : memo ? 'Memo' : 'Table talk', state === 'ready' ? '1:52 · 241 words' : undefined);
  let body = [];
  switch (state) {
    case 'idle': body = [T('Your phone takes notes while the team demos. Ask them first. The audio isn’t kept.', 'body', 'ink-soft', { w: 'fill' }), askBtn(), fine('One recording and one retry per table.')]; break;
    case 'locked': body = [msg('lock', null, S('Check the table first: scan its placard or type its code.'))]; break;
    case 'starting': body = [row({ gap: sp(2) }, Ic('spinner', 16, 'select'), T(S('Waiting for the microphone…'), 'body', 'ink-soft')), fine('Allow the microphone if your phone asks. Nothing is recording yet.'), Btn({ label: 'Cancel', variant: 'ghost' })]; break;
    case 'recording': case 'paused': {
      const paused = state === 'paused';
      body = [row({ name: 'Recorder top', w: 'fill', gap: sp(3) },   /* .gv-rec__top is min-height space-8: the 36px time line sets the height */ row({ gap: sp(2) }, El({ name: 'Rec dot', w: sp(3), h: sp(3), fill: paused ? 'ink-muted' : 'rec' }), T(paused ? 'Paused' : memo ? S('Recording memo') : 'Recording', 'caps', paused ? 'ink-soft' : 'rec', { upper: true })), T(o.elapsed ?? '01:12', 'stat', 'ink'), Rc({ name: 'Meter push', w: 'fill', h: 1 }), LevelMeter(0.7, paused)),
        paused ? row({ w: 'fill', gap: sp(1), items: 'start' }, Ic('mic-off', 14, 'ink-soft'), T('Paused because you left this screen or it locked. The microphone is off. Tap Resume when you’re ready.', 'body-sm', 'ink-soft', { weight: 600, w: 'fill' })) : null,
        o.warn && !paused ? row({ name: 'One minute left', w: 'fill', gap: sp(1), items: 'center' }, Ic('clock', 14, 'warn'), T(S('One minute of recording left.'), 'body-sm', 'warn', { weight: 600, w: 'fill' })) : null,
        RecControls({ paused, memo }), memo || paused ? null : row({ gap: sp(2) }, Badge(`${S('Marked ')}${o.mark ?? '01:04'}`, 'brand', { mono: true, icon: 'bookmark' })),
        o.confirm ? InlineConfirmBox({ lead: S('Stop and delete this recording?'), text: S('Nothing is kept, and it uses one of this table’s tries.'), cancel: 'Keep recording', confirm: 'Stop and delete', size: 'lg' }) : row({ w: 'fill' }, Btn({ label: 'Stop and delete', variant: 'ghost-danger', icon: 'trash' })), fine(memo ? `${S('Only your voice. ')}${AUDIO}` : `${AUDIO}${S(' Only you see the notes.')}`, 'mic-off')];
      break;
    }
    case 'processing': body = o.timedOut
      ? msg('alert', 'warn', S('Highlights are taking longer than expected.'), S('Your typed notes are safe. You can keep judging without them.'), [Btn({ label: `${S('Record again (')}1${S(' left)')}`, variant: 'secondary', icon: 'rotate-ccw' }), Btn({ label: S('Continue without highlights'), variant: 'ghost' })])
      : [row({ gap: sp(2) }, Ic('spinner', 16, 'select'), T(S('Pulling out highlights…'), 'body', 'ink-soft')), spinnerLine(1, 240), spinnerLine(2, 170), spinnerLine(3, 200)]; break;
    case 'declined': body = [msg('mic-off', null, 'No recording at this table.', 'Dictate a memo after you leave: only your voice.', [Btn({ label: 'They agreed after all', variant: 'ghost' })])]; break;
    case 'retry': body = [T(S('One more try at this table. Ask the team again before you start.'), 'body', 'ink-soft', { w: 'fill' }), askBtn('Ask again and record (1 left)')]; break;
    case 'used-up': body = msg('mic-off', null, S('You’ve used this table’s recording and its retry.'), S('Type anything else you remember in your notes.')); break;
    case 'memo': body = [T(`${S('Dictate a memo about ')}${who}${S(': only your voice. Say what you remember while you walk.')}`, 'body', 'ink-soft', { w: 'fill' }),
      col({ w: 'fill', items: 'center', gap: sp(2) }, F({ name: 'Start memo disc', w: NUM['rec-size'], h: NUM['rec-size'], flex: 'row', justify: 'center', items: 'center', rounded: 9999, fill: 'surface', stroke: 'rec', sw: NUM['stroke-focus'], fx: ['shadow-ledge'] }, El({ name: 'Start glyph', w: +(NUM['rec-size'] * 0.46).toFixed(2), h: +(NUM['rec-size'] * 0.46).toFixed(2), fill: 'rec' })), T('Start memo', 'caps', 'ink', { upper: true })), fine(AUDIO, 'mic-off')]; break;
    case 'unsupported': body = [msg('mic-off', null, S('This browser can’t take voice notes.'), 'Type notes instead.')]; break;
    case 'denied': body = [msg('lock', 'danger', S('The microphone is blocked for this site.'), 'Type notes instead, or allow the mic in your browser settings, then try again.', [Btn({ label: 'Try again', variant: 'secondary', icon: 'rotate-ccw' })]),
      F({ name: 'Disclosure / how to allow the microphone', w: 'fill', flex: 'row', items: 'center', gap: sp(3), h: TAP, px: sp(4), rounded: RMD, fill: 'surface', stroke: 'line', sw: 1, fx: ['shadow-ledge'] }, Ic('mic', 20, 'select'), T('How to allow the microphone', 'body-strong', 'ink', { w: 'fill' }), Ic('chevron', 20, 'ink'))]; break;
    case 'mic-busy': body = [msg('mic-off', 'warn', S('Your microphone is busy, maybe a call or another app.'), 'Close it, then try again. This doesn’t use up a try.', [Btn({ label: 'Try again', variant: 'secondary', icon: 'rotate-ccw' })])]; break;
    case 'offline-queued': body = [msg('clock', 'warn', S('You’re offline. Your notes from this table wait on this phone.'), 'They’re pulled out when you reconnect. If you’re not back online within 15 minutes of leaving this table, they’re discarded. Reloading this page discards them too.')]; break;
    case 'too-noisy': body = memo
      ? msg('alert', 'warn', S('Couldn’t make out the memo. Nothing was kept.'), `${S('Type what you remember.')}${S(' Or find a quieter spot and try once more.')}`, [Btn({ label: `${S('Record the memo again (')}1${S(' left)')}`, variant: 'secondary', icon: 'rotate-ccw', ...(MEMO_RETRY_FIXED ? { w: 'fill' } : {}) })])
      : msg('alert', 'warn', S('Too noisy to pull highlights. Nothing was kept.'), `${S('Type what you remember.')}${S(' Or move closer and try once more.')}`, [Btn({ label: `${S('Record again (')}1${S(' left)')}`, variant: 'secondary', icon: 'rotate-ccw' })]); break;
    case 'failed': body = o.failedAt === 'start'
      ? msg('alert', 'danger', S('The microphone didn’t start.'), S('Nothing was heard and this doesn’t use up a try. Your typed notes are safe.'), [Btn({ label: 'Try again', variant: 'secondary', icon: 'rotate-ccw' })])
      : msg('alert', 'danger', S('Couldn’t transcribe this one.'), S('Your typed notes are safe.'), [Btn({ label: memo ? `${S('Record the memo again (')}1${S(' left)')}` : `${S('Record again (')}1${S(' left)')}`, variant: 'secondary', icon: 'rotate-ccw', ...(memo && MEMO_RETRY_FIXED ? { w: 'fill' } : {}) })]); break;
    case 'locked-by-admin': body = o.team ? msg('lock', null, S('This team opted out of recording.'), 'Dictate a memo after you leave: only your voice.') : msg('lock', null, S('Table talk is off for this event.'), 'Type notes instead.'); break;
    case 'ready': body = [T(memo ? S('From your memo. Keep what’s right.') : 'Suggestions from what was said. Keep what’s right.', 'body', 'ink-soft', { w: 'fill' }), fine(S('Demo transcript. Your audio wasn’t sent anywhere.'), 'alert'), HighlightRows(), PrizeCard(),
      o.allKept ? Btn({ label: 'All kept', variant: 'secondary', icon: 'check', w: 'fill', state: 'disabled' }) : Btn({ label: 'Keep all · add to notes', variant: 'secondary', icon: 'check', w: 'fill' }),
      o.confirm ? InlineConfirmBox({ lead: `${S('Delete table talk for ')}${who}?`, text: 'Your typed notes stay.', cancel: 'Keep it', confirm: 'Delete what was heard' }) : row({ w: 'fill' }, Btn({ label: 'Delete what was heard', variant: 'ghost-danger', icon: 'trash' }))]; break;
    default: throw new Error(`TableTalk state ${state}`);
  }
  return Card({ name: `TableTalk / ${state}${memo && state !== 'memo' ? ' (memo)' : ''}${o.failedAt === 'start' ? ' (mic never opened)' : ''}${o.warn ? ' (one minute left)' : ''}${o.timedOut ? ' (timed out)' : ''}${o.team ? ' (team opted out)' : ''}${o.confirm ? ' (confirm open)' : ''}${o.allKept ? ' (all kept)' : ''}`, gap: sp(3) }, head, body);
}
// Highlights: describe, never judge. Each row: what it is, the verbatim quote with its time, Heard / Not sure, Keep / Edit / Remove.
function Hl(o) {
  const tags = [o.marked ? Badge('Marked', 'brand', { icon: 'bookmark' }) : null, o.unsure ? Badge('Not sure', 'warn') : Badge('Heard'), o.kept ? Badge('Kept', 'success', { icon: 'check' }) : null];
  return col({ name: `Highlight / ${o.kind}`, w: 'fill', gap: sp(1) },
    o.first ? null : Rc({ name: 'Row rule', w: 'fill', h: 1, fill: 'line' }),
    row({ name: 'Highlight head', w: 'fill', gap: sp(1), pt: o.first ? 0 : sp(2) }, eyebrow(o.kind), F({ name: 'Spacer', h: 1, grow: 1 }), tags),
    T(o.text, 'body', 'ink', { weight: 500, w: 'fill' }),
    row({ name: 'Quote', w: 'fill', gap: sp(2), items: 'start' }, Rc({ name: 'Quote rule', w: 2, h: 'fill', fill: 'line-strong' }), T(o.at, 'numeral', 'ink-muted'), T(`“${o.quote}”`, 'body-sm', 'ink-soft', { weight: 400, w: 'fill' })),
    row({ name: 'Actions', gap: sp(2), pt: sp(1) }, o.kept ? null : Btn({ label: 'Keep', variant: 'secondary', icon: 'check' }), Btn({ label: 'Edit', variant: 'ghost' }), Btn({ label: 'Remove', variant: 'ghost' })));
}
function HighlightRows() {
  return [Hl({ first: true, kind: 'Does', text: 'A mesh network that heals itself: if a node dies, the others route around it', quote: 'so neural mesh is a mesh network that heals itself, if a node dies the other nodes route around it', at: '00:06', kept: true }),
    Hl({ kind: 'Demo · Ran live', text: 'The stream froze for two seconds and came back, rerouted onto node five', quote: 'and it’s back, it rerouted onto node five', at: '01:03', marked: true }),
    Hl({ kind: 'Open question', text: 'Asked what happens with a hundred nodes', quote: 'honestly we haven’t tested past six real nodes', at: '01:29', unsure: true })];
}
function PrizeCard(accepted) {
  return F({ name: 'Prize suggestion', w: 'fill', flex: 'col', gap: sp(2), p: sp(4), rounded: RSM, fill: { tok: 'select-tint', over: 'surface' }, stroke: 'select', sw: 2 },
    eyebrow('Suggestion · not a nomination'), T(accepted ? `${S('You nominated it for ')}Modal.` : `${S('Maybe ')}Modal?`, 'title-sm', 'select', { w: 'fill' }),
    row({ gap: sp(2), pl: sp(3), items: 'start', w: 'fill' }, T('00:24', 'numeral', 'ink-muted'), T('“we trained the routing policy with reinforcement learning on Modal GPUs in simulation”', 'body-sm', 'ink-soft', { weight: 400, w: 'fill' })),
    accepted ? null : row({ gap: sp(2) }, Btn({ label: 'Nominate', variant: 'secondary', icon: 'star' }), Btn({ label: 'Not this one', variant: 'ghost' })),
    T(accepted ? 'Change it any time with the prize chips below.' : 'A suggestion from what was said. Most projects get none.', 'label', 'ink-muted', { weight: 500, w: 'fill' }));
}
function ConsentSheet(ai = true) {
  DRAWN.TableTalk.add('consent');   // the consent state of TableTalk is this sheet over the idle card
  const c = ai ? COPY.on : COPY.off;
  const script = c.script ?? '[consent script not found in bundle.js]';
  const sends = c.sends.length ? c.sends : [['Processors', '[the lists of what each one gets were not found in bundle.js]']];
  const li = (icon, bold, text) => row({ name: 'Fact', gap: sp(2), items: 'start', w: 'fill' }, Ic(icon, 16, 'select'), T(bold ? `${bold} ${text}` : text, 'body-sm', 'ink-soft', { weight: 500, w: 'fill' }));
  return dimmed(96, Sheet({ title: 'Ask the team first', lede: 'Read this out loud. Start only if everyone at the table says yes.', name: `ConsentSheet / AI summaries ${ai ? 'on' : 'off'}`,
    actions: [Btn({ label: 'Not this time', variant: 'secondary', size: 'lg' }), Btn({ label: 'Everyone agreed · start', size: 'lg', w: 'fill', balance: true })] },
    F({ name: 'Script', w: 'fill', flex: 'col', gap: sp(1), pt: sp(3), px: sp(4), pb: sp(4), rounded: RSM, fill: 'surface-sunken', accent: { tok: 'select' } }, eyebrow('Say'), T(`“${script}”`, 'read-aloud', 'ink', { w: 'fill' })),
    sends.map((s, i) => li(i ? 'quote' : 'mic-off', s[0], s[1])), li('lock', null, S('Only you see the notes, and only for judging.')), li('users', null, 'Nobody is identified by their voice.'),
    F({ name: 'Disclosure / what the placard tells the team', w: 'fill', flex: 'row', items: 'center', gap: sp(3), h: TAP, px: sp(4), rounded: RMD, fill: 'surface', stroke: 'line', sw: 1, fx: ['shadow-ledge'] }, Ic('doc', 20, 'select'), T('What the placard tells the team', 'body-strong', 'ink', { w: 'fill' }), Ic('chevron', 20, 'ink')),
    COPY.retention ? T(COPY.retention, 'label', 'ink-muted', { weight: 500, w: 'fill', name: 'Retention' }) : null,
    T('Hold the phone about a forearm’s length from whoever is talking. If anyone says no, don’t record. It doesn’t affect judging.', 'label', 'ink-muted', { weight: 500, w: 'fill' })));
}
function DemoStatus(o = {}) {
  const { selected = null, suggested = null, locked = false } = o;
  return Card({ name: `DemoStatus / ${locked ? 'locked' : selected ? 'selected' : 'suggested'}`, gap: sp(3) },
    row({ w: 'fill', justify: 'between' }, row({ gap: sp(2) }, Ic('play', 20, 'select'), T('Demo', 'body-strong', 'ink')), T(selected ? DEMO_OPTS.find((x) => x[0] === selected)?.[1] : 'What you saw', 'eyebrow', 'ink-soft', { upper: true })),
    locked ? row({ w: 'fill', gap: sp(1), items: 'start' }, Ic('lock', 12, 'ink-muted'), T(S('Check the table first: scan its placard or type its code.'), 'label', 'ink-muted', { w: 'fill' })) : suggested && !selected ? T(`${S('Table talk heard: ')}Ran live${S('. Tap what you saw.')}`, 'body-sm', 'ink-muted', { weight: 400, w: 'fill' }) : null,
    row({ name: 'Options', w: 'fill', gap: sp(2), wrap: true, rowGap: sp(2) }, DEMO_OPTS.map(([id, label]) => Chip(label, { radio: true, selected: selected === id, disabled: locked, tag: suggested === id && selected !== id ? 'Suggested' : undefined }))));
}
// Compare ------------------------------------------------------------------------------------------------------------
function Recall(rows, compact = true) {
  return col({ name: 'Recall rows', w: 'fill', gap: compact ? 2 : sp(1) }, RECALL_ROWS.map(([id, label]) => row({ w: 'fill', gap: sp(3), items: 'start' },
    T(label, 'eyebrow', 'ink-soft', { upper: true, w: 56 }), T(rows[id] ?? '—', 'body-sm', rows[id] ? 'ink' : 'ink-muted', { weight: 400, w: 'fill' }))));
}
function CompareCard(o) {
  const sel = !!o.selected, noms = o.noms ?? [];
  const radio = sel ? F({ name: 'Choice mark checked', w: sp(6), h: sp(6), flex: 'row', justify: 'center', items: 'center', rounded: 9999, fill: 'select' }, Ic('check', 14, 'on-select', { sw: 3 })) : El({ name: 'Choice mark empty', w: sp(6), h: sp(6), stroke: 'line-strong', sw: 2, fill: 'surface' });
  const wash = sel ? { tok: 'select-tint', over: 'surface' } : 'surface';
  return F({ name: `CompareCard / ${o.state}`, w: 'fill', flex: 'col', gap: sp(1), pt: sp(5), px: sp(4), pb: sp(4), fill: wash, rounded: RMD, stroke: sel ? 'select' : 'line', sw: sel ? 3 : 1, fx: [sel ? 'shadow-ledge-lg' : 'shadow-ledge'] },
    F({ name: 'Order ticket', flex: 'row', items: 'center', px: sp(4), py: sp(1), layoutIgnore: true, x: sp(4), y: -sp(3), plate: [{ kind: 'ticket', a: { r: NUM.notch }, fill: 'gold' }] }, T(o.order, 'eyebrow', 'on-gold', { upper: true })),
    row({ name: 'Compare top', w: 'fill', gap: sp(2) }, Badge('Pro', 'pro'), Badge(`Table ${o.table}`, 'neutral', { mono: true, icon: 'table' }), F({ name: 'Spacer', h: 1, grow: 1 }), radio),
    T(o.name, 'display-sm', 'ink', { w: 'fill' }),
    o.recall ? null : T(o.desc, 'body-sm', 'ink-muted', { weight: 400, w: 'fill', clamp: 1 }),
    F({ name: 'Rule spacer', w: 'fill', flex: 'col', pt: sp(2) }, Rc({ name: 'Rule', w: 'fill', h: 1, fill: 'line' })),
    row({ name: 'Notes head', w: 'fill', gap: sp(2), pt: sp(1) }, T(o.recall ? 'Your recall' : 'Your notes', 'eyebrow', 'ink-soft', { upper: true }), noms.map((n) => Badge(n, 'brand', { icon: 'star' }))),
    o.recall ? Recall(o.recall) : T(`“${o.notes}”`, 'body-sm', 'ink-soft', { weight: 400, w: 'fill', clamp: 1 }));
}
const NM_RECALL = { does: 'Self-healing mesh: nodes route around a dead node', demo: 'Ran live · rerouted in about 2 s', standout: 'Judge pulled a node; back in about 3 s', open: 'Asked: what happens with a hundred nodes?' };
function ConfirmBar(state, pick = 'EcoLens') {
  const bar = (...c) => F({ name: `Compare confirm bar / ${state}`, w: 'fill', flex: 'col', gap: sp(2), px: sp(4), py: sp(2), fill: woodFill(), fx: ['shadow-plank-edge-up'] }, c);
  if (state === 'none') return bar(Btn({ label: 'Tap the stronger project', size: 'lg', iconRight: 'arrow', state: 'disabled', ctx: 'wood', w: 'fill' }));
  if (state === 'picked') return bar(Btn({ label: `${S('Confirm: ')}${pick}`, size: 'lg', iconRight: 'arrow', ctx: 'wood', w: 'fill' }));
  return bar(
    row({ name: 'Recorded row', w: 'fill', gap: sp(3), h: TAP }, F({ name: 'Recorded check', w: sp(8), h: sp(8), flex: 'row', justify: 'center', items: 'center', rounded: 16, fill: 'success' }, Ic('check', 16, 'on-select', { sw: 3 })),
      T(`${S('Vote recorded: ')}${pick}`, 'body', 'on-wood', { w: 'fill' }), Btn({ label: 'Undo (6)', variant: 'secondary', ctx: 'wood', name: 'Button / secondary / Undo' })),
    Btn({ label: 'Next table', size: 'lg', iconRight: 'arrow', ctx: 'wood', w: 'fill' }),
    F({ name: 'Undo fuse track', w: 'fill', h: sp(1), rounded: NUM['radius-pill'], fill: 'ground-track', clip: true }, Rc({ name: 'Undo fuse (gold, 6 of 8 s left)', w: 241, h: sp(1), fill: 'gold' })));
}
// EnRoute: the hero signpost names the table and its room; the last board says who to look for. Under it (.gv-look): the team, the hint, how to check in.
// The parent shows the progress plaque above it. After dur-cant-find the parent sets `lost` and "Can't find it?" offers the floor plan and staff.
function EnRouteParts(lost, progress = true) {
  const look = F({ name: 'Look section', w: 'fill', flex: 'col', gap: sp(1), items: 'center' },
    T(`Team: ${firstNames(NM.team).join(', ')}`, 'body', 'on-ground-soft', { align: 'center', w: 'fill' }),
    T(S('Facing a placard, higher numbers are to your left.'), 'body', 'on-ground-soft', { align: 'center', w: 'fill' }),
    T(S('At the table, scan the QR on its placard, or type the table code and the 2 characters after the dot.'), 'body', 'on-ground-soft', { align: 'center', w: 'fill' }));
  return [progress ? TableProgress({ total: 4, done: 0, current: true, tone: 'plaque', label: 'Next table · 1 of 4' }) : null,
    Signpost({ label: S('Room 4217 · Siebel Center, 4th floor'), noun: 'Table', room: 'A12', map: S('Floor plan'), boardLabel: S('Look for'), board: NM.name }), look,
    lost ? alertBox('warn', 'Can’t find it?', 'Tables count up from the door. Open the floor plan, or ask staff and they’ll come to you.', [Btn({ label: 'Floor plan', variant: 'secondary', icon: 'map' }), Btn({ label: 'Ask staff', variant: 'ghost', icon: 'users' })]) : null];
}
const EnRoute = (lost) => col({ name: `EnRoute${lost ? ' / lost' : ''}`, w: 'fill', gap: sp(3) }, EnRouteParts(lost));

// ---- Switch, InlineConfirm, ProjectSkeleton, EmptyState: the smaller judge and admin pieces bundle.js ships
// Switch (APG switch): the whole row is one 48px button: label, the state word, a 52 x 32 track. Off is a sunken track with an ink-soft thumb at the left; on is a select track with a paper thumb at the right.
function SwitchRow(o) {
  const { label, on = false, dis = false, desc, lock, onLabel = 'On', offLabel = 'Off', focus = false } = o, TW = sp(12) + sp(1), TH = sp(8), th = sp(6);
  const track = F({ name: `Track / ${on ? 'on' : 'off'}${dis ? ' / disabled' : ''}`, w: TW, h: TH, rounded: NUM['radius-pill'], fill: on ? (dis ? 'surface-sunken' : 'select') : dis ? 'surface' : 'surface-sunken', stroke: on && !dis ? undefined : 'line-strong', sw: 2 },
    El({ name: 'Thumb', w: th, h: th, x: on ? TW - th - sp(2) : sp(1), y: sp(1), fill: on ? (dis ? 'ink-muted' : 'surface') : dis ? 'ink-soft' : 'ink-soft', layoutIgnore: true }));
  const head = F({ name: `Switch / ${label}`, w: 'fill', flex: 'row', items: 'center', gap: sp(3), h: TAP, px: sp(3), py: sp(2), rounded: RSM, plate: focus ? [{ kind: 'rrect', a: { r: RSM }, ring: { inset: 0, w: 3, tok: 'focus' }, name: 'Focus ring' }] : [] },
    T(label, 'body-strong', dis ? 'ink-soft' : 'ink', { w: 'fill' }), T(on ? onLabel : offLabel, 'caps', on && !dis ? 'select' : 'ink-soft', { upper: true }), track);
  return col({ name: 'Switch row', w: 'fill', gap: sp(1) }, head, desc || lock ? col({ name: 'Description', w: 'fill', gap: sp(1), px: sp(3) }, lock ? row({ gap: sp(1) }, Ic('lock', 12, 'ink-muted'), T(lock, 'label', 'ink-muted', { weight: 600 })) : null, desc ? T(desc, 'body-sm', 'ink-muted', { weight: 400, w: 'fill' }) : null) : null);
}
// InlineConfirm: a paper strip with a left bar (danger, or select for the neutral tone), the question with its bold lead, an optional field, Cancel and the commit.
function InlineConfirmBox(o) {
  const tone = o.tone === 'neutral' ? 'neutral' : 'danger', bar = tone === 'neutral' ? 'select' : 'danger';
  return F({ name: `InlineConfirm / ${tone}`, w: 'fill', flex: 'col', gap: sp(3), pl: sp(5), pr: sp(4), py: sp(3), fill: 'surface', rounded: RMD, stroke: 'line', sw: 1, fx: ['shadow-ledge'], accent: { tok: bar } },
    col({ name: 'Question', w: 'fill', gap: 0 }, T(o.lead, 'body-sm', bar, { weight: 700, w: 'fill' }), T(o.text, 'body-sm', 'ink', { weight: 500, w: 'fill' })),   // the component runs the bold lead into the sentence; a text layer holds one style, so the lead is its own line
    o.field ?? null,
    // sm (the admin console): the two buttons sit at the right. lg (the recorder, 48px+ on a phone): they do not fit side by side in a 358px card, so bundle.css (.gv-btn--lg { flex: 1 1 auto }, wrap) stacks them full width.
    o.size === 'lg' ? col({ name: 'Commit stack', w: 'fill', gap: sp(2) }, Btn({ label: o.cancel ?? 'Cancel', variant: 'secondary', size: 'lg', w: 'fill' }), Btn({ label: o.confirm ?? 'Confirm', variant: tone === 'neutral' ? 'primary' : 'danger', size: 'lg', w: 'fill' }))
      : row({ name: 'Commit row', w: 'fill', gap: sp(2), justify: 'end', wrap: true }, Btn({ label: o.cancel ?? 'Cancel', variant: 'secondary', size: o.size }), Btn({ label: o.confirm ?? 'Confirm', variant: tone === 'neutral' ? 'primary' : 'danger', size: o.size })));
}
// ProjectSkeleton: the poster's own geometry in sunken bars (a pill, the ruled eyebrow, the name, two lines) and the place of three closed Disclosure rows.
function SkeletonBar(w, h, name, p = {}) { return Rc({ name: `Skeleton / ${name}`, w, h, rounded: p.pill ? NUM['radius-pill'] : RSM, fill: 'surface-sunken' }); }
function ProjectSkeletonSpec(rows = 3) {
  const W = 358;
  const poster = Card({ name: 'ProjectSkeleton / poster', gap: sp(2) },
    row({ w: 'fill', justify: 'center' }, SkeletonBar(sp(12) + sp(2), sp(6), 'badge', { pill: true })),
    row({ name: 'Ruled eyebrow', w: 'fill', gap: sp(3), pt: sp(2), items: 'center' }, Rc({ name: 'Rule', w: 'fill', h: 1, fill: 'line-strong' }), SkeletonBar(sp(12) * 2, sp(3), 'word'), Rc({ name: 'Rule', w: 'fill', h: 1, fill: 'line-strong' })),
    row({ w: 'fill', justify: 'center', pt: sp(2) }, SkeletonBar(Math.round((W - 2 * sp(5)) * 0.6), sp(8), 'name')),
    col({ name: 'Lines', w: 'fill', gap: sp(2), items: 'center', pt: sp(2) }, SkeletonBar(Math.round((W - 2 * sp(5)) * 0.8), sp(4), 'line 1'), SkeletonBar(Math.round((W - 2 * sp(5)) * 0.55), sp(4), 'line 2')));
  const rs = Array.from({ length: rows }, (_, i) => F({ name: `Skeleton row ${i + 1}`, w: 'fill', flex: 'row', items: 'center', h: TAP, px: sp(4), fill: 'surface', rounded: RMD, stroke: 'line', sw: 1, fx: ['shadow-ledge'] }, SkeletonBar(Math.round((W - 2 * sp(4)) * 0.45), sp(4), 'row')));
  return col({ name: 'ProjectSkeleton', w: 'fill', gap: sp(2) }, poster, rs);
}
// EmptyState: a paper card, a prop (prop-h high) or a chamfered icon box, a title, a body (body-sm, 34ch) and an optional action.
function EmptyCard(o) {
  const art = o.prop ? PropArt(o.prop) : F({ name: 'Empty icon', w: sp(12) + sp(1), h: sp(12) + sp(1), flex: 'row', justify: 'center', items: 'center', plate: [{ kind: 'chamfer', a: { cx: NUM['cut-sm'] * 1.25, cy: NUM['cut-sm'] * 1.25 }, fill: { tok: 'select-tint', over: 'surface' } }] }, Ic(o.icon ?? 'inbox', 24, 'select'));
  return Card({ name: `EmptyState / ${o.title}`, px: sp(4), py: o.prop ? sp(6) : sp(8), gap: sp(2) },
    row({ w: 'fill', justify: 'center' }, art), T(o.title, 'title', 'ink', { align: 'center', w: 'fill', balance: true }), o.body ? row({ w: 'fill', justify: 'center' }, T(o.body, 'body-sm', 'ink-muted', { weight: 400, align: 'center', w: 270 })) : null,
    o.action ? row({ w: 'fill', justify: 'center', pt: sp(1) }, o.action) : null);
}

// ------------------------------------------------------------------------------------------------------ stages (masonry of specimens)
// A stage is a themed panel. Its children are absolutely placed (so a specimen is at most 3 layers under the page, and the
// lint's nesting limit holds); positions are assigned after layout, once every specimen's real height is known.
const STAGES = [];
function stage(pg, { name, theme, w = 1800, pad = 64, cols = 4, colW = 358, gap = 32, fill }) {
  const frame = graph.createNode('FRAME', pg.id, { name, width: w, height: 400, clipsContent: false });
  const info = colorInfo(fill ?? 'ground', theme); graph.updateNode(frame.id, { fills: [solid(info.c)] }); bindColor(frame.id, 'fills', info, theme);
  pg.tops.push(frame.id);
  const st = { frame, theme, w, pad, cols, colW, gap, items: [], pg, name };
  STAGES.push(st); return st;
}
// add: build a specimen (width = one column unless span/full), with an optional caption above it
function put(st, spec, o = {}) {
  const span = o.full ? st.cols : o.span ?? 1, width = o.full ? st.w - 2 * st.pad : span * st.colW + (span - 1) * st.gap;
  spec = { ...spec, p: { ...spec.p, w: o.w ?? width } };
  // captions sit in an auto-layout frame so their height is measured (text directly in a plain frame keeps its default height)
  const w = o.w ?? width;
  const cap = o.caption ? build(F({ name: 'Caption', w, flex: 'col' }, T(o.caption, 'body-sm', 'on-ground-soft', { weight: 600, w: 'fill', spec: true })), st.frame.id, st.theme) : null;
  const note = o.note ? build(F({ name: 'Note', w, flex: 'col' }, T(o.note, 'label', 'on-ground-soft', { weight: 500, w: 'fill', spec: true })), st.frame.id, st.theme) : null;
  const node = build(spec, st.frame.id, st.theme);
  // A specimen wider than its column (a 390px sheet in a 358px column) is centred on the column and the gutters widen by its overhang,
  // so it never touches its neighbours (it used to run into the gutter and butt against the next column).
  const over = Math.max(0, w - (o.full ? st.w - 2 * st.pad : span * st.colW + (span - 1) * st.gap)); st.over = Math.max(st.over ?? 0, over);
  st.items.push({ node, cap, note, span, full: !!o.full, capGap: o.capGap, over });
  return node;
}
function layoutStage(st) {
  const colY = Array(st.cols).fill(st.pad);
  for (const it of st.items) {
    const capGap = it.capGap ?? sp(2), capH = it.cap ? graph.getNode(it.cap.id).height + capGap : 0, noteH = it.note ? graph.getNode(it.note.id).height + capGap : 0, h = graph.getNode(it.node.id).height;
    const total = capH + h + noteH;
    let start = 0;
    if (it.full) { const y = Math.max(...colY); colY.fill(y); }
    else { let best = Infinity; for (let i = 0; i + it.span <= st.cols; i++) { const m = Math.max(...colY.slice(i, i + it.span)); if (m < best) { best = m; start = i; } } }
    const y = it.full ? colY[0] : Math.max(...colY.slice(start, start + it.span));
    const x = st.pad + start * (st.colW + st.gap + (st.over ?? 0)) - it.over / 2;
    if (it.cap) graph.updateNode(it.cap.id, { x, y });
    graph.updateNode(it.node.id, { x, y: y + capH });
    if (it.note) graph.updateNode(it.note.id, { x, y: y + capH + h + capGap });
    for (let i = start; i < start + it.span; i++) colY[i] = y + total + st.gap;
  }
  graph.updateNode(st.frame.id, { height: Math.ceil(Math.max(...colY) - st.gap + st.pad) });
}
// A stage header: eyebrow, title, one note (full width)
function stageHeader(st, eyebrowText, title, note) {
  const spec = col({ name: 'Header', gap: sp(2) }, eyebrow(eyebrowText, 'gold-on-ground', { spec: true }), T(title, 'display-lg', 'on-ground', { fx: ['shadow-title'], w: 'fill', spec: true }), note ? T(note, 'body', 'on-ground-soft', { w: 'fill', spec: true }) : null, Garland('divider-horses-cream.png', 420));
  put(st, spec, { full: true });
}
// Theme panels share the doc paper chrome: this is the strip with a name and a swatch of the theme's ground
const themeTag = (theme) => `${THEME_NAME[theme]} theme`;

// ------------------------------------------------------------------------------------------------------ page: Foundations
const COLOR_GROUPS = [
  ['Ground and sky', ['ground', 'ground-deep', 'ground-track', 'on-ground', 'on-ground-soft', 'sky-1', 'sky-2', 'sky-3', 'sky-4', 'ledge', 'scrim']],
  ['Paper and ink', ['surface', 'surface-sunken', 'hover-tint', 'ink', 'ink-soft', 'ink-muted', 'line', 'line-strong']],
  ['Wood, rope and brass', ['wood', 'wood-deep', 'wood-hi', 'on-wood', 'on-wood-soft', 'hover-tint-on-wood', 'rope', 'brass']],
  ['Signpost and plank lettering', ['ink-sign', 'sign-scrim', 'plank-scrim']],
  ['Actions and selection', ['gold', 'gold-glow', 'gold-on-ground', 'on-gold', 'on-select', 'terracotta', 'select', 'select-tint', 'pro', 'pro-tint', 'general', 'general-tint', 'focus']],
  ['Status', ['warn', 'warn-tint', 'danger', 'danger-tint', 'alert-on-ground', 'alert-fill', 'on-alert-fill', 'success', 'success-tint']],
  ['Recording, scanning and placards', ['rec', 'rec-ring', 'viewfinder', 'on-viewfinder', 'room-a', 'on-room-a', 'room-b', 'on-room-b', 'room-c', 'on-room-c', 'room-d', 'on-room-d']],
];
{ const seen = new Set(COLOR_GROUPS.flatMap((g) => g[1])); const rest = tokens.color.tokens.map((t) => t.name).filter((n) => !seen.has(n)); if (rest.length) COLOR_GROUPS.push(['Other', rest]); for (const n of seen) if (!COLORS.has(n)) warn(`Foundations: token ${n} no longer exists`); }
const valueText = (name, theme) => cstr(name, theme).toLowerCase().replace(/\s+/g, '').replace(/,0\./g, ',.');
const ringRatio = (tok, bg, theme) => contrast(colorInfo(tok, theme).c, colorInfo(bg, theme).c);
const WOOD_GAP = WOOD_RING_CSS && THEMES.some((th) => ringRatio(WOOD_RING_CSS.tok, 'wood', th) < 3 || ringRatio(WOOD_RING_CSS.tok, 'ground-deep', th) < 3) ? WOOD_RING_CSS : null;   // a component gap, reported (not hidden) by the audit, the Buttons page and the run summary
// Contrast on the intended backgrounds: [foreground, background, kind, note]. text needs 4.5:1, ui (rings, borders) 3:1.
const PAIRS = [
  ['ink', 'surface', 'text'], ['ink', 'surface-sunken', 'text'], ['ink-soft', 'surface', 'text'], ['ink-soft', 'surface-sunken', 'text'], ['ink-muted', 'surface', 'text'], ['ink-muted', 'surface-sunken', 'text'],
  ['on-ground', 'ground', 'text'], [{ tok: 'on-ground-soft', over: 'ground' }, 'ground', 'text', 'on-ground-soft'], ['on-ground', 'ground-deep', 'text'], ['gold-on-ground', 'ground', 'text'], ['gold-on-ground', 'ground-deep', 'text'], ['alert-on-ground', 'ground-deep', 'text'],
  ['on-wood', 'wood', 'text'], ['on-wood', 'wood-deep', 'text'], ...(COLORS.has('plank-scrim') ? [['on-wood', { tok: 'plank-scrim', over: 'wood' }, 'text', 'on-wood on the plank-scrim veil (wood buttons, the inline sign)']] : []), [{ tok: 'on-wood-soft', over: 'wood' }, 'wood', 'text', 'on-wood-soft on wood'], [{ tok: 'on-wood-soft', over: 'wood-deep' }, 'wood-deep', 'text', 'on-wood-soft on wood-deep'],
  ['on-gold', 'gold', 'text'], ['on-select', 'select', 'text'], ['on-select', 'success', 'text'], ['on-select', 'danger', 'text'], ['on-select', 'pro', 'text'], ['on-alert-fill', 'alert-fill', 'text'], ['on-viewfinder', 'viewfinder', 'text'],
  ['on-room-a', 'room-a', 'text'], ['on-room-b', 'room-b', 'text'], ['on-room-c', 'room-c', 'text'], ['on-room-d', 'room-d', 'text'],
  ['select', 'surface', 'text'], [ 'select', { tok: 'select-tint', over: 'surface' }, 'text', 'select on select-tint'], ['pro', 'surface', 'text'], ['pro', { tok: 'pro-tint', over: 'surface' }, 'text', 'pro on pro-tint'], ['general', 'surface', 'text'], ['general', { tok: 'general-tint', over: 'surface' }, 'text', 'general on general-tint'],
  ['warn', 'surface', 'text'], ['warn', { tok: 'warn-tint', over: 'surface' }, 'text', 'warn on warn-tint'], ['danger', 'surface', 'text'], ['danger', { tok: 'danger-tint', over: 'surface' }, 'text', 'danger on danger-tint'], ['success', 'surface', 'text'], ['success', { tok: 'success-tint', over: 'surface' }, 'text', 'success on success-tint'], ['rec', 'surface', 'text'],
  ['line-strong', 'surface-sunken', 'ui', 'control border on sunken paper'], ['line-strong', 'surface', 'ui', 'control border on paper'], ['focus', 'surface', 'ui', 'focus ring on paper'], ['focus', 'surface-sunken', 'ui', 'focus ring on sunken paper'], ['on-wood', 'wood', 'ui', 'focus ring on wood (the plank; the cream ring this sheet draws)'],
  ['select', 'surface-sunken', 'ui', 'selection ring on sunken paper'], ['danger', 'surface-sunken', 'ui', 'error ring on sunken paper'], ['ink', 'surface', 'ui', 'secondary button outline'], ['rec', 'surface', 'ui', 'recording tag outline'], ['on-ground', 'ground', 'ui', 'focus ring on ground'],
  ['on-wood', 'ground-deep', 'ui', 'wood button focus ring (cream, as this sheet draws it) on the ground band'],
  // What bundle.css draws, read at run time. An inset band (one stroke-focus in from the plank's edge) touches the plank's own grain, and the plank's edge stands between it and the ground
  // band, so the ground-band pair is the worst case (a ring that sat flush); a flush ring (an older rule, or none) meets the band for real.
  ...(WOOD_RING_CSS ? [[WOOD_RING_CSS.tok, 'wood', 'ui', `wood button focus ring as bundle.css draws it (${WOOD_RING_CSS.tok}${WOOD_RING_CSS.geom.inset > 0 ? `, inset ${WOOD_RING_CSS.geom.inset}px` : ''}) on the plank`], [WOOD_RING_CSS.tok, 'ground-deep', 'ui', `wood button focus ring as bundle.css draws it (${WOOD_RING_CSS.tok}) on the ground band${WOOD_RING_CSS.geom.inset > 0 ? ', worst case: the plank edge sits between' : ''}`]] : []),
];
const pairName = (x) => (typeof x === 'string' ? x : x.tok);
function auditPairs() {
  const out = [];
  for (const theme of THEMES) for (const [fg, bg, kind, note] of PAIRS) {
    const f = colorInfo(fg, theme), b = colorInfo(bg, theme); const fgc = f.c.a < 1 ? over(f.c, b.c) : f.c, ratio = contrast(fgc, b.c), min = kind === 'ui' ? 3 : 4.5;
    out.push({ theme, fg, bg, kind, note, ratio, min, pass: ratio >= min });
  }
  return out;
}
const AUDIT = auditPairs();

function pageFoundations(pg) {
  // cover
  const hasLockup = hasBrand('hackillinois-lockup.svg');
  const cover = F({ name: 'Cover', w: 1800, h: 380, flex: 'row' },
    F({ name: 'Cover panel', w: 720, h: 'fill', flex: 'col', justify: 'center', gap: sp(4), p: sp(8), theme: 'sunset', fill: 'ground' },
      hasLockup ? Svg('hackillinois-lockup.svg', { w: 320, name: 'HackIllinois lockup' }) : LogoPlaceholder(),
      eyebrow('Judging and admin platform · spec sheet', 'gold-on-ground'), T('Gav-IL', 'cover-name', 'on-ground', { fx: ['shadow-title'] }),
      T(`Generated from the design system: ${SOURCES}.`, 'label', 'on-ground-soft', { weight: 500, w: 'fill' })),
    hasBrand('bg-sunset.png') ? Rc({ name: 'Painted sunset background (brand export)', w: 'fill', h: 'fill', fill: { img: 'bg-sunset.png', mode: 'FILL' } }) : placeholder('bg-sunset.png', 1080, 380));
  pg.tops.push(build(cover, pg.id, 'sunset').id);
  const nightArt = hasBrand('bg-night.png') ? F({ name: 'Painted night background (brand export)', w: 'fill', h: 'fill', flex: 'row', justify: 'center', items: 'center', fill: { img: 'bg-night.png', mode: 'FILL' } }, hasBrand('neon-sign-board.png') ? Rc({ name: 'Neon marquee sign (brand export)', w: 440, h: 260, fill: { img: 'neon-sign-board.png', mode: 'FIT' } }) : null) : placeholder('bg-night.png', 1080, 300);
  pg.tops.push(build(F({ name: 'Cover / night', w: 1800, h: 300, flex: 'row' }, F({ name: 'Night cover panel', w: 720, h: 'fill', flex: 'col', justify: 'center', gap: sp(3), p: sp(8), fill: 'ground', theme: 'night' }, eyebrow('Night theme', 'gold-on-ground'), T('Same paper, darker sky', 'display-lg', 'on-ground', { fx: ['shadow-title'], w: 'fill' }), T('Registration review blue ground, the same cream paper and wood: only ground, sky and ledge change.', 'body', 'on-ground-soft', { w: 'fill' })), nightArt), pg.id, 'night').id);
  sectionColor(pg); sectionContrast(pg); sectionType(pg); sectionSpace(pg); sectionCuts(pg); sectionShadows(pg); sectionMotion(pg); sectionBrand(pg);
}
// A doc section on poster paper: a header frame, then the body (one frame, or two columns side by side that the page stacks in a row)
const secHeader = (name, eyebrowText, title, note, pb) => F({ name: `${name} / header`, w: 1800, flex: 'col', gap: sp(2), pt: sp(8), px: sp(8), pb, fill: 'surface' }, eyebrow(eyebrowText), T(title, 'display-lg', 'ink', { w: 'fill' }), note ? T(note, 'body', 'ink-soft', { w: 'fill' }) : null);
const garlandRow = (pg) => { const g = Garland('divider-horses-brown.png', 640); if (g) pg.tops.push(build(F({ name: 'Section garland', w: 1800, flex: 'row', justify: 'center', py: sp(2), fill: 'surface' }, g), pg.id, 'sunset').id); };
function docSection(pg, name, eyebrowText, title, note, ...body) {
  garlandRow(pg);
  const n = build(F({ name, w: 1800, flex: 'col', gap: sp(6), p: sp(8), fill: 'surface' }, col({ name: 'Section header', gap: sp(2), w: 'fill' }, eyebrow(eyebrowText), T(title, 'display-lg', 'ink', { w: 'fill' }), note ? T(note, 'body', 'ink-soft', { w: 'fill' }) : null), body), pg.id, 'sunset'); pg.tops.push(n.id); return n;
}
function docSection2(pg, name, eyebrowText, title, note, left, right) {
  garlandRow(pg);
  const h = build(secHeader(name, eyebrowText, title, note, sp(6)), pg.id, 'sunset');
  const colF = (side, items) => build(F({ name: `${name} / ${side}`, w: 900, flex: 'col', gap: sp(5), pl: side === 'left' ? sp(8) : sp(4), pr: side === 'left' ? sp(4) : sp(8), pb: sp(8), fill: 'surface' }, items), pg.id, 'sunset');
  pg.tops.push(h.id, [colF('left', left).id, colF('right', right).id]);
}
// split a list into two columns of similar weight (weights = rows in each item), keeping order
function balance(items, weight) { let best = 1, bd = Infinity; const tot = items.reduce((a, x) => a + weight(x), 0); let acc = 0; items.forEach((x, i) => { acc += weight(x); const d = Math.abs(tot - 2 * acc); if (d < bd) { bd = d; best = i + 1; } }); return [items.slice(0, best), items.slice(best)]; }
// translucent tokens are drawn over the surface they are meant for, so the swatch shows what the app shows
const ALPHA_BASE = { 'ground-track': 'ground-deep', 'on-ground-soft': 'ground', 'hover-tint-on-wood': 'wood', 'on-wood-soft': 'wood', 'gold-glow': 'ground', scrim: 'ground' };
const sw = (name, theme, w = 56, h = 40) => {
  // One rectangle with its own fill and outline: the outline is painted over the fill, so a swatch as light as the paper (surface) keeps
  // its edge (a stroke on a parent frame is painted under its children, and surface was cream on cream). A translucent token sits on its base.
  const alpha = parse(cstr(name, theme)).a < 1;
  const chip = Rc({ name: 'Swatch', w, h, rounded: RSM, fill: name, stroke: 'line-strong', sw: 1, sa: 'INSIDE', theme });
  return alpha ? F({ name: `Swatch ${theme} (over its base)`, w, h, rounded: RSM, fill: ALPHA_BASE[name] ?? 'surface', theme, clip: true }, chip) : { ...chip, p: { ...chip.p, name: `Swatch ${theme}` } };
};
function sectionColor(pg) {
  const groups = COLOR_GROUPS.map(([title, names]) => ({ n: names.length + 2, spec: col({ name: `Colors / ${title}`, w: 'fill', gap: sp(1) }, T(title, 'title', 'ink', { w: 'fill' }),
    row({ name: 'Column heads', w: 'fill', gap: sp(4), py: sp(1) }, F({ name: 'Token head', w: 'fill', flex: 'row' }, eyebrow('Token and use')), F({ name: 'Sunset head', w: 216, flex: 'row' }, eyebrow(THEME_NAME.sunset)), F({ name: 'Night head', w: 216, flex: 'row' }, eyebrow(THEME_NAME.night))),
    names.filter((n) => COLORS.has(n)).map((n) => {
      const t = COLORS.get(n), same = typeof t.value === 'string';
      return row({ name: `Row / ${n}`, w: 'fill', gap: sp(4), py: sp(2), items: 'center' },
        col({ w: 'fill', gap: sp(1) }, T(n, 'body-strong', 'ink', { w: 'fill', name: `Token ${n}` }), T(firstSentence(tokenUsage(t), 150), 'label', 'ink-soft', { weight: 400, w: 'fill', name: `Usage of ${n}` })),
        sw(n, 'sunset'), T(valueText(n, 'sunset'), 'label', 'ink-soft', { weight: 500, w: 144 }), sw(n, 'night'), T(same ? 'same' : valueText(n, 'night'), 'label', 'ink-soft', { weight: 500, w: 144 }));
    })) }));
  const [l, r] = balance(groups, (g) => g.n);
  docSection2(pg, 'Foundations / Color', 'Foundations', 'Color', `${tokens.color.tokens.length} tokens, two themes. Paper (surface) is cream in both; only the ground, sky and ledge change. Every fill in this file is bound to a variable in "Gav-IL color · Sunset" or "Gav-IL color · Night". Translucent tokens are drawn over the surface they sit on.`, l.map((g) => g.spec), r.map((g) => g.spec));
}
function pairTile(i, rs, rn) {
  const pr = PAIRS[i], [fg, bg, kind, note] = pr, label = note ?? `${pairName(fg)} on ${pairName(bg)}`, pass = rs.pass && rn.pass;
  const sample = (theme) => F({ name: `Sample ${theme}`, w: 44, h: 64, flex: 'row', justify: 'center', items: 'center', fill: bg, theme }, kind === 'ui' ? Rc({ name: 'Ring sample', w: 28, h: 20, rounded: RSM, stroke: fg, sw: 3, theme }) : T('Aa', 'title', fg, { theme, align: 'center' }));
  return row({ name: `Contrast / ${label}`, w: 406, gap: 0, items: 'center', rounded: RSM, fill: 'surface', stroke: 'line', sw: 1, clip: true },
    sample('sunset'), sample('night'),
    col({ name: 'Result', w: 'fill', gap: sp(1), px: sp(3), py: sp(2), justify: 'center' }, T(label, 'label', 'ink', { weight: 600, w: 'fill' }), T(`${fmtRatio(rs.ratio)} · ${fmtRatio(rn.ratio)}`, 'label', 'ink-soft', { weight: 500, w: 'fill' }),
      Badge(pass ? (kind === 'ui' ? 'UI pass' : 'AA pass') : `FAIL < ${rs.min}`, pass ? 'success' : 'danger', { name: pass ? 'pass' : 'fail' })));
}
function sectionContrast(pg) {
  const n = PAIRS.length, fails = PAIRS.filter((_, i) => !(AUDIT[i].pass && AUDIT[n + i].pass));   // tiles (a pair in either theme), not theme entries
  docSection(pg, 'Foundations / Contrast', 'Foundations', 'Contrast on the intended backgrounds', `Computed from tokens.json: text needs 4.5:1, controls and focus rings 3:1; translucent tokens are composited over the background first. Each tile shows Sunset then Night (sunset ratio · night ratio). ${fails.length ? `${fails.length} of ${n} pairs are below target: see the red badges (the bundle.css wood button focus ring, a component gap: see the Buttons page).` : `All ${n} pairs pass in both themes.`}`,
    row({ name: 'Pairs', w: 'fill', gap: sp(4), wrap: true, rowGap: sp(4), items: 'start' }, PAIRS.map((_, i) => pairTile(i, AUDIT[i], AUDIT[n + i]))));
}
function sectionType(pg) {
  const groups = tokens.type.groups.map((g) => ({ n: g.styles.length, spec: col({ name: `Type / ${g.name}`, w: 'fill', gap: sp(2) }, T(`${g.name} · ${FAMILY[g.family]}`, 'title', 'ink', { w: 'fill' }),
    g.styles.map((s0) => {
      const s = TYPE[s0.name], big = s.size > 100, z = big ? 0.25 : 1, shown = Math.round(s.size * z), lh = Math.round(s.line * z);
      return col({ name: `Style / ${s.name}`, w: 'fill', gap: sp(1), py: sp(2) },
        row({ w: 'fill', gap: sp(3) }, T(s.name, 'body-strong', 'ink'), T(`${s.family} ${s.weight} · ${s.size}/${s.line}${s.ls ? ` · ${s.em > 0 ? '+' : ''}${(s.em * 100).toFixed(0)}%` : ''}${big ? ' · shown at 25%' : ''}`, 'label', 'ink-soft', { weight: 500 })),
        F({ name: 'Sample', w: 'fill', flex: 'row', items: 'center', p: sp(3), fill: 'surface-sunken', rounded: RSM, clip: true }, T(s.sample, s.name, 'ink', { name: `Sample / ${s.name}`, size: shown, lineHeight: lh, ls: +(s.ls * z).toFixed(2), w: 'fill' })),
        T(firstSentence(s.usage, 170), 'label', 'ink-soft', { weight: 400, w: 'fill' }));
    })) }));
  const [l, r] = [[groups[0], groups[2]], [groups[1]]];   // Display + Text | Condensed (about the same height)
  docSection2(pg, 'Foundations / Type scale', 'Foundations', 'Type scale', 'Four Google Fonts, loaded by name: Ultra for titles, Oswald for buttons and numbers, Manrope for reading, Rye for sign lettering. Every style is a token; the sizes, line heights and tracking (em x size) are the exact ones in the components.', l.map((g) => g.spec), r.map((g) => g.spec));
}
function sectionSpace(pg) {
  const spaces = tokens.spacing.tokens.map((t) => { const n = pxNum(t.value); return row({ name: `Space / ${t.name}`, w: 'fill', gap: sp(4), items: 'center' }, T(t.name, 'body-strong', 'ink', { w: 120 }), T(t.value, 'label', 'ink-soft', { weight: 500, w: 64 }), Rc({ name: `Bar ${t.name}`, w: n * 4, h: sp(4), fill: 'select' }), T(firstSentence(t.usage, 80), 'body-sm', 'ink-soft', { weight: 400, w: 'fill' })); });
  const boxes = ['tap-min', 'mark-h', 'star-size', 'prop-h-sm', 'prop-h', 'icon-sm', 'icon-md', 'icon-lg', 'rec-size'].filter((n) => NUM[n] != null).map((n) => col({ name: `Scale / ${n.replace('icon', 'glyph')}`, gap: sp(2), items: 'center' }, n === 'rec-size' ? El({ name: `Sample disc ${NUM[n]}`, w: NUM[n], h: NUM[n], stroke: 'rec', sw: 2, fill: 'surface-sunken' }) : Rc({ name: `Sample box ${NUM[n]}`, w: NUM[n], h: NUM[n], rounded: RSM, stroke: 'select', sw: 2, fill: 'surface-sunken' }), T(n, 'label', 'ink', { weight: 600 }), T(`${NUM[n]}px`, 'label', 'ink-soft', { weight: 500 })));
  const strokes = ['stroke-hair', 'stroke', 'stroke-focus'].map((n) => row({ name: `Stroke / ${n}`, gap: sp(3), items: 'center', w: 'fill' }, T(n, 'body-strong', 'ink', { w: 120 }), Rc({ name: `Line ${n}`, w: 160, h: NUM[n], fill: 'ink' }), T(`${NUM[n]}px`, 'label', 'ink-soft', { weight: 500 })));
  docSection(pg, 'Foundations / Spacing and sizes', 'Foundations', 'Spacing and sizes', 'A 4px grid. Judge controls are at least tap-min (48px); sm buttons are for dense admin tables only. Bars below are drawn at 4x.', col({ gap: sp(2), w: 'fill' }, spaces), row({ name: 'Sizes', gap: sp(8), items: 'end', w: 'fill' }, boxes), col({ gap: sp(2), w: 'fill' }, strokes),
    T(`phone-max ${NUM['phone-max']}px · admin-max ${NUM['admin-max']}px · placard ${tokens.size.tokens.find((t) => t.name === 'placard-w')?.value} x ${tokens.size.tokens.find((t) => t.name === 'placard-h')?.value}`, 'body-sm', 'ink-soft', { weight: 500, w: 'fill' }));
}
function sectionCuts(pg) {
  const chamfer = (name, cx, note) => col({ name: `Cut / ${name}`, gap: sp(2), items: 'start' }, F({ name: `Plate ${name}`, w: 160, h: 56, plate: [{ kind: 'chamfer', a: { cx, cy: +(cx * 0.75).toFixed(2) }, fill: 'gold' }] }), T(name, 'body-strong', 'ink'), T(`${cx}px cut${note ? ' · ' + note : ''}`, 'label', 'ink-soft', { weight: 500 }));
  const cuts = ['cut-sm', 'cut-md', 'cut-lg'].filter((n) => NUM[n]).map((n) => chamfer(n, NUM[n], `${NUM[n]}w x ${+(NUM[n] * 0.75).toFixed(1)}h`));
  const arrows = [['next', 'arrow-tip'], ['back', 'arrow-tip']].map(([k]) => col({ name: `Arrow / ${k}`, gap: sp(2), items: 'start' }, F({ name: `Plate arrow ${k}`, w: 160, h: 56, plate: [{ kind: k, a: { tip: NUM['arrow-tip'], notch: NUM['cut-md'] }, fill: 'gold' }] }), T(`shape="${k}"`, 'body-strong', 'ink'), T(`arrow-tip ${NUM['arrow-tip']} · notch ${NUM['cut-md']}`, 'label', 'ink-soft', { weight: 500 })));
  const ticket = col({ name: 'Ticket stub', gap: sp(2), items: 'start' }, F({ name: 'Plate ticket', w: 160, h: 40, plate: [{ kind: 'ticket', a: { r: NUM.notch }, fill: 'gold' }] }), T('notch', 'body-strong', 'ink'), T(`${NUM.notch}px bite, compare order tag`, 'label', 'ink-soft', { weight: 500 }));
  const radii = ['radius-sm', 'radius-md', 'radius-lg', 'radius-pill'].map((n) => col({ name: `Radius / ${n}`, gap: sp(2), items: 'start' }, Rc({ name: `Sample ${n}`, w: 120, h: 56, rounded: NUM[n], fill: 'surface-sunken', stroke: 'ink', sw: 2 }), T(n, 'body-strong', 'ink'), T(`${NUM[n] >= 9999 ? '9999 (pill)' : NUM[n] + 'px'}`, 'label', 'ink-soft', { weight: 500 })));
  docSection(pg, 'Foundations / Cuts and radii', 'Foundations', 'Cuts and radii', 'The Figma chamfer is the signature. Filled controls cut their corners (8px on phones, 16 x 12 on web); outlined controls on paper use radius-sm so a cut never clips the outline. OpenPencil has no clip-path, so cuts here are vector plates behind the label.', row({ gap: sp(8), items: 'start', w: 'fill', wrap: true, rowGap: sp(6) }, cuts, arrows, ticket), row({ gap: sp(8), items: 'start', w: 'fill', wrap: true, rowGap: sp(6) }, radii));
}
function sectionShadows(pg) {
  const names = tokens.shadow.tokens.map((t) => t.name);
  const tile = (theme, n) => {
    const base = { theme, name: `Shadow / ${n} / ${theme}` };
    let demo;
    if (n === 'shadow-title') demo = T('Round 1', 'display', 'on-ground', { theme, fx: [n], name: 'Title sample' });
    else if (n === 'shadow-sign') demo = F({ name: 'Wood sign', flex: 'row', p: sp(3), fill: woodFill(), theme }, T('A12', 'room-hero', 'on-wood', { theme, fx: [n], name: 'Sign sample' }));
    else if (n === 'shadow-plank' || n === 'shadow-plank-edge' || n === 'shadow-plank-edge-up') demo = Rc({ name: 'Plank', w: 160, h: 48, fill: woodFill(), fx: [n], theme });
    else if (n === 'shadow-rule') demo = Card({ name: 'Rule card', fx: ['shadow-ledge'], gap: 0, w: 160, h: 72, pad: sp(2) }, T('Poster card', 'label', 'ink'));
    else if (n === 'shadow-rosette') demo = F({ name: 'Rosette', w: 64, h: 64, flex: 'row', justify: 'center', items: 'center', rounded: 32, fill: 'rope', stroke: 'wood-deep', sw: 3, theme }, El({ name: 'Rosette center', w: 40, h: 40, fill: 'gold', stroke: 'wood-deep', sw: 2 }));
    else if (n === 'shadow-star') demo = { t: 'path', p: { name: 'Sheriff star (the .gv-star polygon, to show the shadow)', d: STAR_PATH(64), w: 64, h: 64, fill: 'brass', fx: [n], theme }, c: [] };
    else if (n === 'shadow-stamp') demo = Badge('Judged', 'success', { stamp: true, paper: true });
    else demo = Card({ name: 'Ledge card', fx: [n], gap: 0, w: 160, h: 72, pad: sp(2) }, T('Card', 'label', 'ink'));
    return F({ ...base, w: 260, h: 128, flex: 'col', justify: 'center', items: 'center', gap: sp(2), p: sp(3), fill: 'ground', theme }, demo, T(n, 'label', 'on-ground-soft', { theme, weight: 600 }));
  };
  const rows = names.map((n) => row({ name: `Shadow row / ${n}`, w: 'fill', gap: sp(4), items: 'center' }, tile('sunset', n), tile('night', n), col({ w: 'fill', gap: sp(1) }, T(n, 'body-strong', 'ink'), T(shadowLayers(n, 'sunset').map((l) => `${l.inset ? 'inset ' : ''}${l.x} ${l.y} ${l.blur}${l.spread ? ' ' + l.spread : ''} ${l.color}`).join(' | '), 'label', 'ink-soft', { weight: 500, w: 'fill' }), T(firstSentence(tokenUsage(tokens.shadow.tokens.find((t) => t.name === n)), 130), 'body-sm', 'ink-soft', { weight: 400, w: 'fill' }))));
  docSection(pg, 'Foundations / Shadows', 'Foundations', 'Shadows', 'Hard offsets, not blurs: a ledge under cards, a carved edge under sign lettering, a double rule that frames a poster. Shown on both grounds. Inset shadows (rule, stamp, focus) are drawn as inside strokes and rings.', col({ gap: sp(3), w: 'fill' }, rows));
}
// cubic-bezier plot: x 20..180, y 200 at 0 and 80 at 1 (room above for the overshoot of ease-stamp)
function easePlot(name) {
  const v = MOTION[name].value; const m = /cubic-bezier\(([^)]+)\)/.exec(v); if (!m) return null; const [x1, y1, x2, y2] = m[1].split(',').map(parseFloat);
  const X = (u) => +(u * 160).toFixed(1), Y = (u) => +(150 - u * 120).toFixed(1);
  const curve = `M0 ${Y(0)}C${X(x1)} ${Y(y1)} ${X(x2)} ${Y(y2)} ${X(1)} ${Y(1)}`;
  return col({ name: `Easing / ${name}`, gap: sp(1), items: 'start' },
    F({ name: `Plot ${name}`, w: 200, h: 190, rounded: RSM, fill: 'surface-sunken', stroke: 'line', sw: 1, clip: true },
      { t: 'path', p: { name: 'Linear guide', d: `M0 ${Y(0)}L${X(1)} ${Y(1)}`, w: 160, h: 150, stroke: 'line-strong', sw: 1, x: 20, y: 10, cap: 'NONE' }, c: [] },
      { t: 'path', p: { name: `Curve ${name}`, d: curve, w: 160, h: 150, stroke: 'select', sw: 3, x: 20, y: 10 }, c: [] }),
    T(name, 'body-strong', 'ink'), T(v.replace('cubic-bezier', ''), 'label', 'ink-soft', { weight: 500 }), T(firstSentence(MOTION[name].usage, 90), 'label', 'ink-muted', { weight: 500, w: 200 }));
}
function sectionMotion(pg) {
  const eases = tokens.motion.tokens.filter((t) => t.name.startsWith('ease-')).map((t) => easePlot(t.name)).filter(Boolean);
  const durs = tokens.motion.tokens.filter((t) => /^(dur|stagger|demo-latency)/.test(t.name)).map((t) => {
    const ms = pxNum(String(t.value).replace('ms', '')) ?? null; const isMs = /ms$/.test(String(t.value)); const product = /(never reduced|product rule|not reduced)/i.test(t.usage) || ['dur-settle', 'dur-undo', 'dur-cant-find'].includes(t.name);
    const long = isMs && ms > 1000, barW = isMs ? Math.min(500, Math.max(4, Math.round(ms / 2))) : null;   // 1px per 2ms up to a second; a longer duration fills the track and runs on in dots (a bar for 180000ms cannot be drawn)
    return row({ name: `Motion / ${t.name.replace('stagger', 'offset')}`, w: 'fill', gap: sp(4), items: 'center', py: 4 }, T(t.name, 'body-strong', 'ink', { w: 160 }), T(String(t.value), 'label', 'ink', { weight: 600, w: 72 }), (t.reduced != null || product) ? T(t.reduced != null ? `reduced ${t.reduced}` : 'never reduced', 'label', 'ink-soft', { weight: 500, w: 96 }) : F({ name: 'No reduced value', w: 96, h: 1 }),
      barW ? (() => { const bar = (w, name) => Rc({ name, w, h: sp(3), rounded: NUM['radius-pill'], fill: product ? 'success' : 'select' });
        return long ? row({ name: `Bar ${t.name} (over 1000 ms: full track, then dots)`, gap: sp(1), items: 'center' }, bar(barW, `Bar ${t.name}`), [1, 2, 3].map((i) => Rc({ name: `Runs on ${i}`, w: sp(1), h: sp(3), rounded: NUM['radius-pill'], fill: product ? 'success' : 'select' }))) : bar(barW, `Bar ${t.name.replace('stagger', 'offset')}`); })()
        : Rc({ name: 'No bar (not a time)', w: 4, h: sp(3), fill: 'line-strong' }), T(firstSentence(t.usage, 100), 'body-sm', 'ink-soft', { weight: 400, w: 'fill' }));
  });
  const other = tokens.motion.tokens.filter((t) => !/^(ease-|dur|stagger|demo-latency)/.test(t.name)).map((t) => row({ name: `Motion / ${t.name.replace('stagger', 'offset')}`, w: 'fill', gap: sp(4), items: 'start', py: 4 }, T(t.name, 'body-strong', 'ink', { w: 160 }), T(String(t.value), 'label', 'ink', { weight: 600, w: 72 }), t.reduced != null ? T(`reduced ${t.reduced}`, 'label', 'ink-soft', { weight: 500, w: 96 }) : F({ name: 'No reduced value', w: 96, h: 1 }), T(firstSentence(t.usage, 150), 'body-sm', 'ink-soft', { weight: 400, w: 'fill' })));
  docSection(pg, 'Foundations / Motion', 'Foundations', 'Motion', 'Motion is a token family shared by CSS and JS. Bars are drawn at 1px per 2ms up to 1000ms (500px); a longer duration fills the track and runs on in three dots (green = product rules that never reduce). Under reduced motion every token with a "reduced" value switches in one place.',
    T('Easing curves', 'title', 'ink'), row({ name: 'Curves', gap: sp(6), items: 'start', wrap: true, rowGap: sp(6), w: 'fill' }, eases), T('Durations', 'title', 'ink'), col({ gap: 0, w: 'fill' }, durs), T('Multipliers, distances and gesture physics', 'title', 'ink'), col({ gap: 0, w: 'fill' }, other));
}
// assets/brand/MANIFEST.md rows: | `file` | what it is | source | format | size | intended use |
function readManifest() {
  const f = path.join(BRAND, 'MANIFEST.md'); const out = {}; if (!fs.existsSync(f)) return out;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) { const c = line.split('|').map((x) => x.trim()); if (c.length >= 7 && /^`[^`]+`$/.test(c[1])) out[c[1].slice(1, -1)] = { what: c[2], use: c[6] }; }
  return out;
}
const BRAND_GROUPS = [
  ['Marks', ['h-mark.svg', 'hackillinois-lockup.svg', 'longhorn-logo.svg', 'longhorn-logo-alt.svg']],
  ['Characters', ['character-teal-sphere-cowboy.svg', 'character-yellow-wedge.svg', 'character-orange-block-cowboy.svg']],
  ['Painted backgrounds', ['bg-sunset.png', 'bg-night.png', 'bg-desert-path.jpg']],
  ['Wood and signposts', ['wood-plank-default.png', 'wood-plank-left.png', 'wood-plank-right.png', 'wood-plank-default.svg', 'wood-plank-left.svg', 'wood-plank-right.svg', 'signpost-nav@2x.png']],
  ['Garlands, friezes and progress', ['divider-horses-cream.png', 'divider-horses-brown.png', 'divider-horses-grey.png', 'divider-horses-lime.png', 'divider-horses-orange.png', 'divider-horseshoes.png', 'divider-cowboy-hats.png', 'frieze-horses-sunset.png', 'frieze-horses-night.png', 'progress-stars.png']],
  ['Props and neon', ['neon-sign-board.png', 'neon-sign-arrow.png', 'wagon.png', 'horseshoe-gold.png', 'cactus-tall.png', 'cactus-round.png', 'cactus-bushes.png']],
];
const WHITE_ART = new Set(['h-mark.svg', 'hackillinois-lockup.svg']);
function brandTile(file, man, tokenName) {
  const ext = path.extname(file).slice(1), isSvg = ext === 'svg', heavy = isSvg && /^character-/.test(file), sz = !isSvg ? pngSize(file) : null;
  const tw = 260, aw = tw - 2 * sp(3), label = file.replace(/^derived\//, '').replace(/\.[^.]+$/, '');
  let art;
  if (isSvg && !heavy) art = Svg(file, { w: file.startsWith('longhorn') ? 130 : file === 'h-mark.svg' ? 48 : 200, name: label });
  else if (heavy) { const r = rasterOf(file); art = r ? Rc({ name: label, w: 160, h: 160, fill: { img: r, mode: 'FIT' } }) : placeholder(file, 160, 160); }
  else { const ar = sz ? sz[1] / sz[0] : 0.6; const h = Math.min(220, Math.max(24, Math.round(aw * ar))); const w = ar > 1 ? Math.round(h / ar) : aw; art = Rc({ name: label, w, h, fill: { img: file, mode: 'FIT' } }); }
  const bg = WHITE_ART.has(file) || /^(bg-|divider-horses-cream|divider-horseshoes|frieze|progress|neon|wood-plank|signpost|derived\/(bg-|garland-cream|neon|plank|signpost|star))/.test(file) ? 'ground' : 'surface-sunken';
  return col({ name: `Brand / ${file}`, gap: sp(1), items: 'start', w: tw },
    F({ name: 'Brand tile', w: tw, flex: 'row', justify: 'center', items: 'center', p: sp(3), minH: 96, rounded: RSM, fill: bg, stroke: 'line', sw: 1 }, art),
    T(label, 'body-strong', 'ink', { w: 'fill', name: `Brand ${label}` }), T(tokenName ? `${tokenName} · ${file}` : file, 'label', 'ink-soft', { weight: 500, w: 'fill', name: `Brand file ${label}` }), man ? T(firstSentence(String(man.use).replace(/`/g, ''), 90), 'label', 'ink-muted', { weight: 500, w: 'fill', name: `Brand use ${label}` }) : null);
}
function sectionBrand(pg) {
  const man = readManifest(), present = fs.existsSync(BRAND) ? fs.readdirSync(BRAND).filter((f) => /\.(png|svg|jpg)$/.test(f)) : [];
  const listed = new Set(BRAND_GROUPS.flatMap((g) => g[1])), extra = present.filter((f) => !listed.has(f) && !/^wood-plank-.*\.svg$/.test(f));
  const groups = [...BRAND_GROUPS, ...(extra.length ? [['Other', extra]] : [])].map(([title, files]) => ({ title, files: files.filter((f) => present.includes(f)) })).filter((g) => g.files.length);
  const missing = BRAND_GROUPS.flatMap((g) => g[1]).filter((f) => !present.includes(f));
  for (const f of missing) brandMissing(f, 'its tile is left out of the Brand assets section');
  const blocks = groups.map((g) => [T(g.title, 'title', 'ink', { w: 'fill', name: `Group ${g.title}` }), row({ name: `Brand tiles / ${g.title}`, w: 'fill', gap: sp(5), wrap: true, rowGap: sp(5), items: 'start' }, g.files.map((f) => brandTile(f, man[f])))]);
  // What the screens actually load: assets/brand/derived/*.webp (the same pixels cropped to their alpha bounds and re-encoded), each one an art-* token in tokens.json.
  const dDir = path.join(BRAND, 'derived'), dFiles = fs.existsSync(dDir) ? fs.readdirSync(dDir).filter((f) => /\.webp$/.test(f)).sort() : [];
  const tokFor = (f) => (tokens.asset?.tokens ?? []).find((t) => t.name.startsWith('art-') && JSON.stringify(t.value).includes(`derived/${f}`));
  if (dFiles.length) blocks.push([T('What the screens load: assets/brand/derived/ (the art-* tokens)', 'title', 'ink', { w: 'fill', name: 'Group derived' }), row({ name: 'Brand tiles / derived', w: 'fill', gap: sp(5), wrap: true, rowGap: sp(5), items: 'start' }, dFiles.map((f) => { const t = tokFor(f); return brandTile(`derived/${f}`, t ? { use: t.usage } : null, t?.name); }))]);
  docSection(pg, 'Foundations / Brand assets', 'Foundations', 'Brand assets in use', `Real 2027 exports from assets/brand/, placed as supplied: nothing is redrawn or recolored (${present.length} files${Object.keys(man).length ? ', described in MANIFEST.md' : ''}). The last group is what the screens load: the derived/ copies, cropped to their alpha bounds and re-encoded as WebP, each an art-* token. Characters are rasterized once from their SVGs because they carry hundreds of paths. ${missing.length ? `Not exported yet (absent here): ${missing.join(', ')}.` : ''} The planks the buttons and signs are cut from are the PNG ones (derived/plank-*.webp); the three vectorized copies (wood-plank-*.svg) are shown for reference and not placed on a screen.`, ...blocks);
}

// ------------------------------------------------------------------------------------------------------ pages
const themedStage = (pg, theme, { name, kicker, title, note, cols = 4, colW = 358 }) => {
  const st = stage(pg, { name: `${name} / ${THEME_NAME[theme]}`, theme, cols, colW });
  stageHeader(st, `${kicker} · ${THEME_NAME[theme]} theme`, title, note); return st;
};
const flowStage = (pg, theme, name, ...c) => { const n = build(F({ name: `${name} / ${THEME_NAME[theme]}`, w: 1800, flex: 'col', gap: sp(4), p: sp(8), fill: 'ground', theme }, c), pg.id, theme); pg.tops.push(n.id); return n; };
const titleBlock = (kicker, title, note) => col({ name: 'Header', w: 'fill', gap: sp(2) }, eyebrow(kicker, 'gold-on-ground'), T(title, 'display-lg', 'on-ground', { fx: ['shadow-title'], w: 'fill' }), note ? T(note, 'body', 'on-ground-soft', { w: 'fill' }) : null, Garland('divider-horses-cream.png', 420));

// ---- Buttons: every variant x state at the default and sm sizes, both themes
const STATES = ['default', 'pressed', 'disabled', 'loading', 'focus'];
const STATE_NOTE = { default: 'at rest', pressed: 'scale 0.96, fill darker or washed', disabled: 'sunken plate, never faded', loading: 'keeps the fill, spinner + label', focus: '3px inset ring, not an outline' };
const BW = 240;
function pageButtons(pg) {
  for (const theme of THEMES) {
    const cells = (o) => STATES.map((st) => (o.link ? (st === 'loading' ? T('n/a', 'label', 'ink-muted', { w: BW }) : LinkBtn({ label: o.label, icon: o.icon, state: st, w: BW })) : Btn({ ...o, state: st, w: BW })));
    const mk = (name, usage, o, ctx = 'paper') => {
      const wood = ctx === 'wood', deep = ctx === 'ground';   // ground: the wood button sits on a darker band of the ground
      return F({ name: `Row / ${name}`, w: 'fill', flex: 'row', items: 'center', gap: sp(4), px: sp(5), py: sp(4), fill: wood ? woodFill() : deep ? 'ground-deep' : 'surface', rounded: RMD, stroke: wood || deep ? undefined : 'line', sw: 1, fx: ['shadow-ledge'] },
        col({ w: 220, gap: sp(1) }, T(name, 'body-strong', wood ? 'on-wood' : deep ? 'on-ground' : 'ink', { w: 'fill' }), T(usage, 'label', wood ? 'on-wood-soft' : deep ? 'on-ground-soft' : 'ink-soft', { weight: 500, w: 'fill' })), cells({ ctx: deep ? 'paper' : ctx, bg: deep ? 'ground-deep' : undefined, ...o }));
    };
    const head = row({ name: 'State heads', w: 'fill', gap: sp(4), pl: sp(5) + 220 + sp(4) }, STATES.map((s) => col({ w: BW, gap: sp(1) }, T(s, 'caps', 'on-ground', { upper: true }), T(STATE_NOTE[s], 'label', 'on-ground-soft', { weight: 500, w: BW }))));
    const sub = (t, n) => col({ gap: sp(1), w: 'fill', pt: sp(4) }, T(t, 'title', 'on-ground', { w: 'fill' }), T(n, 'body-sm', 'on-ground-soft', { weight: 400, w: 'fill' }));
    flowStage(pg, theme, 'Buttons', titleBlock(`Buttons · ${THEME_NAME[theme]} theme`, 'Buttons', `${BTN.variants.length + 2} variants (${[...BTN.variants, 'next', 'back'].join(', ')}) and the link button, in every state. Filled controls are chamfered plates behind the label; outlined and ghost controls are radius-sm. One primary per screen. Sizes and fills are read from bundle.css.`), head,
      sub('Default size · 48px', 'Labels are uppercase Oswald (the type-button token), start with a verb and name the result.'),
      mk('primary', 'One per screen. gold, on-gold.', { variant: 'primary', label: 'Submit evaluation' }),
      mk('secondary', 'Alternatives. Ink outline, radius-sm.', { variant: 'secondary', label: 'Try again', icon: 'rotate-ccw' }),
      mk('ghost', 'Escape hatches. Text only.', { variant: 'ghost', label: 'Skip' }),
      mk('danger text', 'ghost-danger: opens a confirm.', { variant: 'ghost-danger', label: 'Remove', icon: 'trash' }),
      mk('danger', 'Solid: the commit inside a confirm.', { variant: 'danger', label: 'Stop and delete' }),
      mk('wood', 'The real plank as a 3-slice (art-plank-flat), under the plank-scrim veil.', { variant: 'wood', label: 'Open map', icon: 'map' }, 'ground'),
      mk('wood next', 'The arrow plank that points right (art-plank-point-right).', { variant: 'wood', shape: 'next', label: 'Next' }, 'ground'),
      mk('wood back', 'The arrow plank that points left (art-plank-point-left).', { variant: 'wood', shape: 'back', label: 'Back' }, 'ground'),
      WOOD_GAP ? row({ name: 'Component gap note', w: 'fill', gap: sp(2), items: 'start', px: sp(2) }, Ic('alert', 16, 'gold-on-ground'),
        T(`Component gap, not drawn above: bundle.css gives a focused wood button the ${WOOD_GAP.tok} ring (${WOOD_GAP.rule}): ${fmtRatio(ringRatio(WOOD_GAP.tok, 'wood', theme))} on the plank and ${fmtRatio(ringRatio(WOOD_GAP.tok, 'ground-deep', theme))} on this band, under the 3:1 of AGENTS rule 4. The focus specimens above show the cream on-wood ring that the wood container rule already uses. Fix in bundle.css: give the wood variant its own :focus-visible ring in on-wood.`, 'body-sm', 'gold-on-ground', { weight: 600, w: 'fill', name: 'Component gap text' })) : null,
      WOOD_RING_CSS?.clip && WOOD_RING_CSS.geom.inset > 0 ? row({ name: 'Wood focus note', w: 'fill', gap: sp(2), items: 'start', px: sp(2) },
        T(`Wood focus: a cream ${WOOD_RING_CSS.tok} band ${WOOD_RING_CSS.geom.w}px wide, ${WOOD_RING_CSS.geom.inset}px in from the plank's edge, following its cut (the chamfer, or the 45-degree arrow). The plank keeps its own dark edge outside the ring (the wood button's focus rule in bundle.css).`, 'body-sm', 'on-ground-soft', { weight: 500, w: 'fill', name: 'Wood focus note text' })) : null,
      mk('next', 'Arrow shape, forward.', { variant: 'primary', shape: 'next', label: 'Next' }),
      mk('back', 'Arrow shape, back.', { variant: 'secondary', shape: 'back', label: 'Back' }),
      mk('link button', '.gv-link: caps text, select color.', { link: true, label: 'Floor plan', icon: 'map' }),
      sub('On wood: the app bar and the action bar', 'A secondary is a sunken chamfered plank; a ghost is cream text; focus rings flip to cream. Disabled becomes wood-deep.'),
      mk('primary', 'gold on wood; ring wood-deep + cream.', { variant: 'primary', label: 'Submit evaluation' }, 'wood'),
      mk('secondary', 'surface-sunken plank.', { variant: 'secondary', label: 'Floor plan', icon: 'map' }, 'wood'),
      mk('ghost', 'cream text.', { variant: 'ghost', label: 'My notes', icon: 'notes' }, 'wood'),
      mk('next', 'forward arrow.', { variant: 'primary', shape: 'next', label: 'Next' }, 'wood'),
      mk('back', 'back arrow.', { variant: 'secondary', shape: 'back', label: 'Back' }, 'wood'),
      sub('lg · the single forward action on a judge screen · 56px', 'Sits in the action bar, on the right.'),
      mk('primary lg', 'Oswald 18, cut-md.', { variant: 'primary', size: 'lg', label: 'Submit evaluation' }),
      mk('secondary lg', 'Same size, outlined.', { variant: 'secondary', size: 'lg', label: 'Floor plan', icon: 'map' }),
      mk('primary lg + arrow', 'Next table.', { variant: 'primary', size: 'lg', label: 'Next table', iconRight: 'arrow' }),
      sub(`sm · dense admin tables only · ${BTN.sm.h}px on desktop, 48px under 600px`, 'The only controls under tap-min. They grow to 48px on a phone (last row).'),
      mk('primary sm', 'caps 14, cut 6.', { variant: 'primary', size: 'sm', label: 'Approve' }),
      mk('secondary sm', 'outlined.', { variant: 'secondary', size: 'sm', label: 'Assign' }),
      mk('ghost sm', 'text.', { variant: 'ghost', size: 'sm', label: 'Cancel' }),
      mk('danger text sm', 'opens a confirm.', { variant: 'ghost-danger', size: 'sm', label: 'Revoke' }),
      mk('danger sm', 'the commit.', { variant: 'danger', size: 'sm', label: 'Void votes' }),
      mk('wood sm', 'carved plank.', { variant: 'wood', size: 'sm', label: 'Map', icon: 'map' }, 'ground'),
      mk('next sm', 'arrow, forward.', { variant: 'primary', size: 'sm', shape: 'next', label: 'Next' }),
      mk('back sm', 'arrow, back.', { variant: 'secondary', size: 'sm', shape: 'back', label: 'Back' }),
      mk('link button', 'one size: 48px, no sm (see above).', { link: true, label: 'Floor plan', icon: 'map' }),
      mk('primary sm, phone', 'under 600px: 48px.', { variant: 'primary', size: 'sm', h: 48, label: 'Approve' }));
  }
}

// ---- Inputs and chips
function pageInputs(pg) {
  for (const theme of THEMES) {
    const st = themedStage(pg, theme, { name: 'Inputs and chips', kicker: 'Inputs and chips', title: 'Chips, fields and notes', note: 'Controls on paper: chips and fields are radius-sm outlined controls (a chamfer would cut the outline). Focus is a 3px inset ring in ink; selection is plum with a sun-glare wash; errors are danger with an icon and words.' });
    put(st, NominationCard(['Most Creative']), { caption: 'ToggleChip · nominate for prizes (Most Popular is never suggested by AI)' });
    put(st, Card({ name: 'ToggleChip states', gap: sp(3) }, specLabel('Default, selected, disabled, focus'), row({ w: 'fill', gap: sp(2), wrap: true, rowGap: sp(2) }, Chip('Best UI/UX'), Chip('Most Creative', { selected: true }), Chip('Most Useless', { disabled: true }), Chip('Modal', { focus: true }), Chip('Best Social Impact', { selected: true, focus: true }))), { caption: 'ToggleChip · states' });
    put(st, Card({ name: 'ChoiceChips', gap: sp(3) }, T('Admission status', 'body-sm', 'ink', { weight: 600 }), row({ w: 'fill', gap: sp(2), wrap: true, rowGap: sp(2) }, ['In Review', 'Admitted', 'Waitlisted', 'Rejected'].map((l) => Chip(l, { radio: true, selected: l === 'Admitted' }))), specLabel('Read-only (a role that cannot edit)'), row({ w: 'fill', gap: sp(2), wrap: true, rowGap: sp(2) }, ['In Review', 'Admitted'].map((l) => Chip(l, { radio: true, selected: l === 'Admitted', disabled: true })))), { caption: 'ChoiceChips · a radiogroup, one tab stop' });
    put(st, Card({ name: 'Table code field states', gap: sp(3) },
      ...[['Empty', Field({ value: '', state: 'default' }), 'The table code, then the 2 characters after the dot.', null], ['Typing a code', Field({ value: 'A12', state: 'default' }), 'The table code, then the 2 characters after the dot.', null], ['Code and check', Field({ value: 'A12 · K7', state: 'default' }), 'The table code, then the 2 characters after the dot.', null], ['Focus', Field({ value: 'A12 · K', state: 'focus' }), 'The table code, then the 2 characters after the dot.', null],
        ['Error: wrong table', Field({ value: 'A14', state: 'error' }), 'The table code, then the 2 characters after the dot.', null], ['Locked after 5 wrong checks', Field({ value: 'A12 · K9', state: 'disabled' }), 'Too many tries. Scan the QR on the placard, or ask the team their name.', 'danger']]
        .map(([cap, fld, help, tone]) => col({ name: `Field state / ${cap}`, w: 'fill', gap: sp(1) }, specLabel(cap), fld, helpLine(help, tone)))), { caption: 'Table code input · Oswald 24, caps, tracked; Enter checks' });
    put(st, col({ name: 'NotesField states', gap: sp(3) }, NotesCard('empty'), NotesCard('focus')), { caption: 'NotesField · empty and focus (16px text, no iOS zoom)' });
    put(st, col({ name: 'NotesField status', gap: sp(3) }, NotesCard('saving', 'Live demo worked. Routing recovered about 3 s after a node was pulled.'), NotesCard('local'), NotesCard('error')), { caption: 'NotesField · Saving… / Saved on this phone / Not saved · Retry' });
    put(st, NotesCard('locked'), { caption: 'NotesField · locked until the table check matches' });
    put(st, Card({ name: 'Select', gap: sp(3) }, T('Room', 'body-sm', 'ink', { weight: 600 }), SelectField('Room 4217 · Pro'), specLabel('Focus'), SelectField('Room 4218 · Pro', 'focus'), specLabel('Disabled'), SelectField('Room 1404 · General', 'disabled'), specLabel('Phone, under 600px: 16px text, 48px target (no iOS zoom)'), SelectField('Room 4217 · Pro', 'default', { phone: true }), SelectField('Room 4218 · Pro', 'focus', { phone: true })), { caption: `Select · admin ${css('.gv-select', 'min-height', TAP - sp(3))}px with ${TYPE['body-sm'].size}px text; under 600px ${evalLen(cssPhone('.gv-select')['min-height']) ?? TAP}px with ${TYPE.body.size}px text` });
    put(st, Card({ name: 'Error state', gap: sp(3) }, T('Placard code', 'body-sm', 'ink', { weight: 600 }), Field({ value: 'A99', state: 'error' }), helpLine('There’s no table A99 in Room 4217. Check the placard and type it again.', 'danger'),
      alertBox('danger', 'A14 is LedgerLite.', 'NeuralMesh is at A12, two tables to your right. Find that placard and check again.', [Btn({ label: 'Try again', variant: 'secondary', icon: 'rotate-ccw' })])), { caption: 'Error state · words and an icon, never color alone' });
    put(st, Card({ name: 'Badges', gap: sp(3) }, specLabel('Badges'), row({ w: 'fill', gap: sp(2), wrap: true, rowGap: sp(2) }, PathBadge('pro'), PathBadge('general'), Badge('Modal track', 'neutral', { icon: 'flag' }), Badge('Marked', 'brand', { icon: 'bookmark' }), Badge('Heard'), Badge('Not sure', 'warn'), Badge('Kept', 'success', { icon: 'check' }), Badge('Table A12', 'neutral', { mono: true })), specLabel('Rubber stamps'), row({ w: 'fill', gap: sp(3) }, Badge('Judged', 'success', { stamp: true }), Badge('Skipped', 'warn', { stamp: true }), Badge('Held', 'danger', { stamp: true }))), { caption: 'Badge, PathBadge (Pro or General, never "track") and stamp · tints are composited over paper' });
    put(st, Card({ name: 'Switch', gap: sp(2) }, SwitchRow({ label: S('Table talk (voice notes)'), on: false, desc: S('Off until HackIllinois and UIUC counsel sign off (Illinois Eavesdropping Act, BIPA). Judges read a consent script and record only if everyone at the table agrees. No voice ID.') }), Rc({ name: 'Rule', w: 'fill', h: 1, fill: 'line' }),
      SwitchRow({ label: S('Table talk (voice notes)'), on: true, focus: true, desc: S('Off until HackIllinois and UIUC counsel sign off (Illinois Eavesdropping Act, BIPA). Judges read a consent script and record only if everyone at the table agrees. No voice ID.') }), Rc({ name: 'Rule', w: 'fill', h: 1, fill: 'line' }),
      SwitchRow({ label: S('Freeze new sign-ins'), on: true, dis: true, lock: S('Admins only'), desc: S('Stops new judge sign-ins by link or code (after a code is guessed at, or once judging starts). Staff at the desk can still sign judges in with a QR code.') })), { caption: 'Switch · off, on (focus), and locked for staff with the reason readable (the Settings tab; the event switch is off until counsel signs off)' });
    put(st, col({ name: 'InlineConfirm', gap: sp(4) }, InlineConfirmBox({ lead: `${S('Revoke ')}Sarah Kim?`, text: S('They are signed out at once and their unsent work is kept for review.'), cancel: 'Cancel', confirm: 'Revoke', size: 'sm' }),
      InlineConfirmBox({ lead: `${S('Void ')}Ken Ito${S('’s ')}6${S(' votes?')}`, text: S('Their comparisons are removed and every room they judged is ranked again without them. Who did it, when and why go in the audit log.'), confirm: 'Void 6 votes', size: 'sm',
        field: F({ name: 'Field / reason', w: 'fill', flex: 'col', gap: sp(1) }, T(S('Reason (goes in the audit log)'), 'body-sm', 'ink', { weight: 600 }), SelectField(S('Judged too fast to have seen the demos'))) }),
      InlineConfirmBox({ tone: 'neutral', lead: S('Turn on AI summaries?'), text: S('Transcripts go to Anthropic to draft highlights. Anthropic deletes API inputs and outputs within 30 days, or keeps them up to 2 years if a safety review flags them. Your name and the time are recorded.'), confirm: 'I acknowledge · turn on', size: 'sm' }),
      InlineConfirmBox({ lead: 'Stop and delete this recording?', text: 'Nothing is kept, and it uses one of this table’s tries.', cancel: 'Keep recording', confirm: 'Stop and delete', size: 'lg' })), { caption: 'InlineConfirm · danger (a destructive commit), danger with a field, neutral (a policy acknowledgement), and the phone form with large buttons: Cancel takes focus, Escape cancels' });
  }
}

// ---- Judge components
function pageJudge(pg) {
  for (const theme of THEMES) {
    const st = themedStage(pg, theme, { name: 'Judge components', kicker: 'Judge components', title: 'The walk, the table check, the compare', note: 'A visit has two phases: en route (signpost, who to look for) and at the table (ask the team, scan or type the placard). Notes, nominations, Table talk and Submit stay locked until the table matches; Skip never locks.' });
    put(st, EnRoute(false), { caption: 'EnRoute · the real signpost art lettered with live text; the last board says who to look for' });
    put(st, EnRoute(true), { caption: 'EnRoute · after 3 minutes: Can’t find it? (dur-cant-find)' });
    put(st, col({ name: 'Wayfinding', gap: sp(3) }, WayPlank({ k: 'Room 4217 · 1 of 4', v: 'Table A12' }), WayPlank({ k: S('Round 2 · Best UI/UX deliberation'), v: 'Room 2405' })), { caption: 'Wayfinding · inline arrow plank' });
    for (const [s, cap] of [['idle', 'idle'], ['scanning', 'scanning (camera viewfinder)'], ['checking', 'checking'], ['matched', 'matched by a scan (stamps in)'], ['matched-code', 'matched by the typed code'], ['mismatch', 'mismatch (names the project at that code)'], ['mismatch-none', 'mismatch, no project at that code'], ['mismatch-offline', 'mismatch while offline (cannot name the other team)'], ['not-found', 'not found'], ['needs-check', 'check code required'], ['wrong-check', 'wrong check (no penalty until the 5th)'], ['look-alike', 'wrong check, look-alike hint'], ['offline', 'offline (verified on reconnect)'], ['name', 'name fallback: confirmed by name'], ['name-open', 'name fallback: the first question'], ['name-ask', 'name fallback: the second question'], ['locked', 'locked after 5 wrong checks'], ['no-camera', 'camera blocked'], ['failed', 'failed']])
      put(st, TableCheck(s), { caption: `TableCheck · ${cap}` });
    put(st, CompareCard({ state: 'idle', name: NM.name, table: NM.table, order: 'Earlier', recall: NM_RECALL, noms: ['Most Creative'] }), { caption: 'CompareCard · idle, with Recall rows', capGap: 24 });
    put(st, CompareCard({ state: 'selected', name: ECO.name, table: ECO.table, order: 'Just now', desc: ECO.tagline, notes: 'Live demo worked; CV pipeline was snappy.', noms: ['Best Social Impact', 'Best UI/UX'], selected: true }), { caption: 'CompareCard · selected (3px plum ring, wash, filled radio)', capGap: 24 });
    put(st, col({ name: 'Recorded pair', gap: sp(5), pt: sp(2) }, CompareCard({ state: 'recorded', name: ECO.name, table: ECO.table, order: 'Just now', recall: { does: 'Camera app that shows a product’s footprint', demo: 'Partly ran · soda can read as a bottle', standout: 'Footprint split into making and shipping', open: 'Asked: where do the numbers come from?' }, selected: true }), CompareCard({ state: 'recorded (other card)', name: NM.name, table: NM.table, order: 'Earlier', recall: NM_RECALL })), { caption: 'CompareCard · vote recorded: both cards readable, out of the tab order, taps ignored', capGap: 24 });
    put(st, ConfirmBar('none'), { caption: 'ComparePair confirm bar · none picked' });
    put(st, ConfirmBar('picked'), { caption: 'ComparePair confirm bar · picked: names the project' });
    put(st, ConfirmBar('recorded'), { caption: 'ComparePair confirm bar · vote recorded: Undo (n) above Next table, the gold fuse drains over 8 s' });
    put(st, col({ name: 'Recall rows', gap: sp(3) }, Card({ name: 'RecallBlock' }, eyebrow('Your recall'), Recall(NM_RECALL, false)), Card({ name: 'RecallBlock empty' }, specLabel('Nothing kept or tapped'), Recall({}, false))), { caption: 'RecallBlock · Does, Demo, Notable, Open: only what the judge kept' });
    put(st, col({ name: 'Toasts', gap: sp(4) }, Toast(`${S('Right table: ')}${NM.table}, ${NM.name}${S('. Notes are open.')}`, 'success'), Toast(S('You’re offline: staff get the ping when you reconnect.'), 'warn'), Toast('Couldn’t check that just now. Try again.', 'danger')), { caption: 'Toast · success / warn / danger (never moves the page)' });
    put(st, SkipSheet(), { caption: 'Sheet · SkipSheet over the dimmed page', w: 390 });
    put(st, col({ name: 'Timer tones', gap: sp(2) }, TimerStrip({ tone: 'calm' }), TimerStrip({ tone: 'warn' }), TimerStrip({ tone: 'urgent' }), TimerStrip({ tone: 'over' })), { caption: 'TimerBar · calm / under 10 min / under 2 min / time is up' });
    // The waiting screen, on the ground (the prototype's): the wagon, the title, the lede, the progress count, Still to judge, then the closing lede.
    put(st, col({ name: 'EmptyState / waiting', w: 'fill', gap: sp(3), items: 'center' }, PropArt('wagon'),
      T(S('All your tables are busy'), 'display-sm', 'on-ground', { align: 'center', w: 'fill', fx: ['shadow-title'] }), T(S('We’ll buzz you when one frees up. Stay in Room 4217; this screen moves on by itself.'), 'body', 'on-ground-soft', { align: 'center', w: 'fill' }),
      TableProgress({ total: 4, done: 2 }),
      Card({ name: 'Still to judge', gap: sp(2) }, row({ gap: sp(2) }, Ic('table', 20, 'select'), T('Still to judge', 'body-strong', 'ink')),
        ...[['PocketLab', 'A20'], ['Atlas', 'A22']].map(([n, t]) => row({ name: `Waiting / ${n}`, w: 'fill', gap: sp(2), justify: 'between' }, T(`${n} · Table ${t}`, 'body-sm', 'ink', { weight: 600 }), Badge('With a judge', 'warn', { icon: 'users' })))),
      T(S('Busy tables come back with no penalty.'), 'body', 'on-ground-soft', { align: 'center', w: 'fill' })), { caption: 'EmptyState · waiting: every table is busy (the screen moves on by itself, with a buzz)' });
    put(st, col({ name: 'EmptyState / paper', gap: sp(4) }, EmptyCard({ prop: 'cactus-tall', title: 'Nothing judged yet', body: 'Projects you evaluate show up here with your notes and nominations. Tap one to edit it until Round 1 ends.' }), EmptyCard({ icon: 'shield', title: 'No flagged projects', body: 'Every submission passed the deadline and registration checks.' })), { caption: 'EmptyState · a prop on paper, or a chamfered icon (admin)' });
    put(st, col({ name: 'Props and garlands', gap: sp(3), items: 'start' }, row({ name: 'Props', w: 'fill', gap: sp(3), items: 'end', justify: 'center' }, ['wagon', 'horseshoe', 'cactus-tall', 'cactus-round'].map((n) => PropArt(n, true))),
      GarlandArt('ground', 358), Card({ name: 'Garland on paper', gap: sp(2) }, specLabel('On paper: brown horses'), GarlandArt('paper', 318)),
      hasBrand('derived/cactus-bushes.webp') ? Rc({ name: 'Prop / cactus-bushes', w: 358, h: Math.round((358 * 220) / 538), fill: { img: 'derived/cactus-bushes.webp', mode: 'FIT' } }) : null), { caption: 'Prop and Garland · the real 2027 art, decorative: wagon, horseshoe, cactus, cactus-bushes (footer edges), garlands (cream on the ground, brown on paper)' });
    put(st, ProjectSkeletonSpec(3), { caption: 'ProjectSkeleton · the poster\'s own geometry while the next project loads (a pulse after dur-delay; still under reduced motion)' });
    put(st, col({ name: 'Disclosure rows', gap: sp(2) }, DisclosureRow('doc', 'Devpost description'), DisclosureRow('users', 'Team', '3 members'), DisclosureRow('doc', 'Devpost description', null, NM.description)), { caption: 'Disclosure · closed rows with a meta word, and one open' });
    put(st, Signpost({ label: 'Head to your room', noun: 'Room', room: '4217', map: 'Floor plan & seating', hint: 'Siebel Center, 4th floor. Tables A01–A28.' }), { caption: 'Wayfinding hero · the countdown sign (the last board stays blank without a board)' });
    put(st, Signpost({ label: S('Room 4217 · Siebel Center, 4th floor'), noun: 'Table', room: 'A12', map: S('Floor plan'), boardLabel: S('Look for'), board: NM.name, state: 'failed' }), { caption: 'Wayfinding hero · the art has not arrived (loading past dur-delay, or failed): the same five boxes become flat wood plates, so the table is readable at any moment' });
    put(st, col({ name: 'TableProgress', gap: sp(3), items: 'start' }, TableProgress({ total: 8, done: 3 }), TableProgress({ total: 4, done: 2, current: true }), TableProgress({ total: 4, done: 4 }), TableProgress({ total: 4, done: 0, current: true, tone: 'plaque', label: 'Next table · 1 of 4' })), { caption: 'TableProgress · sheriff stars: judged, the table you are at (half), still to come; the count is always in words' });
    put(st, col({ name: 'App bars', gap: sp(3) }, AppBar({ stripe: true }), AppBar({ recording: '01:12' }), AppBar({ recording: '01:12', paused: true }), AppBar({ offline: 2 }), AppBar({ recording: '01:12', offline: 2 }), AppBar({ unsent: 2 })), { w: 390, caption: 'JudgeShell app bar, 390 wide as on the phone · lockup (with the sky stripe) / Recording / Recording paused / Offline / Recording beside Offline / n not sent' });
  }
}

// ---- Table talk
// Fit audit for the cards at phone width (a column of 358px, the content width of a 390px phone). A Table talk card is drawn the way the component lays it out, and nothing is clipped, so a
// control that is wider than the card's content shows up here as it does in the browser. After layout the audit measures every descendant against the card's padding box; a card whose content
// spills over its own padding is reported (the caption says so, and --check/--strict exit 3: a gap in components/bundle.css, not in the sheet). Measured in Chromium at 390: the memo retry
// button ("Record the memo again (1 left)", nowrap) in .gv-tt__msg is 22px wider than the card's content, because the text column has no min-width:0.
// The memo retry gap is closed once bundle.css lets the text column shrink (.gv-tt__msg > div { min-width: 0 }) and the retry button wrap (white-space: normal on a button inside .gv-tt__acts).
// The sheet reads both rules, and then draws the button as the component would: as wide as the actions row, its label on two lines. Until then it draws the overflow as it is.
const MEMO_RETRY_FIXED = CSS.some((r) => !r.ctx && r.sel.some((x) => /^\.gv-tt__msg\s*>\s*div$/.test(x)) && /^0(px)?$/.test(r.decl['min-width'] ?? ''))
  && CSS.some((r) => !r.ctx && r.sel.some((x) => /\.gv-tt__acts\b.*\.gv-btn/.test(x)) && /^(normal|pre-wrap|pre-line|break-spaces)$/.test(r.decl['white-space'] ?? ''));
const OVERFLOW_NOTED = new Set();
function auditCardOverflow(st) {
  let changed = false;
  st.items.forEach((it, i) => {
    const root = graph.getNode(it.node.id); if (!root || !/^TableTalk \//.test(root.name)) return;
    const inner = root.width - sp(5); let worst = 0, who = null;
    const walk = (id, dx) => { for (const cid of graph.getNode(id).childIds ?? []) { const c = graph.getNode(cid); const r = dx + c.x + c.width; if (c.type !== 'TEXT' && r - inner > worst + 0.5) { worst = r - inner; who = c.name; } walk(cid, dx + c.x); } };
    walk(it.node.id, 0);
    if (worst > 0.5 && it.cap) {
      const cap = graph.getNode(it.cap.id), tid = cap.childIds[0], t = graph.getNode(tid), key = `${st.name}/${i}`;
      const msg = `${t.text.split(' · Component gap')[0]} · Component gap: "${who}" is ${Math.round(worst)}px wider than the card's content at 390 (see the README)`;
      if (t.text !== msg) { graph.updateNode(tid, { text: msg }); changed = true; }
      if (!OVERFLOW_NOTED.has(root.name)) { OVERFLOW_NOTED.add(root.name); warn(`component gap in bundle.css: in ${root.name} "${who}" is ${Math.round(worst)}px wider than the card's content at 390 (the card is 358px; its padding is space-5). Its nowrap button cannot shrink and the text column (.gv-tt__msg > div) has no min-width:0; let the button wrap or give the column min-width:0`); }
    }
  });
  return changed;
}
function pageTalk(pg) {
  for (const theme of THEMES) {
    const st = themedStage(pg, theme, { name: 'Table talk', kicker: 'Table talk', title: 'Recorder, consent and highlights', note: 'Judge-private notes, only after the team agrees: spoken consent, no stored audio, no voice identification, off per event until counsel signs off. The recorder is a premium control (72px, calm red pulse); every failure is designed. Highlights describe, never score or rank.' });
    // Every state bundle.js documents for TableTalk (plus `locked`, the disabled prop). checkStateCoverage() reports a state that has no specimen here.
    const states = ['idle', 'locked', 'starting', 'recording', 'paused', 'processing', 'ready', 'declined', 'retry', 'used-up', 'memo', 'unsupported', 'denied', 'mic-busy', 'offline-queued', 'too-noisy', 'failed', 'locked-by-admin'];
    const caps = { idle: 'idle: Ask and record', locked: 'locked until the table check matches (the disabled prop)', starting: 'starting: waiting for the microphone', recording: 'recording: Recording word, red dot, timer, level, Pause / Stop / Mark this', paused: 'paused: the microphone is off', processing: 'processing: pulling out highlights', ready: 'ready: Keep, Edit, Remove', declined: 'declined: the team said no', retry: 'retry: one more try, ask the team again', 'used-up': 'used-up: the recording and its retry are spent', memo: 'memo: after leaving a table', unsupported: 'unsupported browser', denied: 'denied: microphone blocked', 'mic-busy': 'mic busy (no try used)', 'offline-queued': 'offline: queued on the phone', 'too-noisy': 'too noisy', failed: 'failed: could not transcribe', 'locked-by-admin': 'locked by admin (event switch or team opt-out)' };
    for (const s of states) put(st, TableTalk(s, s === 'memo' ? { memo: true } : {}), { caption: `TableTalk · ${caps[s]}` });
    put(st, TableTalk('recording', { warn: true }), { caption: 'TableTalk · recording, one minute left (the warn hint)' });
    put(st, TableTalk('recording', { memo: true }), { caption: 'TableTalk · recording a memo (only the judge’s voice: no Mark this)' });
    put(st, TableTalk('failed', { failedAt: 'start' }), { caption: 'TableTalk · failed: the microphone never opened (no try used)' });
    put(st, TableTalk('recording', { confirm: true }), { caption: 'TableTalk · recording, Stop and delete asks first (InlineConfirm, large buttons; it uses one of the table’s tries)' });
    put(st, TableTalk('processing', { timedOut: true }), { caption: 'TableTalk · processing past the 30 s deadline: the recovery message replaces the skeleton' });
    put(st, TableTalk('too-noisy', { memo: true }), { caption: 'TableTalk · memo, too noisy: nothing was kept, and the retry reads Record the memo again (1 left)' });
    put(st, TableTalk('failed', { memo: true }), { caption: 'TableTalk · memo, could not transcribe: the retry button in its memo words' });
    put(st, TableTalk('ready', { memo: true }), { caption: 'TableTalk · memo, ready: From your memo, the judge’s own voice' });
    put(st, TableTalk('ready', { confirm: true }), { caption: 'TableTalk · ready, Delete what was heard asks first (InlineConfirm)' });
    put(st, TableTalk('ready', { allKept: true }), { caption: 'TableTalk · ready, everything kept: the button reads All kept and is spent' });
    put(st, TableTalk('locked-by-admin', { team: true }), { caption: 'TableTalk · locked: this team opted out (a memo is still allowed)' });
    put(st, ConsentSheet(true), { caption: 'TableTalk · consent: Ask and record opens ConsentSheet (AI summaries on: Cloudflare transcribes, Anthropic summarizes)', w: 390 });
    put(st, ConsentSheet(false), { caption: 'ConsentSheet · AI summaries off: the phone picks the highlights, Anthropic gets nothing', w: 390 });
    put(st, Card({ name: 'HighlightList' }, HighlightRows(), PrizeCard(), Btn({ label: 'Keep all · add to notes', variant: 'secondary', icon: 'check', w: 'fill' })), { caption: 'HighlightList · rows with verbatim quotes, and a prize suggestion that needs a tap' });
    put(st, Card({ name: 'HighlightList / hard to hear', gap: sp(3) }, alertBox('warn', S('Hard to hear in here.'), S('Check these against what you saw.'), null, 'alert'),
      row({ w: 'fill', gap: sp(1), items: 'start' }, Ic('quote', 14, 'ink-muted'), T(`${S('Nothing clear was said about what it does. Devpost’s tagline (not heard at the table): “')}${NM.tagline}”`, 'label', 'ink-muted', { weight: 500, w: 'fill' })),
      HighlightRows().slice(2)), { caption: 'HighlightList · a loud room: a warning, and the Devpost tagline as a note (it was not said at the table)' });
    put(st, Card({ name: 'HighlightList / edit refused', gap: sp(3) }, eyebrow('Edit'), F({ name: 'Edit field', w: 'fill', h: 80, flex: 'col', py: sp(3), px: sp(4), rounded: RSM, fill: 'surface-sunken', stroke: 'focus', sw: 3 }, T('The best demo here', 'body', 'ink', { w: 'fill' })),
      row({ gap: sp(1), items: 'start', w: 'fill' }, Ic('alert', 14, 'danger'), T(S('That reads like a verdict. Say what was shown or said instead.'), 'body-sm', 'danger', { weight: 600, w: 'fill' })), row({ gap: sp(2) }, Btn({ label: 'Cancel', variant: 'ghost' }), Btn({ label: 'Save and keep', variant: 'secondary', icon: 'check', state: 'disabled' }))), { caption: 'HighlightList · an edit that reads as a verdict is refused' });
    put(st, col({ name: 'Prize suggestion', gap: sp(4) }, PrizeCard(false), PrizeCard(true)), { caption: 'Prize suggestion · quote + your tap; Most Popular is never suggested' });
    put(st, col({ name: 'Highlight removed', gap: sp(2) }, Card({ name: 'Removed row', gap: sp(2) }, row({ w: 'fill', justify: 'between' }, col({ w: 'fill' }, eyebrow('Removed'), T('Asked what happens with a hundred nodes', 'body-sm', 'ink-muted', { weight: 400, w: 'fill', clamp: 1 })), Btn({ label: 'Undo', variant: 'ghost', icon: 'rotate-ccw' })))), { caption: 'HighlightList · Removed · Undo' });
    put(st, DemoStatus({ suggested: 'ran_live' }), { caption: 'DemoStatus · Table talk suggests, the judge’s tap decides' });
    put(st, DemoStatus({ selected: 'partly_ran' }), { caption: 'DemoStatus · selected (a fact, never a rating)' });
    put(st, DemoStatus({ locked: true }), { caption: 'DemoStatus · locked until the table check matches' });
    put(st, col({ name: 'Level meter', gap: sp(3) }, Card({ name: 'LevelMeter bars' }, specLabel('Hearing speech'), LevelMeter(0.9)), Card({ name: 'LevelMeter quiet' }, specLabel('Quiet'), LevelMeter(0.12)), Card({ name: 'LevelMeter reduced motion' }, specLabel('Reduced motion: words, not bars'), T('Hearing speech', 'label', 'select', { weight: 600, spec: true }))), { caption: 'LevelMeter · decorative; reduced motion shows words' });
    st.measureHook = () => auditCardOverflow(st);
  }
}

// ---- Placard
// A QR stand-in: finder squares, timing rows and seeded pseudo-random modules. It is NOT a scannable code, and says so.
function qrPlaceholderPath(size) {
  const n = 29, q = 4, tot = n + 2 * q, m = size / tot; let seed = 12;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const dark = Array.from({ length: n }, () => Array(n).fill(false)), fixed = Array.from({ length: n }, () => Array(n).fill(false));
  const finder = (x0, y0) => { for (let y = -1; y <= 7; y++) for (let x = -1; x <= 7; x++) { const X = x0 + x, Y = y0 + y; if (X < 0 || Y < 0 || X >= n || Y >= n) continue; fixed[Y][X] = true; const edge = x === 0 || x === 6 || y === 0 || y === 6, core = x >= 2 && x <= 4 && y >= 2 && y <= 4; dark[Y][X] = x >= 0 && x <= 6 && y >= 0 && y <= 6 && (edge || core); } };
  finder(0, 0); finder(n - 7, 0); finder(0, n - 7);
  for (let i = 8; i < n - 8; i++) { dark[6][i] = i % 2 === 0; fixed[6][i] = true; dark[i][6] = i % 2 === 0; fixed[i][6] = true; }
  const c0 = Math.floor(n / 2) - 6, c1 = Math.floor(n / 2) + 6;   // knock-out in the middle for the label
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { if (fixed[y][x]) continue; dark[y][x] = rnd() < 0.5 && !(x >= c0 && x <= c1 && y >= 11 && y <= 17); }
  let d = ''; const f = (v) => +v.toFixed(2);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (dark[y][x]) d += `M${f((x + q) * m)} ${f((y + q) * m)}h${f(m)}v${f(m)}h${f(-m)}z`;
  return d;
}
function QRPlaceholder(size = 240) {
  if (size < 120) return { t: 'path', p: { name: 'QR modules (placeholder, not scannable)', d: qrPlaceholderPath(size), w: size, h: size, fill: 'ink' }, c: [] };   // a thumbnail: the modules alone, one layer less
  return F({ name: 'QR placeholder (not scannable)', w: size, h: size, flex: 'row', justify: 'center', items: 'center', fill: 'surface' },
    { t: 'path', p: { name: 'QR modules (placeholder)', d: qrPlaceholderPath(size), w: size, h: size, fill: 'ink', x: 0, y: 0, layoutIgnore: true }, c: [] },
    size < 120 ? null : F({ name: 'Placeholder label', flex: 'col', items: 'center', px: sp(3), py: sp(1), fill: 'surface', stroke: 'ink', sw: 1, rounded: RSM }, T('QR placeholder', 'caps', 'ink', { upper: true }), T('not scannable', 'label', 'ink-soft', { weight: 500 })));
}
const ROOMS = [
  { letter: 'A', room: '4217', color: 'Gold', tok: 'room-a', on: 'on-room-a', floor: 'Siebel Center 4th floor', path: 'Pro', range: 'A01–A28', sample: ['A12', 'K7'] },
  { letter: 'B', room: '4218', color: 'Teal', tok: 'room-b', on: 'on-room-b', floor: 'Siebel Center 4th floor', path: 'Pro', range: 'B01–B28', sample: ['B03', 'C4'] },
  { letter: 'C', room: '4219', color: 'Rose', tok: 'room-c', on: 'on-room-c', floor: 'Siebel Center 4th floor', path: 'General', range: 'C01–C28', sample: ['C05', 'RE'] },
  { letter: 'D', room: '1404', color: 'Sage', tok: 'room-d', on: 'on-room-d', floor: 'Siebel Center 1st floor', path: 'General', range: 'D01–D32', sample: ['D04', 'M9'] },
];
// Where a line of text puts its glyphs. A browser puts the baseline at ascent - (content height - line height) / 2 below the top of the line box (half-leading); the sheet's
// text engine (a CanvasKit paragraph with a height multiplier) puts it at line height x ascent / content height. They agree when the line is as tall as the font's own and drift apart as
// the line gets tighter than the font: the 240/220 placard code is drawn 41px higher in the sheet than in Chromium, and the 64/72 check 7px. lineMetrics gives both baselines (from the
// ascent and descent of the font file, the way Chromium reads hhea) so a big tight line can be put where the browser puts it.
const VM = new Map();
function vmetrics(family) {
  if (VM.has(family)) return VM.get(family);
  let m = { asc: 1.193, desc: 0.289 };   // Oswald, if the face is not on disk (a --check run that never loaded fonts)
  for (const style of ['Regular', 'Medium', 'SemiBold', 'Bold']) {
    const f = fontFile(family, style); if (!fs.existsSync(f)) continue;
    try { const b = fs.readFileSync(f), font = opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); m = { asc: font.tables.hhea.ascender / font.unitsPerEm, desc: -font.tables.hhea.descender / font.unitsPerEm }; break; } catch { /* try the next face */ }
  }
  VM.set(family, m); return m;
}
const lineMetrics = (ts) => { const { asc, desc } = vmetrics(ts.family), a = Math.round(asc * ts.size), c = a + Math.round(desc * ts.size); return { browser: a - (c - ts.line) / 2, engine: (ts.line * asc) / (asc + desc) }; };   // Chromium rounds the font's ascent and descent to whole pixels
function Placard(R = ROOMS[0], notice = true, z = 1) {   // z scales the whole sheet (the print dialog shows it at .36)
  const Zs = (n) => Math.max(1, Math.round(sp(n) * z)), Z = (n) => Math.max(1, Math.round(n * z));
  // A thumbnail is a picture of a printed page: text that would be under 12px at this scale (the footer, the blank slot's label, the how-to line, the notice) is left out of it, not drawn too small to read.
  const TZ = (text, style, color, p = {}) => z === 1 ? T(text, style, color, p) : TYPE[style].size * z < 12 ? null : T(text, style, color, { ...p, size: +(TYPE[style].size * z).toFixed(2), lineHeight: +(TYPE[style].line * z).toFixed(2), ls: +(TYPE[style].ls * z).toFixed(3) });
  const [code, check] = R.sample, ncopy = COPY.on.notice ?? '[team notice not found in bundle.js]';
  const W = NUM['placard-w'] ?? 720, H = NUM['placard-h'] ?? 950;
  const mc = lineMetrics(TYPE['placard-code']), mk = lineMetrics(TYPE['placard-check']), codeBase = Math.max(mc.browser, mk.browser), codeBelow = Math.max(TYPE['placard-code'].line - mc.browser, TYPE['placard-check'].line - mk.browser);
  return F({ name: `Placard / ${code} · ${check}${z === 1 ? '' : ` (scaled ${z})`}`, w: Z(W), h: Z(H), flex: 'col', fill: 'surface', stroke: 'ink', sw: NUM.stroke ?? 2, clip: true },
    F({ name: 'Room band', w: 'fill', flex: 'row', justify: 'between', items: 'center', px: Zs(8), py: Zs(5), fill: R.tok }, TZ(`Room ${R.room}`, 'h2', R.on, { upper: true }), TZ(`${R.letter} · ${R.color}`, 'h2', R.on, { upper: true })),
    // The row is as tall as the component's (the tallest baseline plus what hangs below it: 257px, the QR starts 24px under it). The code and the check are laid out at the top of it, then floatCodes lifts
    // them to the placard and puts each glyph where Chromium puts it (see lineMetrics); their line boxes hang past the row, which only a frame as big as the placard can hold.
    F({ name: 'Table code and check', w: 'fill', h: Zs(8) + Math.max(1, Math.floor((codeBelow + codeBase) * z)), flex: 'row', justify: 'center', items: 'start', gap: Zs(4), px: Zs(8), pt: Zs(8), fill: 'surface', fillOp: 0 }, TZ(code, 'placard-code', 'ink'), ...(z === 1 ? [F({ name: 'Check (printed only here)', flex: 'row', items: 'end', gap: Zs(3) }, TZ('·', 'placard-check', 'ink-soft'), TZ(check, 'placard-check', 'ink-soft'))] : [TZ(`· ${check}`, 'placard-check', 'ink-soft', { name: 'Check (printed only here)' })])),
    F({ name: 'Scan block', w: 'fill', flex: 'row', items: 'center', gap: Zs(8), px: Zs(12), py: Zs(6) }, QRPlaceholder(Zs(12) * 5),   // .gv-placard__qr is space-12 x 5 in bundle.css
      z === 1 ? col({ name: 'How to scan', w: 'fill', gap: Zs(2) }, TZ('Judges scan here', 'h2', 'ink', { upper: true, w: 'fill' }), TZ(`or type ${code} · ${check} in the judging app`, 'title-sm', 'ink-soft', { w: 'fill' })) : TZ('Judges scan here', 'h2', 'ink', { upper: true, w: 'fill' })),
    F({ name: 'Spacer', w: 'fill', h: 1, grow: 1 }),
    // .gv-placard__slot is one 72px box (space-12 + space-6): the label at its top, the rule an inset shadow along its bottom edge (inside the 72px, not under it).
    F({ name: 'Project slot (blank)', w: 'fill', h: Zs(12) + Zs(6), flex: 'col', px: Zs(12) }, z === 1 ? row({ w: 'fill', items: 'start', gap: Zs(4), grow: 1 }, TZ('Project', 'caps', 'ink-muted', { upper: true })) : F({ name: 'Spacer / slot', w: 'fill', h: 1, grow: 1 }), Rc({ name: 'Slot rule', w: 'fill', h: NUM.stroke ?? 2, fill: 'line-strong' })),
    // The component prints the retention line inside the notice box (a block under the notice, space-2 below it), not in a box of its own.
    notice ? F({ name: 'Notice for teams', w: 'fill', flex: 'col', px: Zs(12), pt: Zs(3) }, F({ name: 'Notice box', w: 'fill', flex: 'col', gap: Zs(1), px: Zs(4), py: Zs(3), rounded: RSM, fill: 'surface-sunken' }, TZ('For teams', 'eyebrow', 'ink', { upper: true }), TZ(ncopy, 'label', 'ink-soft', { weight: 500, w: 'fill' }),
      COPY.retention ? F({ name: 'Retention', w: 'fill', flex: 'col', pt: Zs(1) }, TZ(COPY.retention, 'label', 'ink-soft', { weight: 500, w: 'fill' })) : null)) : null,
    z === 1 ? F({ name: 'Footer', w: 'fill', flex: 'row', px: Zs(12), pt: Zs(5), pb: Zs(6) }, TZ(`HackIllinois 2027 · Judging · ${R.floor}`, 'caps', 'ink-muted', { upper: true })) : F({ name: 'Spacer / footer', w: 'fill', h: Zs(5) + Zs(6) + Z(TYPE.caps.line) }));
}
// PlacardSheet (the print dialog): a ground page, a wood bar (the title, "n placards · one per page", Close and Print), the placards at .36 in a wrapping row. The name slot stays blank unless staff choose to print names.
// One flat frame (the bar, then the thumbnails wrap), so the lint's nesting limit holds. A thumbnail is a picture of a page: its text under 12px is left out (see Placard).
function PlacardSheetSpec(R = ROOMS[0], codes = [['A03', 'N7'], ['A12', 'K7']], total = 28) {
  const z = 0.36, thumb = (c) => { const pl = Placard({ ...R, sample: c }, false, z); return { ...pl, p: { ...pl.p, name: `Print page / ${c[0]}`, fx: ['shadow-ledge'] } }; };
  const bar = F({ name: 'Print bar', w: 'fill', flex: 'row', items: 'center', gap: sp(4), px: sp(4), py: sp(2), fill: woodFill(), fx: ['shadow-plank-edge'] },
    col({ name: 'Print head', w: 'fill' }, T(`Room ${R.room} · placards`, 'title', 'on-wood'), T(`${total} placards · one per page`, 'caps', 'on-wood-soft', { upper: true })),
    Btn({ label: 'Close', variant: 'secondary', ctx: 'wood' }), Btn({ label: 'Print', icon: 'printer', ctx: 'wood' }));
  return F({ name: 'PlacardSheet', w: 'fill', flex: 'col', fill: 'ground', rounded: RMD, clip: true }, bar, row({ name: 'Print pages', w: 'fill', gap: sp(4), p: sp(4), justify: 'center', items: 'start' }, codes.map(thumb)));
}
function pagePlacard(pg) {
  const st = stage(pg, { name: 'Placard', theme: 'sunset', w: 1800, fill: 'surface-sunken' }); st.custom = true;
  const sheet = build(Rc({ name: 'US Letter sheet 8.5 x 11 in', w: 816, h: 1056, x: 64, y: 64, fill: 'on-ground', stroke: 'line-strong', sw: 1, fx: ['shadow-ledge'] }), st.frame.id, 'sunset');
  const plac = build({ ...Placard(ROOMS[0]), p: { ...Placard(ROOMS[0]).p, x: 112, y: 112 } }, st.frame.id, 'sunset');
  const num = (n) => F({ name: `Marker ${n}`, w: sp(6), h: sp(6), flex: 'row', justify: 'center', items: 'center', rounded: 9999, fill: 'ink' }, T(String(n), 'caps', 'surface', { align: 'center' }));
  const item = (n, title, text) => row({ name: `Legend ${n}`, w: 'fill', gap: sp(3), items: 'start' }, num(n), col({ w: 'fill', gap: sp(1) }, T(title, 'body-strong', 'ink', { w: 'fill' }), T(text, 'body-sm', 'ink-soft', { weight: 400, w: 'fill' })));
  const bands = row({ name: 'Room bands', w: 'fill', gap: sp(3), items: 'start' }, ROOMS.map((R) => col({ name: `Room ${R.letter}`, w: 'fill', gap: sp(1) },
    F({ name: `Band ${R.letter}`, w: 'fill', flex: 'row', justify: 'between', items: 'center', px: sp(3), py: sp(2), fill: R.tok }, T(`Room ${R.room}`, 'caps', R.on, { upper: true }), T(`${R.letter} · ${R.color}`, 'caps', R.on, { upper: true })),
    T(R.floor, 'label', 'ink', { weight: 600, w: 'fill' }), T(`${R.path} · ${R.range} · e.g. ${R.sample[0]}`, 'label', 'ink-soft', { weight: 500, w: 'fill' }))));
  const right = build(col({ name: 'Placard notes', w: 792, gap: sp(5) },
    col({ gap: sp(2), w: 'fill' }, eyebrow('Print'), T('Table placard', 'display-lg', 'ink', { w: 'fill' }), T('One per page on US Letter (8.5 x 11 in, 0.5 in margins): the room band, the code, its check, the QR of the table, and a blank slot for the project. 7.5 x 9.9 in, 0.1 in short of the printable height so no page spills a blank sheet. Colors print exactly.', 'body', 'ink-soft', { w: 'fill' })),
    col({ name: 'Legend', w: 'fill', gap: sp(4) },
      item(1, 'Room band', 'room-a Gold for Room 4217; the letter and name repeat on the right. Oswald 36 (h2), text on-room-a.'),
      item(2, 'Table code', 'Room letter plus the 2-digit local table number: "A12". placard-code, Oswald 600 at 240/220, readable across the aisle.'),
      item(3, 'Check', `The 2 characters after the dot, "A12 · K7": placard-check, Oswald 64/72. They appear only on the placard: the judge app never shows the check before arrival and the phone never stores it (the server compares). Alphabet: ${'ACDEFHJKMNPRTUVWXY23479'}.`),
      item(4, 'QR of the TABLE', `The QR carries https://judging.hackillinois.org/t/A12 (the path is the table code: /t/<CODE>) and, after it, ?k=<signed token>: adonix signs the token per table and it is printed only inside the QR, so a pasted link without it still asks for the 2 characters after the dot. The QR encodes the table, never the project, so moving a team needs no reprint. Drawn here as a labelled placeholder: it is not scannable.`),
      item(5, 'Project slot, blank', '"Project ________": a blank line to write on. The slot stays empty unless staff choose to print names, so a team that moves needs no reprint.'),
      item(6, 'Notice for teams', `The paragraph teams read when Table talk is on for the event${COPY.retention ? ', with the retention line under it' : ''} (copy from bundle.js). Not printed when the switch is off.`),
      item(7, 'Footer', 'HackIllinois 2027 · Judging · the room’s floor.')),
    T('Rooms and their bands', 'title', 'ink', { w: 'fill' }), bands,
    T('Where the code goes', 'title', 'ink', { w: 'fill' }), T('The judge types or scans it at the table. A mismatch names the project at that code ("A14 is LedgerLite. NeuralMesh is at A12, two tables to your right."); a missing or misread check costs no try; five wrong checks lock typing while scan and the team’s name still work.', 'body-sm', 'ink-soft', { weight: 400, w: 'fill' })), st.frame.id, 'sunset');
  graph.updateNode(right.id, { x: 944, y: 64 });
  // The print dialog under the sheet: staff print a room from the admin console; PlacardSheet shows every placard of the room (28 for Room 4217) on the ground at .36 and Print sends them one per page under @media print.
  const cap = build(col({ name: 'Print sheet caption', w: 816, gap: sp(1) }, T('PlacardSheet · the print dialog', 'body-sm', 'ink', { weight: 600, w: 'fill', spec: true }), T('Staff print a room from the admin console. The bar, the .36 scale and the blank name slot are the component\'s (names print only if staff choose to).', 'label', 'ink-soft', { weight: 500, w: 'fill', spec: true })), st.frame.id, 'sunset');
  graph.updateNode(cap.id, { x: 64, y: 64 + 1056 + 40 });
  const dlg = build({ ...PlacardSheetSpec(), p: { ...PlacardSheetSpec().p, w: 816 } }, st.frame.id, 'sunset');
  graph.updateNode(dlg.id, { x: 64, y: 64 + 1056 + 40 + 64 });
  // Fit audit: the placard is a fixed 7.5 x 9.9 in box (overflow hidden in bundle.css). If what the component puts in it is taller (the notice, its retention line
  // and the footer), the footer is cut off at print. The sheet measures the real content after layout, shows the overflow instead of hiding it, and says so.
  let overBody = null, over = 0;
  const overText = () => `The notice, its retention line and the footer need ${over}px more than the ${Math.round(NUM['placard-h'] ?? 950)}px box (bundle.css cuts the placard off at its edge, so the footer is lost at print). Drawn here uncut. Shorten the notice or tighten the scan block in bundle.js, then rerun.`;
  // After layout the code and the check leave their row for the placard itself (an absolute layer at the row's x, nudged to the component's baseline): see lineMetrics.
  const floatCodes = () => {
    let moved = false;
    for (const row of graph.getAllNodes()) {
      if (row.name !== 'Table code and check' || !row.childIds?.length) continue;
      const pl = graph.getNode(row.parentId), z = pl.width / (NUM['placard-w'] ?? 720), mc = lineMetrics(TYPE['placard-code']), mk = lineMetrics(TYPE['placard-check']), base = Math.max(mc.browser, mk.browser);
      const at = pl.childIds.indexOf(row.id) + 1;
      [...row.childIds].forEach((id, i) => {
        const dy = z * (base - (i === 0 ? mc : mk).engine);
        graph.reparentNode(id, pl.id); graph.reorderChild(id, pl.id, at + i);
        graph.updateNode(id, { layoutPositioning: 'ABSOLUTE', y: graph.getNode(id).y + dy });
      });
      moved = true;
    }
    return moved;
  };
  const measureOver = () => {
    const moved = floatCodes();
    const f = graph.getNode(plac.id), kids = f.childIds ?? [], last = graph.getNode(kids[kids.length - 1]);
    over = Math.max(0, Math.round(last.y + last.height - f.height));
    graph.updateNode(plac.id, { clipsContent: over === 0 });
    if (over > 0 && !overBody) {
      const marker = overText(); build(alertBox('danger', 'Component gap: the placard overflows its box', marker), right.id, 'sunset');
      overBody = graph.getAllNodes().find((n) => n.type === 'TEXT' && n.text === marker)?.id ?? null; return true;
    }
    if (overBody) { const want = over > 0 ? overText() : 'The placard fits its box.'; if (graph.getNode(overBody).text !== want) { graph.updateNode(overBody, { text: want }); return true; } }
    return moved;   // true = the page changed, so it must be measured again
  };
  st.measureHook = measureOver;
  st.finish = () => {
    measureOver();
    if (over > 0) warn(`component gap in bundle.js: the Table talk notice, its retention line and the footer need ${over}px more than the 7.5 x 9.9 in placard box, so the footer is cut off at print`);
    graph.updateNode(st.frame.id, { height: Math.ceil(Math.max(64 + 1056 + 40 + 64 + graph.getNode(dlg.id).height, 64 + graph.getNode(right.id).height) + 64) });
  };
}

// ---- Key screens at 390 x 844
// A phone screen as JudgeShell draws it: the painted ground (the 2027 canyon, cover-fit, under the scrim token), the wood app bar (the lockup, My notes; the sky stripe when
// no timer follows), the timer band, the body, and the wood dock. The bars are absolute (full bleed, pinned); the screen's own content is the phone's direct children.
const pin = (spec, x, y, w) => ({ ...spec, p: { ...spec.p, layoutIgnore: true, x, y, w } });
function Phone(name, o, body, action) {
  const top = TAP + sp(2), timer = o.timer !== false, band = timer ? 48 : sp(1), th = o.theme ?? 'sunset', ground = `derived/bg-${th}.webp`;
  return F({ name, w: 390, h: 844, flex: 'col', gap: sp(3), pt: top + band + sp(4), px: sp(4), fill: 'ground', clip: true, fx: ['shadow-ledge-lg'] },
    hasBrand(ground, 'the phone ground stays flat') ? pin(Rc({ name: 'Painted ground (brand export)', h: 844, fill: { img: ground, mode: 'FILL' } }), 0, 0, 390) : null,
    pin(Rc({ name: 'Scrim', h: 844, fill: 'scrim' }), 0, 0, 390),
    // A scrolled screen: each piece of its content is pinned at x = space-4 (the page scrolls under the bars) and drawn before the bars, so they cover what has gone up; the measure hook
    // in pageScreens stacks the pieces upward from the dock once their heights are known. A wrapper frame would cost a nesting level the Table talk card has no room for.
    ...(o.scrolled ? [body].flat(Infinity).filter(Boolean).map((c) => pin(c, sp(4), top + band + sp(4), 358)) : []),
    pin(AppBar({ ...o, stripe: !timer }), 0, 0, 390), timer ? pin(TimerStrip({ tone: o.tone ?? 'calm', frac: o.frac }), 0, top, 390) : null,
    o.scrolled ? null : body, action ? pin(action, 0, 844 - (o.dock ?? 72), 390) : null);
}
const SKIP = (ctx = 'wood') => Btn({ label: 'Skip', variant: 'ghost', icon: 'skip', ctx });
const EC_RECALL = { does: 'Camera app that shows a product’s footprint', demo: 'Partly ran · soda can read as a bottle', standout: 'Footprint split into making and shipping', open: 'Asked: where do the numbers come from?' };
const stepPlaque = (text) => F({ name: 'Step plaque', flex: 'row', items: 'center', px: sp(3), py: sp(1), rounded: RSM, fill: 'ground-deep' }, T(text, 'eyebrow', 'gold-on-ground', { upper: true }));
const grow = () => F({ name: 'Spacer', w: 'fill', h: 1, grow: 1 });
function pageScreens(pg) {
  for (const theme of THEMES) {
    const st = themedStage(pg, theme, { name: 'Key screens', kicker: 'Key screens', title: 'Eight screens at 390 x 844', note: 'Sign-in, the countdown, en route, the table check, an evaluation with Table talk recording, the compare with recall, the vote recorded, and Round 1 complete, as JudgeShell draws them: the painted 2027 ground under its scrim, the wood app bar with the real lockup, the timer band, the real signpost, planks, sheriff stars, garlands and props, and the wood dock. Each is built from the same specimens as the component pages.', cols: 4, colW: 390 });
    const P = (name, o, body, action) => Phone(name, { theme, ...o }, body, action);
    // The evaluate screen is longer than the phone: it is drawn scrolled to the recorder, which rests space-4 above the dock (the pieces above it run up under the bars, as the page
    // scrolls). Each piece's y is set from the one below it once its real height is known.
    st.measureHook = () => {
      let moved = false;
      for (const ph of (graph.getNode(st.frame.id).childIds ?? []).map((id) => graph.getNode(id))) {
        if (ph.name !== 'Screen / Evaluate with Table talk') continue;
        const pieces = (ph.childIds ?? []).map((id) => graph.getNode(id)).filter((n) => n.layoutPositioning === 'ABSOLUTE' && n.x === sp(4));   // the scrolled content (the bars and the ground are pinned at x = 0)
        let bottom = 844 - 72 - sp(4);
        for (const n of pieces.reverse()) { const y = Math.round(bottom - n.height); if (Math.abs(n.y - y) > 0.5) { graph.updateNode(n.id, { y }); moved = true; } bottom = y - sp(3); }
      }
      return moved;
    };
    // 1 · Sign-in: the longhorn seal on paper, Howdy in Rye, the email form, the wood QR button
    put(st, P('Screen / Sign-in', { timer: false, notes: false }, [grow(),
      row({ name: 'Seal row', w: 'fill', justify: 'center' }, F({ name: 'Seal', w: sp(12) * 2, h: sp(12) * 2, flex: 'row', justify: 'center', items: 'center', rounded: 9999, fill: 'surface', stroke: 'line', sw: 1, fx: ['shadow-ledge'] }, hasBrand('longhorn-logo.svg') ? Svg('longhorn-logo.svg', { w: Math.round(((sp(12) + sp(6)) * 374) / 406), name: 'Longhorn logo' }) : null)),
      T('Howdy, judge.', 'display-lg', 'on-ground', { font: FAMILY.western, fx: ['shadow-title'], align: 'center', w: 'fill' }),
      T('No password. Use the sign-in link we emailed you, or scan the QR code at the check-in desk.', 'body', 'on-ground-soft', { align: 'center', w: 'fill' }),
      Card({ name: 'Sign-in card', gap: sp(4) }, col({ w: 'fill', gap: sp(2) }, T('Email', 'body-sm', 'ink', { weight: 600 }), Field({ placeholder: 'you@company.com', kind: 'plain', h: TAP + sp(1) })), Btn({ label: 'Email me a sign-in link', size: 'lg', iconRight: 'arrow', w: 'fill' }),
        row({ name: 'or', w: 'fill', gap: sp(3) }, Rc({ name: 'Rule left', w: 'fill', h: 1, fill: 'line-strong' }), T('or', 'eyebrow', 'ink-muted', { upper: true }), Rc({ name: 'Rule right', w: 'fill', h: 1, fill: 'line-strong' })),
        Btn({ label: 'Scan check-in QR', variant: 'wood', icon: 'code', w: 'fill' })),
      T('Staff and admins sign in with Google on the admin console.', 'body', 'on-ground-soft', { align: 'center', w: 'fill' })], null), { caption: '1 · Sign-in: the real longhorn on a paper seal, the Rye greeting, the wood plank button' });
    // 2 · The countdown: the neon marquee, the plum plaque, the big count, the signpost to the room
    put(st, P('Screen / Countdown', { timer: false }, [
      hasBrand('derived/neon-board.webp') ? row({ name: 'Marquee row', w: 'fill', justify: 'center' }, Rc({ name: 'Neon marquee (brand export)', w: SIGN_W, h: Math.round((SIGN_W * 328) / 560), fill: { img: 'derived/neon-board.webp', mode: 'FIT' } })) : null,
      col({ name: 'Countdown', w: 'fill', items: 'center', gap: sp(1) }, stepPlaque('Judging begins in'), T('00:02', 'count-hero', 'on-ground', { align: 'center' }), T('min : sec', 'numeral', 'on-ground-soft', { upper: true, ls: +(TYPE.caps.em * TYPE.numeral.size).toFixed(2), align: 'center' })),
      Signpost({ label: 'Head to your room', noun: 'Room', room: '4217', map: 'Floor plan & seating' })], null), { caption: '2 · Countdown: the neon marquee, "Judging begins in", the signpost to Room 4217' });
    // 3 · En route
    put(st, P('Screen / En route', {}, EnRouteParts(false), ActionBar(SKIP(), Btn({ label: S('I’m at the table'), size: 'lg', iconRight: 'arrow', w: 'fill', ctx: 'wood' }))), { caption: '3 · En route: the signpost names Table A12 and who to look for' });
    // 4 · The table check
    put(st, P('Screen / Table check', {}, [WayPlank({ k: 'Room 4217 · 1 of 4', v: 'Table A12' }), TableCheck('idle'), ProjectPoster({ eyebrow: 'Now judging', meta: false })], ActionBar(SKIP(), Btn({ label: 'Submit evaluation', size: 'lg', iconRight: 'arrow', w: 'fill', state: 'disabled', ctx: 'wood' }))), { caption: '4 · At the table: ask the team, scan or type the placard (Submit stays locked)' });
    // 5 · Evaluate with Table talk recording
    put(st, P('Screen / Evaluate with Table talk', { recording: '00:14', scrolled: true }, [WayPlank({ k: 'Room 4217 · 1 of 4', v: 'Table A12' }), TableCheck('matched'), ProjectPoster({ eyebrow: 'Now judging', meta: false, compact: false }),
      DisclosureRow('doc', 'Devpost description'), DisclosureRow('users', 'Team', '3 members'), DisclosureRow('code', 'GitHub repository', `${NM.commits} commits`), GarlandArt('ground', 358), TableTalk('recording', { elapsed: '00:14', mark: '00:09' })], ActionBar(SKIP(), Btn({ label: 'Submit evaluation', size: 'lg', iconRight: 'arrow', w: 'fill', ctx: 'wood' }))), { caption: '5 · Evaluate with Table talk recording, scrolled to the recorder (the red tag with the same 00:14 stays in the app bar; the page scrolls under the bars)' });
    // 6 · Compare with recall, one project picked
    put(st, P('Screen / Compare with recall', { frac: 0.45 }, [stepPlaque('Comparison 1 · your last two projects'), F({ name: 'Compare question', w: 'fill', flex: 'col', pb: sp(2) }, T('Which was stronger overall?', 'display-sm', 'on-ground', { fx: ['shadow-title'], w: 'fill', balance: true })),
      CompareCard({ state: 'earlier', name: NM.name, table: NM.table, order: 'Earlier', recall: NM_RECALL, noms: ['Most Creative'] }), CompareCard({ state: 'just now', name: ECO.name, table: ECO.table, order: 'Just now', recall: EC_RECALL, selected: true })], ConfirmBar('picked')), { caption: '6 · Compare: the same four recall rows on both cards, EcoLens picked', capGap: 24 });
    // 7 · The vote is recorded: Undo, then Next table
    put(st, P('Screen / Vote recorded', { frac: 0.4, dock: 140 }, [stepPlaque('Comparison 1 · your last two projects'), F({ name: 'Compare question', w: 'fill', flex: 'col', pb: sp(2) }, T('Which was stronger overall?', 'display-sm', 'on-ground', { fx: ['shadow-title'], w: 'fill', balance: true })),
      CompareCard({ state: 'recorded', name: NM.name, table: NM.table, order: 'Earlier', recall: NM_RECALL, noms: ['Most Creative'] }), CompareCard({ state: 'recorded (picked)', name: ECO.name, table: ECO.table, order: 'Just now', recall: EC_RECALL, selected: true })], ConfirmBar('recorded')), { caption: '7 · Vote recorded: Undo for 8 seconds above Next table; both cards stay readable', capGap: 24 });
    // 8 · Round 1 complete: horseshoe, sheriff star, cactus, the count, the garland, the signpost to Round 2
    put(st, P('Screen / Round 1 complete', { timer: false }, [
      row({ name: 'Win', w: 'fill', justify: 'center', items: 'end', gap: sp(4), pt: sp(4) }, PropArt('horseshoe', true), StarSeal(), PropArt('cactus-round', true)),
      T(S('Round 1 complete'), 'display', 'on-ground', { align: 'center', w: 'fill', fx: ['shadow-title'] }),
      T(`4 projects, 3 comparisons${S('. Thank you! Round 2 opens at 8:30 PM, when nominations close.')}`, 'body', 'on-ground-soft', { align: 'center', w: 'fill' }),
      row({ name: 'Progress', w: 'fill', justify: 'center' }, TableProgress({ total: 4, done: 4 })), GarlandArt('ground', 358),
      Signpost({ label: S('Round 2 · Best UI/UX deliberation'), noun: 'Room', room: '2405' })], ActionBar(Btn({ label: 'Start Round 2', size: 'lg', iconRight: 'arrow', w: 'fill', ctx: 'wood' }))), { caption: '8 · Round 1 complete: the horseshoe, the sheriff star and the cactus, then the signpost to Room 2405' });
  }
}

// ------------------------------------------------------------------------------------------------------ pipeline
const PAGE_DEFS = [
  ['foundations', 'Foundations', (pg) => pageFoundations(pg)],
  ['buttons', 'Buttons', (pg) => pageButtons(pg)],
  ['inputs', 'Inputs and chips', (pg) => pageInputs(pg)],
  ['judge', 'Judge components', (pg) => pageJudge(pg)],
  ['talk', 'Table talk', (pg) => pageTalk(pg)],
  ['placard', 'Placard', (pg) => pagePlacard(pg)],
  ['screens', 'Key screens', (pg) => pageScreens(pg)],
];
if (PAGE_DEFS.map((d) => d[0]).join() !== PAGE_KEYS.join()) { console.error('make_spec_sheet: PAGE_KEYS and PAGE_DEFS are out of step'); process.exit(2); }
const want = (key) => !ONLY || ONLY.includes(key);
const PAGES_BUILT = () => Object.keys(PAGES).length;

// Copy coverage. The specimens show real component copy; a literal wrapped in S() is checked against bundle.js and the prototype, and
// this pass counts how many of ALL the specimen text layers (captions, notes and headers written for the spec excluded) appear
// verbatim in those sources. The rest is specimen data (project names, quotes, times) or copy that exists only in this sheet.
const copyKey = (t) => norm(t).toLowerCase().trim();
const COPY_SRC = copyKey(JS_SRC + PROTO_SRC);
function copyCoverage() {
  const scope = new Set(['judge', 'talk', 'inputs', 'screens']), found = new Set(), missing = new Set(), guards = [...S_CALLS].filter((g) => g.trim().length >= 10).map(copyKey);
  const walk = (id, inPlacard) => {
    const n = graph.getNode(id); if (!n) return;
    const placard = inPlacard || /^Placard \//.test(n.name);
    if (n.type === 'TEXT') { if (n.text && /[a-z]{2}/i.test(n.text) && !SPEC_TEXT.has(id)) (COPY_SRC.includes(copyKey(n.text)) || guards.some((g) => copyKey(n.text).includes(g)) ? found : missing).add(n.text.replace(/\s+/g, ' ').trim()); return; }
    for (const c of n.childIds ?? []) walk(c, placard);
  };
  for (const [key, pg] of Object.entries(PAGES)) {
    if (scope.has(key)) for (const t of pg.tops.flat()) walk(t, false);
    else if (key === 'placard') for (const t of pg.tops.flat()) { const n = graph.getNode(t); if (n && /^Placard \//.test(n.name)) walk(t, true); }
  }
  for (const f of found) missing.delete(f);
  return { found: found.size, missing: [...missing].sort() };
}

// Every state the components document must have a specimen, and every specimen must show a state the components still have.
// (TableTalk's `locked` specimen is its disabled prop, not a state, so it is the one allowed extra.)
function checkStateCoverage() {
  const rows = [['TableTalk', TT_STATES, DRAWN.TableTalk, 'talk', 'the Table talk page', new Set(['disabled'])], ['TableCheck', TC_STATES, DRAWN.TableCheck, 'judge', 'the Judge components page', new Set()]];
  const out = [];
  for (const [name, doc, drawn, page, where, extra] of rows) {
    if (!want(page)) continue;
    if (!doc.length) { warn(`bundle.js: could not read the ${name} state list, so the sheet cannot check that every state has a specimen`); continue; }
    for (const st of doc) if (!drawn.has(st)) warn(`${name} state "${st}" is documented in bundle.js but has no specimen on ${where}`);
    for (const st of drawn) if (!doc.includes(st) && !extra.has(st)) warn(`${where} draws ${name} state "${st}", which bundle.js no longer lists`);
    out.push(`${name} ${doc.filter((x) => drawn.has(x)).length}/${doc.length}`);
  }
  if (out.length) log(`component states with a specimen: ${out.join(', ')}`);
}

// What went wrong, for the exit code: failing contrast pairs (including the real bundle.css wood ring) and copy drift.
function problems() {
  const out = [];
  for (const f of AUDIT.filter((a) => !a.pass && !/as bundle\.css draws it/.test(a.note ?? ''))) out.push(`contrast ${f.theme}: ${pairName(f.fg)} on ${pairName(f.bg)}${f.note ? ` (${f.note})` : ''} ${f.ratio.toFixed(2)}:1 < ${f.min}:1`);
  if (WOOD_GAP) out.push(`component gap in bundle.css: ${WOOD_GAP.rule} draws the ${WOOD_GAP.tok} ring on .gv-btn--wood, which is not visible on the plank (needs 3:1). Fix in bundle.css: .gv-btn--wood:focus-visible { box-shadow: none; outline: none } and a ::after band in var(--on-wood) one stroke-focus in from the plank's edge`);
  // Two contrast tiles with the same label cannot be told apart (both read "on-wood-soft" once): every tile names its foreground and its background.
  const seen = new Map(); for (const [fg, bg, , note] of PAIRS) { const l = note ?? `${pairName(fg)} on ${pairName(bg)}`; seen.set(l, (seen.get(l) ?? 0) + 1); }
  for (const [l, n] of seen) if (n > 1) out.push(`contrast tiles share the label "${l}" (${n} times): give each pair its own note in PAIRS`);
  for (const d of DRIFT) out.push(`copy drift: "${d}" is no longer in bundle.js or the prototype`);
  for (const w of WARN) if (!/^contrast /.test(w)) out.push(/^component gap/.test(w) ? w : `warning: ${w}`);   // a missing token, an unreadable bundle.css rule, a missing brand file
  return out;
}

async function main() {
  const fails = AUDIT.filter((a) => !a.pass);
  log(`tokens: ${tokens.color.tokens.length} colors, ${Object.keys(TYPE).length} type styles; contrast pairs ${AUDIT.length - fails.length}/${AUDIT.length} pass`);
  for (const f of fails) warn(`contrast ${f.theme}: ${pairName(f.fg)} on ${pairName(f.bg)} ${f.ratio.toFixed(2)}:1 < ${f.min}`);
  // the tightest pass of each kind (the README quotes these; they are measured here, not remembered)
  { const lowest = (kind) => AUDIT.filter((a) => a.kind === kind).sort((a, b) => a.ratio - b.ratio)[0], tag = (a) => a && `${a.note ?? `${pairName(a.fg)} on ${pairName(a.bg)}`} ${a.ratio.toFixed(2)}:1 (${a.theme})`;
    log(`lowest passes: text ${tag(lowest('text'))} · controls and rings ${tag(lowest('ui'))}`); }
  for (const th of THEMES) colorCollection(th); numbers();
  await loadDerived();
  if (ARGS.check) {   // audit only: build every page (no fonts, no export, nothing written) so the copy-drift check sees every string
    for (const [key, name, fn] of PAGE_DEFS) { if (want(key)) { CUR = 'sunset'; fn(newPage(key, name)); } }
    checkStateCoverage();
    return report();
  }
  log('loading fonts');
  await warmFonts();
  const pages = [];
  PAGE_DEFS.forEach(([key, name, fn], i) => { if (!want(key)) return; const pg = newPage(key, name); pg.no = i + 1; log(`building ${name}`); CUR = 'sunset'; fn(pg); pages.push(pg); });
  checkStateCoverage();
  log('measuring');
  computeAllLayouts(graph);
  // Text is re-measured with the real fonts at each export; repeat until the page heights stop moving (usually two or three passes).
  // Clamped lines are cut on the string first (applyClamps), so the layers hold what is drawn.
  let cut = 0, balanced = 0;
  // A layer added by a hook (the placard fit note) is measured over two passes (its text is laid out at a default width first), so a change keeps the loop going for two more.
  for (let pass = 0, prev = '', more = 0; pass < 8; pass++) {
    for (const pg of pages) await renderNodes(pg, 0.05);
    if (STAGES.some((st) => st.measureHook?.())) more = 2;   // checks that need real text heights (the placard fit audit)
    cut = Math.max(cut, await applyClamps());
    balanced = Math.max(balanced, await applyBalance());
    const sig = pages.map((pg) => topIds(pg).map((id) => graph.getNode(id).height).join(',')).join('|'); if (sig === prev && more-- <= 0) break; prev = sig;
  }
  if (BALANCES.length) log(`balanced lines: ${BALANCES.length} layers, ${balanced} broken to match text-wrap: balance`);
  if (CLAMPS.length) log(`clamped lines: ${CLAMPS.length} layers, ${cut} cut with an ellipsis`);
  log('laying out');
  refitShapes(); materializeShapes();
  for (const st of STAGES) (st.finish ? st.finish() : layoutStage(st));
  for (const pg of pages) stackTops(pg, 0);
  // Everything is produced in memory first. Nothing is written until every check has passed, so a failed run (no fonts, no network)
  // cannot replace a good design/gavil-spec.fig and design/png/*.png with a worse one.
  const shots = []; if (!NO_PNG) log('rendering PNGs');
  if (!NO_PNG) for (const pg of pages) {
    const png = await renderNodes(pg, 1);
    shots.push({ file: path.join(OUT, 'png', `${String(pg.no).padStart(2, '0')}-${pg.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`), data: png });
  }
  assertFontsUsed();
  { const all = [...graph.getAllNodes()], texts = all.filter((n) => n.type === 'TEXT'); log(`${PAGES_BUILT()} pages, ${all.length} nodes, ${texts.length} text layers (${texts.filter((n) => !/\S/.test(n.text ?? '')).length} empty), ${USED_BRAND.size} brand files placed`); }
  log('shaping text for the .fig');
  // Save only after the exports: the export loads the real fonts and re-measures text, which the .fig then keeps.
  await bakeTextGlyphs();
  const fig = await io.writeDocument('fig', graph);
  const figName = ONLY ? 'gavil-spec.partial.fig' : 'gavil-spec.fig';   // a subset run never overwrites the full file
  // ---- all checks passed: write
  fs.mkdirSync(path.join(OUT, 'png'), { recursive: true });
  if (!NO_PNG && !ONLY) for (const f of fs.readdirSync(path.join(OUT, 'png'))) if (/^\d\d-.*\.png$/.test(f)) fs.rmSync(path.join(OUT, 'png', f));   // a full run replaces the set
  for (const sh of shots) { writeAtomic(sh.file, sh.data); log(`png ${path.relative(DS, sh.file)} (${(sh.data.length / 1024).toFixed(0)} KB)`); }
  writeAtomic(path.join(OUT, figName), fig.data); log(`${figName} ${(fig.data.length / 1024).toFixed(0)} KB`);
  report();
}
function writeAtomic(file, data) { const tmp = `${file}.tmp-${process.pid}`; fs.writeFileSync(tmp, data); fs.renameSync(tmp, file); }
function report() {
  const drift = [...DRIFT]; if (drift.length) console.warn(`copy drift (${drift.length}): strings in the spec that bundle.js no longer contains:\n  - ${drift.join('\n  - ')}`);
  const cov = copyCoverage();
  console.log(`copy: ${DRIFT.size} drifted · ${S_CALLS.size} literals guarded by S() · ${cov.found} of ${cov.found + cov.missing.length} distinct specimen strings found verbatim in bundle.js or the prototype (the other ${cov.missing.length} are specimen data or copy only this sheet has; --copy lists them)`);
  if (ARGS.copy) console.log(`not found in the sources (${cov.missing.length}):\n  - ${cov.missing.join('\n  - ')}`);
  const bad = problems();
  if (bad.length) console.warn(`${bad.length} problem${bad.length === 1 ? '' : 's'}:\n  - ${bad.join('\n  - ')}`);
  console.log(`done in ${((Date.now() - T0) / 1000).toFixed(1)}s · warnings ${WARN.length} · problems ${bad.length} · copy drift ${drift.length} · brand files used ${USED_BRAND.size}`);
  // A gap in components/bundle.css (outside design/, which this generator cannot edit) gets its own exit code, so a caller can tell "the sheet is wrong" (1)
  // from "the sheet is right and a component rule is missing" (3). Both are non-zero, and both are printed above.
  const own = bad.filter((b) => !/^component gap in bundle\.(css|js)/.test(b));
  if (bad.length && STRICT) {
    if (own.length) { console.error('exit 1: --check/--strict fail on problems'); process.exitCode = 1; }
    else { console.error(`exit 3: the sheet itself is clean; ${bad.length} component gap${bad.length === 1 ? '' : 's'} in components/ remain${bad.length === 1 ? 's' : ''} (not fixable from design/; what to change is in the problem${bad.length === 1 ? '' : 's'} above)`); process.exitCode = 3; }
  }
}
try { await main(); }
catch (e) {
  if (e instanceof Abort) { console.error(`\nABORTED: ${e.message}\nThe sheet was not touched: the .fig and PNGs in ${OUT} are exactly as they were.`); process.exit(1); }
  throw e;
}
process.exit(process.exitCode ?? 0);
