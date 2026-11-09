// usage: node postcut.mjs <raw.mp4> <raw.srt> <out.mp4> <out.srt> [keep=1.0] [--analyze-only] [--playbook=<yaml>] [--timing=<raw.timing.json>]
// Post-process for the judge video (demo/README.md, "Rendering the judge video"). Run it on the raw ndemo render.
// A loaded machine makes the app take seconds to load a page, and the page shows skeletons, a blank background and a faded
// "Sending" ghost on the way. This script cuts that out and keeps the narration in sync:
//  1. LOAD TRANSITIONS. After a tap (or the app's own timer) starts a page load, the picture jumps from the old page to junk
//     (a solid purple view-transition frame, a skeleton page, the empty painted background with only the header, a faded ghost
//     card) and then the new page draws. For every silent load-wait segment of the playbook (`to-*` and `go-*`) the script finds
//     the first frame where the old page is gone and the first frame where the new page has real content, and cuts everything
//     in between, so the video goes from the old page straight to the new page drawing in. The playbook ends each voiced line
//     before the tap (see build-yaml), so the junk is silent and can go; speech is never cut: a junk stretch that overlaps a
//     voice line is trimmed to the silent part and reported.
//  2. DEAD WAITS. Any other stretch where the picture does not move AND nobody is talking is cut to `keep` seconds (a solid-colour
//     stretch keeps nothing, a blank or skeleton screen keeps 0.05 s). Segments in HOLDS (a deliberate silent hold, typing, the Undo
//     count) are left alone. With --timing (the raw.timing.json the render writes next to the raw mp4) every tap (the disc's glide,
//     press and fade) and every typed text is protected too: a moving disc or a typed letter changes too few pixels for freezedetect,
//     so without it a cut can land in the middle of a tap or of typing.
// Video and audio are cut with the same intervals, so the narration stays in sync, and every .srt cue is shifted the same way.
// Then the video is upscaled 2x (lanczos) and encoded for upload (CRF 26; set CRF=... to change it).
// Afterwards check the sync: the speech onsets in the output must sit at the .srt cue starts (see the README), and run
// flashscan.mjs on the output.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const flags = argv.filter((a) => a.startsWith('--'))
const [raw, srtIn, out, srtOut, keepArg] = argv.filter((a) => !a.startsWith('--'))
const KEEP = Number(keepArg || 1.0), KEEP_FIRST = 0.8
// Segments the dead-wait rule must not touch. second-table: the A17 confirmation is held for 1.7 s on purpose. private-note and
// second-note: the text is typed key by key, and a typed letter changes too few pixels for freezedetect (it reads the picture as
// still), so a cut there would land in the middle of the typing and the rest of the text would pop in at once.
// pick .. vote-sent: the Undo count runs through them, and a cut there would make it skip a number.
const HOLDS = ['second-table', 'private-note', 'second-note', 'pick', 'undo', 'count-wait', 'vote-sent']
const analyzeOnly = flags.includes('--analyze-only')
const playbookPath = (flags.find((f) => f.startsWith('--playbook=')) || '').slice('--playbook='.length) || path.join(here, 'gavil-judge.yaml')
const timingPath = (flags.find((f) => f.startsWith('--timing=')) || '').slice('--timing='.length)
// `yaml` comes from the ndemo install (a project skill at .claude/skills/ndemo); NDEMO_PKG points at its package.json when this script runs elsewhere
const YAML = createRequire(process.env.NDEMO_PKG || path.join(here, '..', '..', '.claude', 'skills', 'ndemo', 'package.json'))('yaml')

const ff = (args) => spawnSync('ffmpeg', ['-hide_banner', '-nostats', ...args], { encoding: 'utf8', maxBuffer: 1 << 28 }).stderr
const dur = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', raw], { encoding: 'utf8' }).stdout)
const lines = (s) => s.split('\n')
const T = (x) => x.toFixed(2)

// ---------------------------------------------------------------------------------------------------------------- helpers
const mergeCuts = (cs) => {
  const sorted = cs.filter(([a, b]) => b - a > 0.02).sort((x, y) => x[0] - y[0])
  const r = []
  for (const c of sorted) { const l = r[r.length - 1]; if (l && c[0] <= l[1] + 0.001) l[1] = Math.max(l[1], c[1]); else r.push([c[0], c[1]]) }
  return r
}
const minus = ([a, b], blocks) => {
  let pieces = [[a, b]]
  for (const [s, e] of blocks) {
    const next = []
    for (const [x, y] of pieces) { if (e <= x || s >= y) next.push([x, y]); else { if (s > x) next.push([x, s]); if (e < y) next.push([e, y]) } }
    pieces = next
  }
  return pieces
}
const ranges = (text, startRe, endRe, last) => {
  const r = []; let s0 = null
  for (const l of lines(text)) {
    let m
    if ((m = l.match(startRe))) s0 = Math.max(0, Number(m[1]))
    if ((m = l.match(endRe)) && s0 !== null) { r.push([s0, Number(m[1])]); s0 = null }
  }
  if (s0 !== null) r.push([s0, last])
  return r
}

// ------------------------------------------------------------------------------------- speech (never cut) and generic dead waits
const speechSil = ranges(ff(['-i', raw, '-vn', '-af', 'silencedetect=n=-40dB:d=0.05', '-f', 'null', '-']), /silence_start: (-?[\d.]+)/, /silence_end: ([\d.]+)/, dur)
const speech = []; { let p = 0; for (const [a, b] of speechSil) { if (a > p) speech.push([p, a]); p = b } if (p < dur) speech.push([p, dur]) }
const speechBlocks = speech.map(([a, b]) => [a - 0.06, b + 0.06]) // a word's attack and decay are never touched

const freezes = ranges(ff(['-i', raw, '-an', '-vf', 'freezedetect=n=-55dB:d=0.6', '-f', 'null', '-']), /freeze_start: ([\d.]+)/, /freeze_end: ([\d.]+)/, dur)
const sil = ranges(ff(['-i', raw, '-vn', '-af', 'silencedetect=n=-45dB:d=0.4', '-f', 'null', '-']), /silence_start: (-?[\d.]+)/, /silence_end: ([\d.]+)/, dur)
const inter = []
for (const [a, b] of freezes) for (const [c, d] of sil) { const s = Math.max(a, c), e = Math.min(b, d); if (e - s > 0.2) inter.push([s, e]) }
inter.sort((x, y) => x[0] - y[0])
const std = (t) => {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', raw, '-frames:v', '1', '-vf', 'scale=130:-1,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 24 })
  const b = r.stdout; if (!b || !b.length) return 999
  let m = 0; for (const v of b) m += v; m /= b.length
  let q = 0; for (const v of b) q += (v - m) * (v - m); return Math.sqrt(q / b.length)
}
// ------------------------------------------------------------------------------------------------------- load transitions
// Per-frame numbers for the whole video (78x169 gray; the raw render is constant 30 fps, so frame k is at k/30 s exactly):
// dp = mean absolute change from the frame before, sd = spread of the picture (a solid colour or an empty page is low).
const W = 78, H = 169, N = W * H
const fr = JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'json', raw], { encoding: 'utf8' }).stdout).streams[0].r_frame_rate.split('/').map(Number)
const FPS = fr[0] / (fr[1] || 1)
const px = spawnSync('ffmpeg', ['-v', 'error', '-i', raw, '-an', '-vf', `scale=${W}:${H}:flags=area,format=gray`, '-fps_mode', 'passthrough', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 30 }).stdout
const nF = Math.floor(px.length / N)
const dp = new Float32Array(nF), sd = new Float32Array(nF)
for (let k = 0; k < nF; k++) {
  const o = k * N; let s1 = 0, s2 = 0, d = 0
  for (let i = 0; i < N; i++) { const v = px[o + i]; s1 += v; s2 += v * v; if (k) d += Math.abs(v - px[o - N + i]) }
  const m = s1 / N; sd[k] = Math.sqrt(Math.max(0, s2 / N - m * m)); dp[k] = k ? d / N : 0
}

const pb = YAML.parse(fs.readFileSync(playbookPath, 'utf8'))
const total = pb.segments.reduce((t, s) => t + (s.videoDuration || 0), 0) / 1000
const segs = []
{ let t = dur - total; for (const s of pb.segments) { const a = t; t += (s.videoDuration || 0) / 1000; segs.push({ id: s.id, a, b: t, voiced: !!s.narration }) } }

const dead = []
if (flags.includes('--verbose')) for (const [s, e] of inter) console.log(`  still+silent ${T(s)}-${T(e)} (${(e - s).toFixed(2)}s)`)
// A still stretch is judged only outside the HOLDS segments (their time, and 0.2 s after): the part of a stretch that overlaps a held
// segment is left alone, and what remains of it before or after is judged by itself.
const holdRanges = segs.filter((g) => HOLDS.includes(g.id)).map((g) => [g.a, g.b + 0.2])
if (timingPath) {
  // the render's own record of every action (seconds since the render started; the raw video starts delta s after that)
  const TJ = JSON.parse(fs.readFileSync(timingPath, 'utf8'))
  const delta = (dur - total) - TJ.preSegmentMs / 1000
  const at = (a, label) => { const m = a.marks.find((x) => x.label === label); return m ? m.at + delta : null }
  let n = 0
  for (const sg of TJ.segments) for (const a of sg.actions) {
    const arrived = at(a, 'arrived'), pressed = at(a, 'pressed'), clicked = at(a, 'clicked'), typed = at(a, 'typed')
    if (a.type === 'click' && pressed !== null && clicked !== null) { holdRanges.push([(arrived ?? pressed) - 0.75, clicked + 0.6]); n++ }
    if (a.type === 'type' && pressed !== null && typed !== null) { holdRanges.push([(arrived ?? pressed) - 0.75, typed + 0.35]); n++ }
    if (a.type === 'hover' && arrived !== null) { holdRanges.push([arrived - 0.75, arrived + 0.9]); n++ }
  }
  // key-by-key typing (a run of single-key presses): from the first letter to the last, 0.35 s more
  for (const sg of TJ.segments) {
    const keys = sg.actions.filter((a) => a.type === 'press' && /^([A-Za-z.,]|Space)$/.test(String(a.target)))
    if (keys.length > 3) { holdRanges.push([Math.min(...keys.map((a) => at(a, 'start'))) - 0.1, Math.max(...keys.map((a) => at(a, 'end'))) + 0.35]); n++ }
  }
  console.log(`  --timing: ${n} protected windows (taps, typed text, pointer moves)`)
}
for (const [s0, e0] of inter) for (const [s, e] of minus([s0, e0], holdRanges)) {
  if (e - s < 0.4) continue
  const sd = e - s > 0.5 ? std((s + e) / 2) : 999
  const uniform = sd < 8        // a solid colour (the purple view-transition frame): nothing of it is worth keeping
  const blank = sd < 45         // a skeleton or an empty page: only a blink of it
  const k = uniform ? 0 : blank ? 0.05 : (s < 1 ? KEEP_FIRST : KEEP)
  if (e - s > k + (blank ? 0.35 : 0.7)) dead.push({ a: +(s + k).toFixed(3), b: +e.toFixed(3), why: uniform ? 'solid colour' : blank ? 'blank page' : 'still and silent' })
}

const BIG = 15      // mean change between two frames that means "the page was replaced"
const FAR_OLD = 40  // a frame this far (mean change on a 0-255 scale) from the old page is not the old page (Sending... is: it differs by about 25)
const FAR_NEW = 25  // a frame this far from the settled new page is not the new page yet (a fading-in ghost is within about 17 after its first frame)
const MIN_JUNK = 1 / 30 // seconds: one frame of junk is already worth cutting (a flash of the empty background between two screens); the cut keeps the screens on both sides
const trans = []
if (total > 0) {
  const gap = (a, b) => { let d = 0; for (let i = 0; i < N; i++) d += Math.abs(px[a * N + i] - px[b * N + i]); return d / N }
  for (let j = 1; j < segs.length; j++) {
    const S = segs[j], P = segs[j - 1]
    if (S.voiced || !/^(to|go)-/.test(S.id)) continue
    const k0 = Math.round((P.a + 0.2) * FPS), k1 = Math.min(nF - 1, Math.round((S.b + 0.5) * FPS))
    let kc = -1
    for (let k = k0 + 1; k <= k1; k++) if (dp[k] > BIG) { kc = k; break }
    if (kc < 0) { trans.push({ id: S.id, note: 'no page change found' }); continue }
    // Junk = a frame that is neither the old page nor the settled new page: a solid colour, the empty painted background, a skeleton, the old page
    // thrown back to its top, a faded ghost. The cut runs from the first such frame to the last one. The app's own busy state (Sending...) is
    // still the old page, a fade-in of the new page soon is the new page, so both stay.
    const kold = Math.max(0, kc - 1), kref = Math.min(nF - 1, Math.round((S.b + 0.35) * FPS))
    let kj = -1, kl = -1
    for (let k = kc; k <= kref; k++) if (gap(k, kold) > FAR_OLD && gap(k, kref) > FAR_NEW) { if (kj < 0) kj = k; kl = k }
    if (kj < 0 || (kl + 1 - kj) / FPS < MIN_JUNK) { trans.push({ id: S.id, note: 'no junk between the pages' }); continue }
    const ke = kl + 1
    // half a frame before the first junk frame and before the first frame of the new page
    const a = (kj - 0.5) / FPS, b = (ke - 0.5) / FPS
    const pieces = minus([a, b], speechBlocks).filter(([x, y]) => y - x >= 0.025)
    const cut = pieces.reduce((t, [x, y]) => t + (y - x), 0)
    trans.push({ id: S.id, change: kc / FPS, junk: kj / FPS, end: ke / FPS, pieces, lost: (b - a) - cut })
  }
}

const cuts = mergeCuts([...dead.map((d) => [d.a, d.b]), ...trans.flatMap((t) => t.pieces || [])])
const cutTotal = cuts.reduce((t, [a, b]) => t + (b - a), 0)
console.log(`raw ${dur.toFixed(1)}s (${nF} frames at ${FPS} fps); ${freezes.length} freezes, ${speech.length} speech runs; ${cuts.length} cuts removing ${cutTotal.toFixed(1)}s -> ${(dur - cutTotal).toFixed(1)}s`)
for (const t of trans) {
  if (t.note) console.log(`  transition ${t.id}: ${t.note}`)
  else console.log(`  transition ${t.id}: page replaced at ${T(t.change)}, junk from ${T(t.junk)}, new page drawing from ${T(t.end)} -> cut ${t.pieces.map(([x, y]) => `${T(x)}-${T(y)}`).join(', ')}${t.lost > 0.02 ? `   WARNING: speech overlaps the junk, ${t.lost.toFixed(2)}s of it stays` : ''}`)
}
for (const d of dead) console.log(`  dead wait ${T(d.a)}-${T(d.b)} (${d.why})`)
for (const [a, b] of cuts) console.log(`  cut ${T(a)}-${T(b)} (${(b - a).toFixed(1)}s)`)
fs.writeFileSync((out || 'postcut') + '.cuts.json', JSON.stringify(cuts.map(([a, b]) => [+a.toFixed(3), +b.toFixed(3)])))
if (analyzeOnly) process.exit(0)

const map = (t) => { let r = t; for (const [a, b] of cuts) { if (t >= b) r -= b - a; else if (t > a) r -= t - a } return r }
// keep-intervals = complement of the cuts; trim + concat (aselect is unreliable on timestamps here)
const keeps = []; let pos = 0
for (const [a, b] of cuts) { if (a > pos) keeps.push([pos, a]); pos = b }
if (pos < dur) keeps.push([pos, dur])
const parts = keeps.map(([a, b], k) => `[0:v]trim=start=${a}:end=${b},setpts=PTS-STARTPTS[v${k}];[0:a]atrim=start=${a}:end=${b},asetpts=PTS-STARTPTS[a${k}]`)
const fc = parts.join(';') + ';' + keeps.map((_, k) => `[v${k}][a${k}]`).join('') + `concat=n=${keeps.length}:v=1:a=1[vc][a];[vc]scale=iw*2:ih*2:flags=lanczos[v]`
const r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', raw, '-filter_complex', fc, '-map', '[v]', '-map', '[a]', '-r', '30', '-c:v', 'libx264', '-crf', process.env.CRF || '26', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out], { encoding: 'utf8' })
if (r.status !== 0) { console.log(r.stderr); process.exit(1) }

// shift the subtitles
const ts = (s) => { const [h, m, x] = s.split(':'); return Number(h) * 3600 + Number(m) * 60 + Number(x.replace(',', '.')) }
const fmt = (t) => { t = Math.max(0, t); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0').replace('.', ',')}` }
if (srtIn && fs.existsSync(srtIn)) {
  const blocks = fs.readFileSync(srtIn, 'utf8').trim().split(/\n\s*\n/)
  const res = blocks.map((b, i) => { const L = b.split('\n'); const [a, c] = L[1].split(' --> '); return `${i + 1}\n${fmt(map(ts(a)))} --> ${fmt(map(ts(c)))}\n${L.slice(2).join('\n')}` })
  fs.writeFileSync(srtOut, res.join('\n\n') + '\n')
}
// report gaps in the final audio
const ge = ff(['-i', out, '-vn', '-af', 'silencedetect=n=-45dB:d=3', '-f', 'null', '-'])
const od = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out], { encoding: 'utf8' }).stdout)
console.log(`final ${od.toFixed(1)}s; silences >= 3s:`)
for (const l of lines(ge)) if (/silence_(start|end)/.test(l)) console.log('  ' + l.replace(/^\[.*?\]\s*/, ''))
