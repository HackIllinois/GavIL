# LevelMeter

The live microphone level as seven bars; under reduced motion, words that don't jump ("Hearing speech" / "Quiet").

- **Provide:** `level` (0–1, about 15 readings a second), `paused`, `still` (force the words; default: words under reduced motion, read from the `--motion` token).
- Decorative (`aria-hidden`): a screen reader hears state changes (recording, paused, marked), never the level.
- Bars scale with `transform` over `dur-meter`; colour `select` on paper.
