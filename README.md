# Gav-IL — HackIllinois 2027 judging platform

Phone-first judging (pairwise Round 1, per-prize Round 2) plus the staff/admin console for coverage, anti-cheat, deliberations and admissions.

- **Design system** (tokens, components, clickable prototypes, tests): [`design-system/`](design-system/) · [published](https://claude.ai/artifact/Ttwy6mbJjbjfLXHnnemVAk)
- **Spec sheet** (OpenPencil, generated from the tokens and the components): [`design-system/design/`](design-system/design/) — `cd design-system && ~/.bun/bin/bun scripts/make_spec_sheet.mjs` (add `--check` to audit without writing)
- **Brand art** (the real 2027 files, exported from Figma, never redrawn): [`design-system/assets/brand/`](design-system/assets/brand/) — every file has a row in [`MANIFEST.md`](design-system/assets/brand/MANIFEST.md)
- **How we work** (agents and humans): [`AGENTS.md`](AGENTS.md)
- **Design doc** (structure, UI flow, auth, algorithm): [`docs/design-doc.md`](docs/design-doc.md) · [published](https://claude.ai/artifact/SvVe9LF7froj69JYT3rWkd) (rebuild with `python3 docs/build_doc_page.py`)
- **App skeleton** (Next.js 15, runs on mock data): [`web/`](web/) — `cd web && npm install && GAVIL_MOCK=1 npm run dev`
- **Decisions and open questions**: [`docs/decisions.md`](docs/decisions.md)
- **Demo video** (2.5 min walkthrough, judge + admin): [`demo/gavil-demo.mp4`](demo/gavil-demo.mp4). Re-record it with `cd demo && npm install && npm run record` while `design-system/` is served on port 8766

```bash
cd design-system && python3 scripts/build_previews.py && python3 -m http.server 8765
# judge prototype: http://localhost:8765/.preview/p/JudgePrototype-sunset.html
# tests:           http://localhost:8765/tests/
```
