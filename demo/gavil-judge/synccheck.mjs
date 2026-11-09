// usage: node synccheck.mjs <video.mp4> <video.srt>
// For every subtitle cue: where does the voice really start, compared with the cue start? The render places each clip at its
// segment start to the sample, so a cue that starts a clip sits 0.14-0.2 s before the voice (the lead-in inside the clip). A cue
// that starts inside a clip is a computed sentence split, so its offset can be larger. Also lists speech with no cue over it.
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
const [video, srt] = process.argv.slice(2)
const dur = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video], { encoding: 'utf8' }).stdout)
const e = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', video, '-vn', '-af', 'silencedetect=n=-40dB:d=0.1', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 26 }).stderr
const sil = []; { let s = null; for (const l of e.split('\n')) { let m; if ((m = l.match(/silence_start: (-?[\d.]+)/))) s = Math.max(0, +m[1]); if ((m = l.match(/silence_end: ([\d.]+)/)) && s !== null) { sil.push([s, +m[1]]); s = null } } if (s !== null) sil.push([s, dur]) }
const speech = []; { let p = 0; for (const [a, b] of sil) { if (a > p) speech.push([p, a]); p = b } if (p < dur) speech.push([p, dur]) }
const ts = (s) => { const [h, m, x] = s.split(':'); return Number(h) * 3600 + Number(m) * 60 + Number(x.replace(',', '.')) }
const cues = fs.readFileSync(srt, 'utf8').trim().split(/\n\s*\n/).map((b) => { const L = b.split('\n'); const [a, c] = L[1].split(' --> '); return { a: ts(a), b: ts(c), text: L.slice(2).join(' ') } })
let worst = 0, sum = 0, n = 0; const rows = []
for (const c of cues) {
  const run = speech.find(([s, t]) => t > c.a - 0.05 && s < c.b)            // the speech run that overlaps the cue
  const onset = run ? Math.max(run[0], 0) : NaN
  const startsClip = run && run[0] >= c.a - 0.05 && run[0] <= c.a + 0.6      // the run begins at (just after) the cue start
  const d = onset - c.a
  rows.push(`${c.a.toFixed(2).padStart(7)}  onset ${Number.isNaN(onset) ? '  none' : (d >= 0 ? '+' : '') + d.toFixed(2).padStart(5)} ${startsClip ? 'clip start ' : 'inside clip'}  ${c.text.slice(0, 54)}`)
  if (startsClip) { sum += d; n++; if (Math.abs(d) > Math.abs(worst)) worst = d }
}
console.log(rows.join('\n'))
let outside = 0; for (const [s, t] of speech) if (!cues.some((c) => c.a - 0.4 < t && c.b + 0.4 > s)) outside += t - s
console.log(`\n${cues.length} cues; cues starting a clip: ${n}, mean voice onset after the cue start ${(sum / Math.max(1, n)).toFixed(2)} s, worst ${worst.toFixed(2)} s; speech outside any cue (+-0.4 s): ${outside.toFixed(2)} s`)
