// Pre-generates ndemo narration with free Microsoft neural voices (edge-tts via uvx), named exactly as
// ndemo's cache expects ({segment.id}-{sha256(narration+voice+speed)[:8]}.mp3), so ndemo never calls OpenAI.
// usage: node gen-tts.mjs /abs/path/playbook.yaml
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
// ndemo's own copy of `yaml` (ndemo is a project skill at .claude/skills/ndemo, built once).
const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.claude', 'skills', 'ndemo', 'package.json'))
const YAML = require('yaml')
const pb = path.resolve(process.argv[2]); const pbDir = path.dirname(pb)
const doc = YAML.parse(fs.readFileSync(pb, 'utf8'))
const voice = doc.tts?.voice ?? 'en-US-AndrewNeural', speed = doc.tts?.speed ?? 1.0
const out = path.join(path.resolve(pbDir, doc.recording?.outputDir ?? '.'), 'audio'); fs.mkdirSync(out, { recursive: true })
const rate = `${speed >= 1 ? '+' : '-'}${Math.round(Math.abs(speed - 1) * 100)}%`
for (const s of doc.segments ?? []) {
  if (!s.narration) continue
  const h = crypto.createHash('sha256').update(s.narration + voice + speed).digest('hex').slice(0, 8)
  const f = path.join(out, `${s.id}-${h}.mp3`)
  for (const g of fs.readdirSync(out)) if (g.startsWith(s.id + '-') && g.endsWith('.mp3') && path.join(out, g) !== f && /^[0-9a-f]{8}\.mp3$/.test(g.slice(s.id.length + 1))) fs.unlinkSync(path.join(out, g))
  if (fs.existsSync(f) && fs.statSync(f).size > 0) { console.log('cached', s.id); continue }
  execFileSync('uvx', ['edge-tts', '--voice', voice, `--rate=${rate}`, '--text', s.narration, '--write-media', f], { stdio: ['ignore', 'ignore', 'inherit'] })
  console.log('made  ', s.id, fs.statSync(f).size, 'bytes')
}
