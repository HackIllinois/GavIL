# Tabs

Admin console navigation on wood. Counts in red mark work waiting (flagged projects); a lock marks tabs a role can only read. Every tab names its panel.

- **Provide:** `items` `[{id,label,count?,tone?,locked?,icon?}]`, `value` + `onChange(id, {keyboard})` (controlled: you may refuse a change, e.g. to confirm discarding edits; focus then stays where it was) or `defaultValue`, `label`, `panelPrefix`.
- Every tab names its panel: `aria-controls` is always set, to `panelPrefix` (default `gv-panel-`) + the tab's id, and the tab's own id is `gv-tab-<id>`. Render the panel as `<div role="tabpanel" id="gv-panel-overview" aria-labelledby="gv-tab-overview">` (the preview above does).
- `locked` = read-only for this role. The tab still opens; edit controls inside are disabled.
- Keyboard: Left/Right/Home/End. Focus stays visible on the selected tab (a cream ring over the gold underline); the tab the keyboard moved to carries `data-kb-focus`, so the ring shows even where `:focus-visible` guesses wrong.
- On narrow screens it scrolls sideways and fades at the edge to say there is more.
