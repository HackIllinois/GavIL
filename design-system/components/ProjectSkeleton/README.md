# ProjectSkeleton

The loading state of ProjectHeader, with the same geometry, so nothing shifts when the project arrives on venue Wi-Fi.

- **Provide:** optional `label` for screen readers (default "Loading your next project…"), `rows` (how many closed Disclosure rows to hold under the poster).
- Same height as ProjectHeader (badge row, ruled eyebrow, name, two tagline lines), and each held row is a 48px Disclosure: nothing moves when the project arrives. Render NotesField and NominationPicker from the start; they don't wait for the project.
- Invisible for `dur-delay` (300ms), so fast loads never flash; then a gentle opacity pulse (no shimmer) that stops under reduced motion (`loop` is 0).
