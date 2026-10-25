# Brand

The 2027 marks as real art: the HackIllinois lockup and H mark (white: wood, ground-deep or the painted ground) and the longhorn (black: paper). Exported from Figma, never redrawn, never recolored.

- **Provide:** `name` (`lockup` the H mark with HACK ILLINOIS, `h-mark`, `longhorn`, `longhorn-alt`), optional `alt` (default: "HackIllinois", "HackIllinois longhorn logo"), `decorative` (alt empty and hidden from assistive tech: use it when the mark sits beside text that names it), `lazy`, `className`.
- **White marks** (`lockup`, `h-mark`) belong on wood (the app bar, the admin header), on a `ground-deep` band or on the painted ground; there is **no dark H mark** and none is drawn. Where the ground is light, put the white mark on the purple ground band. **The longhorn is black**: paper only (the sign-in seal `gv-seal`, the Cover).
- Height is `mark-h` (40px) for the lockup; the `<img>` carries its natural width and height so nothing shifts when it loads. The file URL is the `--art-*` token; a host that serves the art elsewhere overrides the token, never the component.
- **If the picture does not arrive** (flaky Wi-Fi, offline, a missing token) a white mark becomes its name in plain body type ("HackIllinois", its accessible name, in the lettering colour of the wood or band under it). The lockup is Figma art and is never typeset in code, so the fallback does not imitate it; the header never shows a broken-image box or clipped alt text; the longhorn steps aside (`data-art="failed"`, out of the layout). The suite fails each image in place to check both.
