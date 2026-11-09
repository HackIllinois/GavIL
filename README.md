# Gav-IL — HackIllinois 2027 judging platform

Phone-first judging (pairwise Round 1, per-prize Round 2) plus the staff/admin console for coverage, anti-cheat, deliberations and admissions.

- **Design system** (tokens, components, clickable prototypes, tests): [`design-system/`](design-system/) · [published](https://claude.ai/artifact/Ttwy6mbJjbjfLXHnnemVAk)
- **Spec sheet** (OpenPencil, generated from the tokens and the components): [`design-system/design/`](design-system/design/) — `cd design-system && ~/.bun/bin/bun scripts/make_spec_sheet.mjs` (add `--check` to audit without writing)
- **Brand art** (the real 2027 files, exported from Figma, never redrawn): [`design-system/assets/brand/`](design-system/assets/brand/) — every file has a row in [`MANIFEST.md`](design-system/assets/brand/MANIFEST.md)
- **How we work** (agents and humans): [`AGENTS.md`](AGENTS.md)
- **Design doc** (structure, UI flow, auth, production, algorithm): [`docs/design-doc.md`](docs/design-doc.md) · [published](https://claude.ai/artifact/SvVe9LF7froj69JYT3rWkd) (rebuild with `python3 docs/build_doc_page.py`)
- **App** (Next.js 16 on Cloudflare via OpenNext; runs on a mock adonix until adonix has the judging routes): [`web/`](web/) — `cd web && cp .env.example .env.local && npm install && npm run dev`. Deploy, headers and secrets: [`web/README.md`](web/README.md#deploy) and design doc §6.1
- **API contract** (every endpoint adonix must add): [`web/lib/api/CONTRACT.md`](web/lib/api/CONTRACT.md)
- **Decisions and open questions**: [`docs/decisions.md`](docs/decisions.md)
- **Review rounds** (each round's consensus list, and where its findings were fixed): [`docs/reviews/`](docs/reviews/)
- **Demo videos**: the silent walkthrough [`demo/gavil-demo.mp4`](demo/gavil-demo.mp4) (about 2.5 min, judge + admin; re-record it with `cd demo && npm install && npm run record` while `design-system/` is served on port 8766), and the narrated ndemo demo (the judge app, then the admin console, with a voiceover; its mp4s are not committed). See [`demo/README.md`](demo/README.md)

```bash
cd design-system && python3 scripts/build_previews.py && python3 -m http.server 8765
# judge prototype: http://localhost:8765/.preview/p/JudgePrototype-sunset.html
# tests:           http://localhost:8765/tests/   (headless, both themes: node scripts/run_tests.mjs)
cd ../web && npm test && npm run typecheck && npm run lint
```
