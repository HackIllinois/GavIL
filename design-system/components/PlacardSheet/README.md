# PlacardSheet

The print sheet for a room's placards: one per page under @media print, with Print and Close. Admins and staff open it from the console.

- **Provide:** `tables` (each a `TablePlacard`’s props: the `label` as printed and the full 43-character `k` of adonix's `Placard`, so the QR and the printed code are exactly what the server issued), `title`, `onClose` (optional: Close and Escape call it, and without one they close the sheet themselves, so the dialog can never leave the page inert with no way out), optional `onPrint` (default `window.print()`), `controls` (e.g. a room select and the names option), `printNames`, `inline` (render in place, for docs).
- `printNames` (default false) prints each table's `project` in its name slot (the preview above sets it); off, every slot is blank, so moving a team needs no reprint. Make it an explicit choice in the console.
- Not inline it is a full-screen dialog in a portal on `window.ReactDOM`/`<body>`: `aria-modal`, everything behind is inert, focus starts on the title and returns to the opener, Tab is trapped, Close and Escape close it.
- **Print:** `@page` is US Letter with 0.5 in margins; every placard gets its own page (`break-after: page`, `break-inside: avoid`) at full size, 0.1 in short of the printable height so no page spills a blank sheet after it; the bar and the app behind are not printed (`html.gv-printing`).
- On screen the placards are scaled thumbnails (`--placard-scale`), wrapped and centred, larger on a phone. The page list scrolls, so it is a tab stop (`tabindex=0`, named "Placards, one per page", with a focus ring): arrow keys and PageDown scroll it.
