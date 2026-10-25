# ActionBar

Sticky wood bar at the bottom holding the screen's forward action (right) plus one escape hatch (left).

- **Provide:** children (a ghost/secondary button, then one primary that fills the rest), optional `toast` (+ `toastId`, `toastTone`) to float a Toast above the bar.
- Respects the iPhone home indicator and landscape notches via `env(safe-area-inset-*)`.
- Skip opens `SkipSheet`. When time is up, drop Skip and make the primary **Submit final evaluation**.
