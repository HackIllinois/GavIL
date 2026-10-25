# NotesField

Private notes with autosave. While typing, the last status stays (dimmed); "Saving…" appears only if a save is slow.

- **Provide:** `value` + `onChange(text)` or `defaultValue`, `onSave(text, version)` (may return a Promise; `'local'` shows **Saved on this phone**; a rejection or a throw shows **Not saved · Retry** and keeps the text; `version` grows with every save, for servers that reject stale writes), `syncKey` (change it, e.g. on reconnect, to flush a pending save now and re-send a note that was only saved on the phone), `label`, `placeholder`, `rows`, `disabled`.
- The draft is the parent's on every keystroke (`onChange`): keep it on the device (the prototype keeps it in localStorage; the web app should use IndexedDB) right there. `onSave` is only the remote sync after `dur-autosave` (700ms) of quiet; when it finds you offline, queue the draft and return `'local'`. A pending sync is flushed on unmount (Submit, next project, sheet closed) and when `syncKey` changes, so nothing typed is lost.
- Saves run one at a time, in order: while one is in flight, newer text waits and only the newest is sent next, so an old save never lands after a newer one. The label never says **Saved** while newer text still waits.
- Mount with `key={projectId}` so one project's draft never shows under another.
- 16px text so iOS Safari does not zoom on focus.
- Never block Submit on unsaved notes; "Saving…" waits `dur-delay`.
