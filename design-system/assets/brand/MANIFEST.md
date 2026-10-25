# Brand art manifest

Real HackIllinois 2027 art, exported from Figma on 2026-10-21. Nothing here is redrawn or traced. Mechanical edits only: `longhorn-logo-alt.svg` lost the white backdrop rectangle of its frame; `bg-desert-path.jpg` is a JPEG re-encode, and the divider, prop and signpost PNGs are crops of the exact exported pixels. Each is noted in its row.

Sources (original files, view-only for the connector):

- Design System: https://www.figma.com/design/aYk3JNUFixneI9DKuUgATq (draft copy key `jhRRfujMatQ8C7EVsce0Eg`)
- Registration: https://www.figma.com/design/j8zBEXzk8Yvd1OD3HvuJWR (draft copy key `4a8LmbWtO0QuPm1zvrpel1`)
- Website: https://www.figma.com/design/9SMl0fLhpbfHbN9YFCvQjj (draft copy key `z5VAuj5k2Ena1LN9TfRHm8`)

Method: the Figma MCP could not read the files or their draft copies (the copies are in an Education-team Drafts space that is still view-only). Art was exported through the Figma web UI in Chrome: Export panel (PNG/SVG) and Copy as SVG. Node ids are from the original files (the copies keep the same ids).

Brand rule 2 (AGENTS.md): never redraw. Re-export from Figma if something here is wrong.

| File | What it is | Source (file > page > node) | Format | Size | Intended use |
|---|---|---|---|---|---|
| `h-mark.svg` | The HackIllinois "H" mark: two interlocking angular blocks. White fill, transparent background. | Registration > General Registration Form > Confirmation - hifi (4924:8143) > Logo > hackillinois-main 1 (4924:8313); the two mark vectors only | SVG, 48x73 viewBox | 0 KB | Not placed on a screen: the lockup (which contains it) is the header mark. `Brand name="h-mark"` is there for a bar too narrow for the lockup. White: use on ground, wood or night, never on paper. |
| `hackillinois-lockup.svg` | H mark plus "HACK ILLINOIS" wordmark, stacked lockup. White fill, transparent background. | Registration > General Registration Form > hackillinois-main 1 (4924:8313) | SVG, 221x73 viewBox | 5 KB | Cover and admin header on ground or wood. |
| `longhorn-logo.svg` | Longhorn skull logo: mirrored skulls and five stars (variant with long horns). Black #231F20, transparent background. | Design System > Style Guide 2027 > logo (2383:355) > Union (2383:386) | SVG, 374x406 viewBox | 12 KB | Cover, signpost and wanted-poster marks on paper (dark on cream). |
| `longhorn-logo-alt.svg` | Longhorn logo, second variant (flat horn bar on top). Black, transparent. The frame's white backdrop rectangle was removed; the paths are untouched. | Design System > Style Guide 2027 > logo (2383:355) > logo 2 (2383:390) | SVG, 513x501 viewBox | 12 KB | Not used on a screen (the long-horn variant is the sign-in seal and the Cover). Black, on paper. |
| `character-orange-block-cowboy.svg` | Character: orange block in cowboy hat and red bandana, plus a red shrimp-bird and cyan streak. viewBox is the whole frame (7696x6030), so there is empty margin. | Design System > Characters > Frame 2 (2323:188) | SVG, 7696x6030 viewBox | 577 KB | Not used on a screen: 591 KB and a whole-frame viewBox. A candidate for a later empty state, never a judge screen. |
| `character-teal-sphere-cowboy.svg` | Character: teal sphere in cowboy hat with a black tie. Full frame viewBox 6044x6044. | Design System > Characters > Frame 5 (2323:295) | SVG, 6044x6044 viewBox | 9 KB | The Cover, beside the name sign. |
| `character-yellow-wedge.svg` | Character: yellow wedge (cheese-like triangle) with a mallet and teeth. Full frame viewBox 6128x6128. | Design System > Characters > Frame 3 (2323:259) | SVG, 6128x6128 viewBox | 7 KB | Not used on a screen. |
| `bg-sunset.png` | Painted canyon sunset background (orange and red, gold sun). Opaque, uncropped, 1x. 2x would be about 3.5 MB, over the cap. | Registration > General Registration Form > sunset 1 (4619:642) | PNG RGBA, 1280x832 | 912 KB | Sunset theme: cover and page background (behind the ground color). |
| `bg-night.png` | Painted canyon night background (blue, crescent moon). Opaque, uncropped, 1x. Frame fill #3B419C = the night theme ground token. | Registration > General Registration Form > sunset 7 (4991:3485) | PNG RGBA, 1280x1189 | 1.12 MB | Night theme: cover and page background. |
| `bg-desert-path.jpg` | Tall painted desert with a winding sand path (opaque). Original is a 8.6 MB PNG, so this is a JPEG q90 of the exact pixels. | Website > Prizes > Untitled_Artwork 8 (1207:17), image Untitled_Artwork.png | JPEG, 1533x5986 | 759 KB | Prizes and Round 2 long-scroll background. |
| `wood-plank-default.png` | Wooden plank, octagonal ends. Raster, transparent. Matches the Figma image exactly. | Registration > General Registration Form > default 1 (4906:2094), default.png | PNG RGBA, 1223x329 | 104 KB | Button texture and app bar plank (default button). |
| `wood-plank-left.png` | Wooden plank whose arrow TIP POINTS RIGHT (swallowtail notch on the left). The Figma name is the notch side, not the tip: checked on the pixels, and the suite checks it again. Next, go here. Transparent. | Registration > General Registration Form > left 1 (4906:2095), left.png | PNG RGBA, 1170x365 | 107 KB | Next / go-here button texture and the inline Wayfinding sign (derived: `plank-point-right.webp`). |
| `wood-plank-right.png` | Wooden plank whose arrow TIP POINTS LEFT (notch on the right). Back. Transparent. | Registration > General Registration Form > right 1 (4906:2096), right.png | PNG RGBA, 1213x400 | 106 KB | Back button texture (derived: `plank-point-left.webp`). |
| `wood-plank-default.svg` | Vector version of the default plank (designer's own vectorized copy). Scales without blur. | Registration > General Registration Form > default 2 [Vectorized] (4920:2532) | SVG, 1040x264 viewBox | 78 KB | Same as the PNG; prefer for sizes above 1x. |
| `wood-plank-left.svg` | Vector version of the plank that points right (same naming as the PNG). | Registration > General Registration Form > left 2 [Vectorized] (4920:2420) | SVG, 1040x264 viewBox | 79 KB | Same as the PNG. |
| `wood-plank-right.svg` | Vector version of the plank that points left. | Registration > General Registration Form > right 2 [Vectorized] (4920:2202) | SVG, 1040x264 viewBox | 78 KB | Same as the PNG. |
| `signpost-nav@2x.png` | Blank wooden signpost: post and five signs (rectangle, left arrow, right arrow, left arrow, rectangle), no lettering. 2x, transparent, cropped to its alpha bounds. | Website > Prizes > Group 105 > IMG_0431 1 (1039:56), IMG_0431.png, exported 2x | PNG RGBA, 718x1135 | 279 KB | Signpost navigation (judge table finder, admin nav). Lettering is live text in the app. |
| `neon-sign-board.png` | Neon marquee sign: HACK ILLINOIS board with starbursts and longhorn medallion. Transparent with glow. | Website > Landing > Group 70 (1155:3073) | PNG RGBA, 1120x655 | 731 KB | The countdown screen above the digits (as `derived/neon-board.webp`) and the Cover at Night. |
| `neon-sign-arrow.png` | Neon arrow-and-post that carries the marquee. Transparent with glow. | Website > Landing > Group 123 (1155:2640) | PNG RGBA, 1074x1451 | 1.07 MB | Not used on a screen: the marquee alone is the sign, and the post would need a canvas taller than the Cover. |
| `wagon.png` | Covered wagon. Transparent, cropped to alpha bounds. | Website > Prizes > IMG_0448 1 (1175:17), IMG_0448.png | PNG RGBA, 670x805 | 199 KB | Empty states and prize page accents. |
| `horseshoe-gold.png` | Gold horseshoe with nail holes. Transparent, cropped. | Website > Prizes > IMG_0427 1, IMG_0427.png (node id not captured) | PNG RGBA, 405x429 | 101 KB | Decoration, rosette ring candidate. |
| `cactus-tall.png` | Purple prickly-pear cactus with orange outline. Transparent, cropped. | Website > Prizes > Untitled_Artwork 2 1, Untitled_Artwork 2.png (node id not captured) | PNG RGBA, 686x732 | 197 KB | Footer and empty-state decoration. |
| `cactus-round.png` | Round prickly-pear cluster. Transparent, cropped. | Website > Prizes > Untitled_Artwork 3 2, Untitled_Artwork 3.png (node id not captured) | PNG RGBA, 550x444 | 120 KB | Footer and empty-state decoration. |
| `cactus-bushes.png` | Two cactus bush clumps meant to sit at the left and right page edges. Art is cut by the Figma frame edges (as in the source). Transparent, cropped. | Website > Prizes > IMG_0429 1 (1037:50), IMG_0429.png | PNG RGBA, 1005x411 | 101 KB | Not used on a screen: a footer edge decoration candidate. |
| `progress-stars.png` | Sheriff-star progress tracker: filled, half, outline stars on a line, on a dark grid. Opaque (mock track). Compare to the app's own step tracker. | Registration > General Registration Form > IMG_0399 1 (4899:2098), IMG_0399.png. User export (Figma), ~/Downloads; byte-identical to the agent's export | PNG RGBA, 2637x427 | 187 KB | Round 2 / step progress reference. |
| `frieze-horses-sunset.png` | Horse line-art frieze on an orange sunset gradient. The X boxes are image placeholders from the mock, not art. Opaque. | Registration > General Registration Form > IMG_0397 1 (4899:2100), IMG_0397.png. User export (Figma), ~/Downloads | PNG RGBA, 2634x335 | 591 KB | Reference only (mid-fi mock). Sunset theme divider idea. |
| `frieze-horses-night.png` | Same horse line-art frieze on the dark night grid. The X boxes are image placeholders from the mock, not art. Opaque. | Registration > General Registration Form > IMG_0398 1 (4899:2099), IMG_0398.png. User export (Figma), ~/Downloads | PNG RGBA, 2560x366 | 200 KB | Reference only (mid-fi mock). Night theme divider idea. |
| `divider-horses-cream.png` | Garland divider: cream horses on a line. Transparent, tight crop of one row of the sheet (6px pad). | Registration > General Registration Form > Progress Bars sheet, IMG_0430 1 (5053:2856), IMG_0430.png (3500x3654), cropped with Pillow. User export (Figma), ~/Downloads | PNG RGBA, 2740x191 | 132 KB | Section dividers and progress garlands on ground (both themes); grey = disabled/upcoming. |
| `divider-horses-brown.png` | Garland divider: brown horses. Transparent, tight crop of one row of the sheet (6px pad). | Registration > General Registration Form > Progress Bars sheet, IMG_0430 1 (5053:2856), IMG_0430.png (3500x3654), cropped with Pillow. User export (Figma), ~/Downloads | PNG RGBA, 2739x192 | 126 KB | Section dividers and progress garlands on ground (both themes); grey = disabled/upcoming. |
| `divider-horseshoes.png` | Garland divider: gold horseshoes. Transparent, tight crop of one row of the sheet (6px pad). | Registration > General Registration Form > Progress Bars sheet, IMG_0430 1 (5053:2856), IMG_0430.png (3500x3654), cropped with Pillow. User export (Figma), ~/Downloads | PNG RGBA, 2586x247 | 175 KB | Section dividers and progress garlands on ground (both themes); grey = disabled/upcoming. |
| `divider-horses-orange.png` | Garland divider: orange horses. Transparent, tight crop of one row of the sheet (6px pad). | Registration > General Registration Form > Progress Bars sheet, IMG_0430 1 (5053:2856), IMG_0430.png (3500x3654), cropped with Pillow. User export (Figma), ~/Downloads | PNG RGBA, 2740x191 | 120 KB | Section dividers and progress garlands on ground (both themes); grey = disabled/upcoming. |
| `divider-horses-lime.png` | Garland divider: lime horses. Transparent, tight crop of one row of the sheet (6px pad). | Registration > General Registration Form > Progress Bars sheet, IMG_0430 1 (5053:2856), IMG_0430.png (3500x3654), cropped with Pillow. User export (Figma), ~/Downloads | PNG RGBA, 2739x191 | 123 KB | Section dividers and progress garlands on ground (both themes); grey = disabled/upcoming. |
| `divider-cowboy-hats.png` | Garland divider: cowboy hats. Transparent, tight crop of one row of the sheet (6px pad). | Registration > General Registration Form > Progress Bars sheet, IMG_0430 1 (5053:2856), IMG_0430.png (3500x3654), cropped with Pillow. User export (Figma), ~/Downloads | PNG RGBA, 2727x115 | 90 KB | Section dividers and progress garlands on ground (both themes); grey = disabled/upcoming. |
| `divider-horses-grey.png` | Garland divider: grey horses. Transparent, tight crop of one row of the sheet (6px pad). | Registration > General Registration Form > Progress Bars sheet, IMG_0430 1 (5053:2856), IMG_0430.png (3500x3654), cropped with Pillow. User export (Figma), ~/Downloads | PNG RGBA, 2667x187 | 124 KB | Section dividers and progress garlands on ground (both themes); grey = disabled/upcoming. |

## Derived files (phone-sized)

`derived/` holds what the screens actually load, made by `python3 scripts/make_brand_derived.py` from the originals above. They are the same pixels cropped to the art's own alpha bounds (or to one state of a sheet) and re-encoded as WebP: nothing is redrawn, traced, tinted or retouched. Each is a token (`art-*` in `tokens.json`); `derived/geometry.json` has every file's pixel size and the planks' end caps.

| File | From | Size | Used by |
|---|---|---|---|
| `derived/bg-sunset.webp` | `bg-sunset.png`, whole | 1280x832, 83 KB | the sunset page ground (judge shell, sign-in), the Cover |
| `derived/bg-night.webp` | `bg-night.png`, whole | 1280x1189, 141 KB | the night page ground, the Cover |
| `derived/plank-flat.webp` | `wood-plank-default.png`, alpha bounds | 750x192, 13 KB | the wood button (3-slice), the Cover sign |
| `derived/plank-point-right.webp` | `wood-plank-left.png` (it points RIGHT) | 755x192, 14 KB | Next, the inline Wayfinding sign |
| `derived/plank-point-left.webp` | `wood-plank-right.png` (it points LEFT) | 757x192, 14 KB | Back |
| `derived/signpost.webp` | `signpost-nav@2x.png` | 718x1135, 72 KB | the hero Wayfinding, EnRoute, the Cover |
| `derived/star-filled.webp`, `star-half.webp`, `star-outline.webp` | `progress-stars.png`, one round medallion per state (the sheet's dark tile is part of the art) | 192x192, 4-5 KB each | `TableProgress` |
| `derived/garland-cream.webp`, `garland-brown.webp` | `divider-horses-cream.png`, `divider-horses-brown.png` | 780 wide, 14 KB each | `Garland` (cream on the painting, brown on paper) |
| `derived/wagon.webp`, `horseshoe.webp`, `cactus-tall.webp`, `cactus-round.webp`, `cactus-bushes.webp` | the prop PNGs, alpha bounds | 220-320 high, 13-21 KB each | `Prop`, `EmptyState`, the waiting state, Round 1 complete |
| `derived/neon-board.webp` | `neon-sign-board.png` | 560 wide, 47 KB | the countdown screen (above the digits) and the Cover at Night |
| `derived/neon-arrow.webp` | `neon-sign-arrow.png` | 560 wide, 104 KB | **not used**: no screen references it, so no phone downloads it; derived once so a later screen needs no re-export |

Not derived, used as exported: `h-mark.svg`, `hackillinois-lockup.svg`, `longhorn-logo*.svg`, `character-teal-sphere-cowboy.svg` (all a few KB). Not used on a screen: `bg-desert-path.jpg` (a 1:3.9 strip fits neither the Cover nor the 7330 x 900 storyboard), `frieze-horses-*` (mid-fi references with placeholder boxes), the other garlands (orange, lime, hats, grey, horseshoes: the cream and brown ones carry the job), `character-orange-block-cowboy.svg` (591 KB, a whole-frame viewBox: a Cover-only candidate), `character-yellow-wedge.svg`, `cactus-bushes.png` is derived but only a footer candidate, `wood-plank-*.svg` (the PNGs are the source of the derivatives).

## Not exported or not found

- **PNG at 2x for backgrounds:** `bg-sunset.png` and `bg-night.png` are 1x. A 2x PNG would be about 3.5 MB (cap is 1.5 MB). `bg-desert-path.jpg` is JPEG because the PNG was 8.6 MB.
- **Other painted background variants** (sunset 2 pink, sunset 3 purple, sunset 4 indigo, sunset 5 light blue, sunset 6 purple, `review`) exist in Registration > General Registration Form (row above the hi-fi screens). Not exported. Two "Review - hifi" frames and the desktop and phone mid-fi frames show them in use.
- **Node 197:1631 (Website):** the URL opens the Prizes page and does not resolve to a single selectable frame in the draft copy. The signpost navigation came from Prizes > Group 105 instead.
- **Saloon wood treatment:** the wood is the three planks above. The Job Board page also has a saloon floor tile pattern ("saloon floor tiles warm tint-01"), poker chips, tables and a stool; not exported.
- **Stars and rosettes:** no standalone vector sheriff star or rosette exists in the three files. The only stars are in `progress-stars.png`, the longhorn logos, and the neon sign. Needs a Figma request (see report). **Interim, not Figma art:** the Round 1 complete badge and the Cover draw `.gv-star`, a 12-point `clip-path` shape in `components/bundle.css`, until a standalone star is exported. `derived/star-filled.webp` is not a drop-in: it is a ball-tipped star on its dark tile (the progress tracker's).
- **"Brand Guide 2027" page:** the Design System file has no such page; its pages are Style Guide 2027, Characters, Suggestions, Old Style Guide.
- **H mark colors:** Figma only has the white mark. No dark variant exists.
- **Stock photos** on the Website file (iStock and Alamy references, a saloon street photo) were left out on purpose: licensed, not brand art.
- **Character sheets** (Sloth Sheriff, Vulture Mercenary) are posing/design sheets, not final art. Only the three finished characters are exported.

## Notes on use

- Dividers, planks and signpost are transparent PNGs; use `image-rendering` defaults, and size them with width only. The screens load the `derived/` WebP copies, never these originals.
- White marks (`h-mark.svg`, `hackillinois-lockup.svg`) vanish on paper. Put them on ground, wood or night.
- `character-orange-block-cowboy.svg` is 591 KB; trim its viewBox in CSS (not in the file) or lazy-load it.
- Sizes are all under 1.5 MB per file; the whole folder is about 8.5 MB.
