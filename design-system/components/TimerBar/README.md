# TimerBar

The sticky countdown at the top of every in-judging screen. Cream on wood-deep when calm, gold under 10 minutes, alert-red under 2. The fill scales (transform) instead of resizing, so a two-hour round never relayouts every second.

- **Provide:** `secondsLeft` (re-syncs whenever it changes: pass server-derived time), `totalSeconds`, optional `live`, `endsAt`, `label`, `warnAt` (600), `urgentAt` (120), `haptics` (default on).
- `live` counts down by itself from wall time, never by counting timer ticks: the end is `endsAt` (epoch ms, best from the server) or now + `secondsLeft` (reset whenever `secondsLeft` changes). Ticks land on whole seconds and returning to the tab or waking the phone re-reads the clock, so a throttled tab or a phone that slept loses no time. Without `live`, it shows `secondsLeft` as given.
- Crossings (10 min, 2 min, time up) are felt and seen once: `GavIL.haptic` buzzes on Android and the band flashes once (`dur-attention`, opacity only) for iPhones, which can't vibrate. Never on mount, never every tick.
- Screen readers hear only threshold crossings, never every tick.
- At zero it reads "Time is up" and shows the rule: finish this project, then cast your last vote. The screen swaps Submit for **Submit final evaluation** and hides Skip.
- The fill is linear over `dur-tick`; the urgent dot pulses (`loop` iterations). Both stop under reduced motion, and so does the one-shot flash on a threshold crossing (its keyframe starts from zero there); the band's colour and the live region still say it.
- `onExpire` fires once per crossing into zero, never again on re-renders at zero.
