# CLAUDE.md

@AGENTS.md

## Claude Code specifics

- Load the design-system README (`design-system/README.md`) before any UI work; it holds the usage rules that `AGENTS.md` points to.
- Verify UI in a browser, not by reading code: build previews, serve `design-system/`, run `tests/` in both themes, and look at the 390px screens.
- When the published Design System artifact needs updating, publish only the changed `project/` files to https://claude.ai/artifact/Ttwy6mbJjbjfLXHnnemVAk (the repo's `design-system/` maps to the artifact's `project/`).
- For design review, external CLIs are installed: `codex exec -s read-only`, `cursor-agent -p --mode ask --trust`, `opencode run`, `muse exec`. Give them `design-system/` and the rules in `AGENTS.md`; fix what holds up and rerun the tests.
- Commit only when asked.
