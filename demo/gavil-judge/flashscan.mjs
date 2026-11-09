// usage: node flashscan.mjs <video.mp4> [--all]
// Looks for the things a viewer reads as a stall or a flicker, in a finished video (any size, 30 fps):
//  - "junk" frames: stretches where the picture is a solid colour, an empty background or a faded ghost (low spread), 2 frames or more
//  - page replacements: the picture changes completely between two frames (a tap's page load), with the spread before and after
//  - frozen stretches of 1.5 s or more, and whether a voice covers them
//  - gaps without speech of 2 s or more
// A voice under a junk stretch is flagged. Everything is printed with its time in the video.
import { spawnSync } from 'node:child_process'
const [video] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const W = 78, H = 169, N = W * H
const ffr = (args) => spawnSync('ffmpeg', ['-hide_banner', '-nostats', ...args], { encoding: 'utf8', maxBuffer: 1 << 28 }).stderr
const dur = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video], { encoding: 'utf8' }).stdout)
const fr = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', video], { encoding: 'utf8' }).stdout.trim().split('/').map(Number)
const FPS = fr[0] / (fr[1] || 1)
const px = spawnSync('ffmpeg', ['-v', 'error', '-i', video, '-an', '-vf', `scale=${W}:${H}:flags=area,format=gray`, '-fps_mode', 'passthrough', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 30 }).stdout
const nF = Math.floor(px.length / N)
const dp = new Float32Array(nF), sd = new Float32Array(nF)
for (let k = 0; k < nF; k++) {
  const o = k * N; let s1 = 0, s2 = 0, d = 0
  for (let i = 0; i < N; i++) { const v = px[o + i]; s1 += v; s2 += v * v; if (k) d += Math.abs(v - px[o - N + i]) }
  const m = s1 / N; sd[k] = Math.sqrt(Math.max(0, s2 / N - m * m)); dp[k] = k ? d / N : 0
}
// speech runs (gaps under 0.2 s merged)
const e = ffr(['-i', video, '-vn', '-af', 'silencedetect=n=-40dB:d=0.2', '-f', 'null', '-'])
const sil = []; { let s = null; for (const l of e.split('\n')) { let m; if ((m = l.match(/silence_start: (-?[\d.]+)/))) s = Math.max(0, +m[1]); if ((m = l.match(/silence_end: ([\d.]+)/)) && s !== null) { sil.push([s, +m[1]]); s = null } } if (s !== null) sil.push([s, dur]) }
const speech = []; { let p = 0; for (const [a, b] of sil) { if (a > p) speech.push([p, a]); p = b } if (p < dur) speech.push([p, dur]) }
const spoken = (a, b) => speech.some(([s, t]) => s < b && t > a)
const T = (x) => x.toFixed(2).padStart(7)

console.log(`${video}: ${dur.toFixed(2)} s, ${nF} frames, ${FPS} fps, ${speech.length} speech runs`)
console.log('\n-- junk frames (spread < 30 for 2+ frames)')
let n = 0
for (let k = 0; k < nF;) {
  if (sd[k] < 30) { let j = k; while (j + 1 < nF && sd[j + 1] < 30) j++; if (j - k + 1 >= 2) { n++; console.log(`  ${T(k / FPS)} - ${T((j + 1) / FPS)}  (${((j - k + 1) / FPS).toFixed(2)} s, spread ${sd[k].toFixed(1)}..${sd[j].toFixed(1)})${spoken(k / FPS, (j + 1) / FPS) ? '   UNDER VOICE' : ''}`) } k = j + 1 } else k++
}
if (!n) console.log('  none')
console.log('\n-- page replacements (change > 15 between two frames)')
n = 0
for (let k = 1; k < nF; k++) if (dp[k] > 15) { n++; console.log(`  ${T(k / FPS)}  change ${dp[k].toFixed(0).padStart(3)}  spread ${sd[k - 1].toFixed(0)} -> ${sd[k].toFixed(0)}${(k + 1 < nF && dp[k + 1] > 15) ? '  (next frame changes again)' : ''}`) }
if (!n) console.log('  none')
console.log('\n-- frozen stretches of 1.5 s or more (change < 0.3)')
n = 0
for (let k = 1; k < nF;) {
  if (dp[k] < 0.3) { let j = k; while (j + 1 < nF && dp[j + 1] < 0.3) j++; if ((j - k + 1) / FPS >= 1.5) { n++; console.log(`  ${T((k - 1) / FPS)} - ${T((j + 1) / FPS)}  (${((j - k + 2) / FPS).toFixed(2)} s)  ${spoken((k - 1) / FPS, (j + 1) / FPS) ? 'voice over it' : 'SILENT'}`) } k = j + 1 } else k++
}
if (!n) console.log('  none')
console.log('\n-- gaps without speech of 2 s or more')
n = 0
let p = 0
for (const [s] of [...speech, [dur, dur]]) { if (s - p >= 2) { n++; console.log(`  ${T(p)} - ${T(s)}  (${(s - p).toFixed(2)} s)`) } p = speech.find((x) => x[0] === s)?.[1] ?? dur }
if (!n) console.log('  none')
