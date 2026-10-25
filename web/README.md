# Gav-IL web

The HackIllinois 2027 judging app (phone-first, for judges) and admin console (laptop-first, for staff and admins).
It runs on Next.js 15 App Router, React 19 and TypeScript, and deploys to Cloudflare Workers through OpenNext, the same way `HackIllinois/admin-site` does.
Data and auth come from [adonix](https://github.com/HackIllinois/adonix). Styling comes from `../design-system`. This app has no Tailwind and no MUI.

Read `../AGENTS.md` and `../design-system/README.md` before changing UI.

## Run it

```bash
cd web
cp .env.example .env.local      # GAVIL_MOCK=1 serves fixtures, no backend needed
npm install
npm run dev                     # http://localhost:3000  (PORT=3100 npm run dev for another port)
```

Then open `/login` and pick **Judge**, **Staff** or **Admin** under "Mock sign-in". Mock mode runs **only under `next dev` and vitest** (`GAVIL_MOCK=1` with `NODE_ENV` development or test): `next start` and a deployed build refuse to boot with `GAVIL_MOCK=1` (see Environment). The email code `123456` and the `demo-j1` link need `GAVIL_MOCK_DEMO=1` as well; without it codes are random.

## Environment

Every variable the app reads. Secrets are server-only (never `NEXT_PUBLIC_`); on Cloudflare set them with `wrangler secret put NAME`.

| Variable | Where | Required | What it does |
|---|---|---|---|
| `ADONIX_URL` | all | yes | adonix base URL (default `https://adonix.hackillinois.org`). Server-only and read at runtime on every request, so overriding it in `wrangler.jsonc` `vars` (a staging deploy) changes where auth and API calls go without a rebuild. `wrangler.jsonc` `vars` sets the production default |
| `NEXT_PUBLIC_ADONIX_URL` | all | no | The old name for `ADONIX_URL`, still read at runtime when `ADONIX_URL` is unset. Not needed: a `NEXT_PUBLIC_` value is frozen into the build by `next build`, which is why `ADONIX_URL` replaced it |
| `GAVIL_ORIGIN` | production | yes | Our public origin, or a comma-separated allow-list (first entry = the default); sent as `Origin` on every adonix write and the only source of the staff Google sign-in callback (the request's own origin only when it is on the list; a Host or X-Forwarded-Host header is never trusted). A deployed build without a usable one serves no judging or admin page (`getApi` throws); `next dev` and vitest need none. `wrangler.jsonc` `vars` sets `https://judging.hackillinois.org`; a staging deploy overrides it |
| `GAVIL_JWT_SECRET` | production | recommended | adonix's `JWT_SECRET`, shared: sessions are verified with a local HMAC on every request. Without it each session token costs one `GET /auth/roles/` round trip a minute, and a dead (expired or revoked) judge session names nobody: only a token whose signature this server can check may tell `/login` to clear a judge's drafts from the phone (`verifiedClaims`) |
| `GAVIL_GRANT_SECRET` | production | yes | ≥ 32 random characters, Gav-IL only (never shared). Signs the placard scan grant that `/t/<CODE>` swaps the QR's `k` for. Without it no grant is minted: a scanned QR asks the judge to type the placard check instead |
| `GAVIL_PLACARD_SECRET` | adonix | yes (adonix) | Signs placard QR tokens `k` (`placardToken`). It lives in adonix, which checks `k`; Gav-IL's server never needs it outside mock mode |
| `GAVIL_TALK_SECRET` | production + adonix | yes, if Table talk is used | ≥ 32 characters, shared with adonix: signs transcript receipts. Without it every recording and highlights call is `503 TalkNotConfigured` |
| `CF_ACCOUNT_ID`, `CF_API_TOKEN` | production | for Table talk | Workers AI speech to text |
| `ANTHROPIC_API_KEY` | production | optional | Claude highlights (the rule extractor always runs) |
| `GAVIL_HIGHLIGHTS_MODEL` | production | optional | Claude model, only from the allowlist in `lib/talk/llm.ts` (default `claude-opus-5-5`) |
| `GAVIL_MOCK` | dev only | — | `1` = the in-memory mock API (`lib/api/mock.ts`), `/auth/mock`, every dev secret. **Only with `NODE_ENV` development or test**; any other environment refuses to boot with it (`instrumentation.ts`, and `getApi()` on every request) |
| `GAVIL_MOCK_DEMO` | dev only | — | `1` = the demo sign-in shortcuts on top of mock mode: every email code is `123456`, `/auth/magic?token=demo-<judgeId>` works once. Never on by default; refuses to boot outside development/test |
| `GAVIL_MOCK_TALK` | dev only | — | `1` = the mock event starts with Table talk and Claude highlights switched on |
| `GAVIL_MOCK_SECRET` | dev only | — | Overrides the dev secret mock session tokens are signed with |
| `GAVIL_DESIGN_SYSTEM` | build only | — | Where `npm run sync` reads the design system (default `../design-system`); not read at runtime |

Request logs: the first request of a sign-in link (`/auth/magic?token=…`) or a placard scan (`/t/A12?k=…`) still carries its token in the URL; Gav-IL moves it out at once and never logs a URL, so configure Workers Logs / Logpush to drop query strings.

| Script | What it does |
|---|---|
| `npm run dev` | Syncs the design system (`predev`), then starts `next dev --turbopack` |
| `npm run build` | Syncs, then runs `next build` (lint and types included) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Runs vitest: `lib/__tests__` covers Crowd-BT, queue rules, visits, presence, Table talk, the permission matrix and sessions |
| `npm run lint` | ESLint with `next/core-web-vitals` and `next/typescript` (admin-site config) |
| `npm run sync` | Rebuilds `app/styles/tokens.css` and `gavil.css` from `../design-system` |
| `npm run build:worker` | Syncs, then builds the Cloudflare Worker with OpenNext (`.open-next/`). Passes `--dangerouslyUseUnsupportedNextVersion` (see Deploy) |
| `npm run preview` | `build:worker`, then runs the Worker locally with wrangler (http://localhost:8787) |
| `npm run deploy` | `build:worker`, then deploys to Cloudflare (`wrangler.jsonc`, worker `gavil`) |

Prettier settings match admin-site: 4 spaces, no semicolons, double quotes.

## Deploy

Gav-IL is one Cloudflare Worker, `gavil`, built with OpenNext (`wrangler.jsonc`). Do these in order.

1. **Log in.** `npx wrangler login`, with an account that may deploy `gavil` (the HackIllinois Cloudflare account). Check out the repo with `design-system/` beside `web/`: `build:worker` runs `npm run sync` first.
2. **Mock mode never ships.** OpenNext bakes every `.env*` file it finds at build time into the Worker (`.open-next/cloudflare/next-env.mjs`), so a `.env.local` made with `cp .env.example .env.local` (it has `GAVIL_MOCK=1`) would put mock mode into the deployment, and the Worker refuses to start with it on purpose (`instrumentation.ts`): every request, `/api/health` too, answers 500. `npm run build:worker` therefore sets `GAVIL_MOCK`, `GAVIL_MOCK_DEMO` and `GAVIL_MOCK_TALK` to `0` for the build, which beats the file. Still, deploy from a checkout without a `.env.local` when you can.
3. **Vars** are in `wrangler.jsonc` and are not secret: `ADONIX_URL` (adonix) and `GAVIL_ORIGIN` (our public origin, `https://judging.hackillinois.org`). A staging deploy changes them there. The Gav-IL host must also be in adonix's `ALLOWED_WEB_HOSTS`.
4. **Secrets**, once per deploy target, each with `npx wrangler secret put <NAME>` (it asks for the value; `npx wrangler secret list` shows what is set):

   | Secret | Needed | Value |
   |---|---|---|
   | `GAVIL_GRANT_SECRET` | always | 32+ random characters, Gav-IL only: `openssl rand -base64 32` |
   | `GAVIL_JWT_SECRET` | recommended | adonix's `JWT_SECRET`, copied, not generated |
   | `GAVIL_TALK_SECRET` | Table talk | 32+ characters, the same value adonix has |
   | `CF_ACCOUNT_ID`, `CF_API_TOKEN` | Table talk | Workers AI speech to text |
   | `ANTHROPIC_API_KEY` | optional | Claude highlights; the rule extractor runs without it |

   Never `GAVIL_MOCK` or `GAVIL_MOCK_DEMO`: the Worker refuses to boot with either.
5. **Preview** before deploying: `npm run preview` builds and serves the Worker at http://localhost:8787 with wrangler. Wrangler reads secrets and var overrides from `web/.dev.vars` (gitignored), so for a judge session put `GAVIL_ORIGIN=http://localhost:8787`, `GAVIL_GRANT_SECRET=…` and `GAVIL_JWT_SECRET=…` there; without a `GAVIL_ORIGIN` of its own a preview uses the production origin for the staff Google sign-in callback and for the `Origin` it sends to adonix.
6. **Deploy.** `npm run deploy` (build, upload, switch traffic). The first time, attach `judging.hackillinois.org` to the Worker: Cloudflare dashboard → Workers & Pages → `gavil` → Settings → Domains & Routes. `npx wrangler rollback` returns to the previous version.
7. **Check it.** `curl -s https://judging.hackillinois.org/api/health` answers `{"ok":true}` (`GET /api/health`: no session, never calls adonix, never cached). A `503 {"ok":false,"problem":"config"}` means the deploy has no usable `GAVIL_ORIGIN`: look at the vars above. (Mock mode is a different failure: the Worker refuses to boot with it, so every URL, `/api/health` included, answers a plain 500 and no 503 JSON; see step 2.) Then `curl -sI https://judging.hackillinois.org/login` and read the headers below.
8. **Logs.** A sign-in link (`/auth/magic?token=…`, valid 15 minutes) and a placard scan (`/t/A12?k=…`) carry a token in the first request's URL, so Workers Logs must never hold a query string. `wrangler.jsonc` does two things about it. `observability.redact_query_string: true` is Cloudflare's own setting (wrangler's config schema: "whether query strings are removed from request URLs in logs and traces"), so the query string is stripped from the request URL on every log and trace record, exceptions and spans included. `observability.logs.invocation_logs: false` also turns the automatic per-request invocation log off, so a token does not depend on the redaction alone: with that log off, no request line, and so no query string, reaches Workers Logs. What the app prints (console output, uncaught errors) is still kept. Gav-IL's own code never logs a URL (the only `console.warn` calls are in `lib/talk/`, and print an error class or status, never a URL or content). **The cost:** the dashboard no longer lists one line per request with its status and duration; the Workers Metrics tab still counts requests, errors and CPU time. To see request lines during an incident, set `invocation_logs` to `true`, `npm run deploy`, and set it back afterwards; `redact_query_string` stays `true` either way, so the lines carry the path only. **Check it once, after the first real deploy:** open `https://judging.hackillinois.org/auth/magic?token=check` (or `/t/A12?k=check`), then find that request in the Workers Logs of `gavil` and confirm the record shows no `?token=` or `?k=`. Wrangler's local store (`npm run preview`, `wrangler dev`) does not apply the redaction, so a local run proves nothing about it. `npx wrangler tail` prints request URLs live and stores nothing: use it knowingly, not on a projector.

**Why `--dangerouslyUseUnsupportedNextVersion`.** OpenNext refuses Next.js 15.5.27 as unsupported unless it is passed; the build is verified with it. `npm run build:worker` (and so `preview` and `deploy`) passes it, and it stays until the Next.js 16 upgrade, which is a later stage.

**Security headers** are on every response, in four places that share one source, `lib/security/headers.ts` (pure functions, unit-tested). A path is covered by exactly one of the first two (a header both set would be appended by OpenNext, and `same-origin, same-origin` is not a valid COOP); `lib/__tests__/prod-headers.test.ts` checks that they are disjoint:

| Where | What it covers |
|---|---|
| `middleware.ts` | every page, route handler, redirect and 404, dotted paths included (`/robots.txt`, `/t/A12.png`, `/judge.json`): the headers, the per-request-nonce `Content-Security-Policy` (also sent to Next.js as a request header, which is how it puts the nonce on its scripts) and the path's `Referrer-Policy` (`no-referrer` on `/login`, `/auth/*` and `/t/*`). The route gate runs unchanged inside it. Not matched: `/_next/static/*` and `/_next/image` |
| `next.config.ts` `headers()` | exactly what the middleware does not match: `/_next/static/*` and `/_next/image`, for a plain `next start` |
| `public/_headers` | what Cloudflare serves from its asset store before any code runs (`public/`, `/_next/static/*`); generated by `cloudflareHeadersFile()` (`npm run headers:file` rewrites it; Node 22.6 or newer), and a test fails when it drifts. **Part of the deploy: `web/public/_headers` must be committed** |
| `lib/security/worker.mjs` (`wrangler.jsonc` `main`) | OpenNext's handler, wrapped. Some answers come from the framework layers before any app code runs (Next's trailing-slash 308 for `/judge/`, `/_next/image`, a 404 under `/_next/data/`). Anything still missing the six headers gets them here (`lib/security/edge-headers.ts`: add only what is absent, never double), and the `x-middleware-*` hand-off headers OpenNext leaves on a redirect are dropped (`x-middleware-set-cookie` repeated the `gavil_magic` cookie where a script can read it). It needs `.open-next/worker.js`, so build with `npm run build:worker` first |

A `<Link>` to a route handler that redirects (the staff "Sign in with Google" button goes to `/auth/google`, which answers 303 to adonix) is prefetched by Next.js as a script `fetch()`, and `connect-src 'self'` refuses the cross-origin hop. The middleware therefore answers a scripted GET of any `/auth/*` handler with an empty 204 (`lib/security/hard-navigation.ts`), which Next.js turns into a normal browser navigation: no CSP violation, no prefetch that signs anyone in or out, and `/auth/magic` (a real page) is left alone. Next.js strips its own `RSC` and `_rsc` markers before middleware runs, so the test is the browser's `Sec-Fetch-Dest: empty` (a navigation sends `document`) and the router's `Next-Url`. A plain `<a>` for that button is still the cleaner markup (UI stage).

The values: HSTS two years with subdomains (never under `next dev`), `nosniff`, `X-Frame-Options: DENY`, COOP `same-origin`, and `Permissions-Policy: camera=(self), microphone=(self), geolocation=(), payment=(), usb=()`: the camera is the in-app placard scanner and the microphone is Table talk, so never deny either. The CSP allows only this origin's scripts (plus the nonce and `strict-dynamic`), styles, images, fonts and `connect-src`, and names adonix in `form-action` (staff Google sign-in leaves through it). Under `next dev` it also allows `unsafe-eval` and `ws:` for hot reload. `next dev --turbopack` (`npm run dev`) additionally drops `strict-dynamic`, because Turbopack inserts some route chunks without the nonce and same-origin scripts must count there; `npx next dev` (webpack) and every production build keep it. `ADONIX_URL` must be an `http(s)` URL with a plain host (letters, digits, dots, hyphens, or a bracketed IPv6): anything else leaves adonix out of `form-action` (staff Google sign-in is then refused by the browser) instead of letting the value change the policy. A new third-party origin means editing `contentSecurityPolicy` and its test; do not loosen `script-src`.

**For the UI stage, before the placard scanner and Table talk ship.** Both are allowed by the policy as it stands (`camera=(self)` and `microphone=(self)` in the Permissions-Policy; `blob:` for `media-src`, `worker-src` and `img-src`; recordings upload to this origin, so `connect-src 'self'` covers them). One thing is not: a WebAssembly QR decoder (a ZXing build, the fallback for iOS Safari, which has no `BarcodeDetector`) cannot compile under this `script-src`, and a CDN-hosted `.wasm` file cannot load under `connect-src 'self'`. Self-host the decoder, add `'wasm-unsafe-eval'` to `script-src` in `contentSecurityPolicy` (it allows WebAssembly only, not `eval()`) and extend `lib/__tests__/prod-headers.test.ts`; the typed table-code fallback needs none of it. Recording uploads go through the middleware like every other request, so `next.config.ts` caps what Next.js buffers for a route behind it at 6 MB (`middlewareClientMaxBodySize`, just above the route's `MAX_AUDIO_BYTES` + 64 KB; a test keeps them in step).

**Installed app.** `app/manifest.ts` ("Gav-IL judging", opens `/judge`, standalone) takes its colours from `lib/security/install.ts`: the sunset `ground` and `surface` tokens, which `lib/__tests__/prod-manifest.test.ts` checks against `../design-system/tokens.json`. `public/icons/h-mark.svg` is `design-system/assets/brand/h-mark.svg` unchanged; `icon-192.png`, `icon-512.png` and `apple-touch-icon.png` are that mark centred on the `ground` colour (a white mark on a transparent icon vanishes on a light launcher), exported once from the SVG, never redrawn.

**When the page itself breaks.** `app/global-error.tsx` is the last resort (root layout threw): its own `<html>`, a poster-paper card, Try again (reloads) and a link to `/login`, no error text. `app/error.tsx` (which catches the `/judge` and `/admin` layouts, where adonix is called first), `app/judge/error.tsx` and `app/admin/error.tsx` never show an error's message or stack and refresh the route before retrying (`lib/security/retry.ts`). A refresh the network cannot answer would make Next.js navigate the document itself, and the browser's own offline page would replace the app, so: while `navigator.onLine` is false the copy says "You're offline" and Try again is disabled (the `online` event enables it), and on Wi-Fi that is joined but has no uplink (it still reads online) Try again first asks `/api/health` (no session, never adonix) and refreshes only when something answered; no answer shows the offline copy and leaves the button for the next try.

## Folder map

```
web/
  middleware.ts              Route gate on a VERIFIED token: /judge/* needs JUDGE, /admin/* STAFF|ADMIN;
                             moves /auth/magic?token= into a cookie; security headers + nonce'd CSP on
                             everything else (lib/security/headers.ts)
  app/
    layout.tsx               Fonts (next/font: Ultra, Oswald, Manrope, Rye), theme, global CSS
    styles/
      tokens.css             GENERATED from design-system/tokens.json
      gavil.css              GENERATED from design-system/components/bundle.css
      app.css                Font wiring, base document, two web-only rules (tokens only, nothing gavil.css has)
    login/                   Judge email code + magic link, staff Google button, mock sign-in
    auth/google/route.ts     Staff Google sign-in: one-time OAuth state, then adonix
    auth/callback/route.ts   Google return: state checked, token verified -> gavil_session
    auth/magic/              One-tap judge link / desk QR: confirm page + redeem (JWT verified)
    auth/mock/route.ts       Dev-only mock session (GAVIL_MOCK=1 under next dev)
    auth/logout/route.ts     Clears the session (and the adonix cookie)
    t/[code]/route.ts        Placard QR (/t/A12?k=…): swaps k for a 120 s scan grant, then the evaluate screen
  instrumentation.ts         Boot check: no mock mode or demo shortcuts outside next dev / vitest
    api/talk/recordings/     POST: audio (webm/mp4, ≤ 5 MB) -> transcript; the audio is dropped
    api/talk/highlights/     POST: transcript -> suggestions (rules always, Claude when allowed); never stored
    judge/                   Check-in, countdown, evaluate, compare, notes, done, round2/[prize]
      actions.ts             Server actions (submit, skip, vote, undo, Round 2)
    admin/                   Overview, flagged, judges, assignments, deliberations, prizes,
                             admissions (+ [id]), reimbursements, settings
      actions.ts             Server actions, each re-checking the permission matrix
  components/                TSX ports of design-system/components/bundle.js (same gv-* classes, ARIA)
  lib/
    api/types.ts             Domain types (Path, Track, Prize, Judge, Project, Evaluation, Vote...)
    api/client.ts            Typed adonix client + the GavilApi interface
    api/fixtures.ts          The canonical dataset (rooms A–D, 31 projects with placard codes, 8 judges)
    api/mock.ts              In-memory GavilApi over the fixtures, validating every write like adonix
    api/server.ts            getApi() / getSession(): mock or adonix, per request
    api/CONTRACT.md          Every endpoint the app expects from adonix
    auth/session.ts          JWT decode, role routing, cookie options, mock tokens (edge-safe)
    auth/verify.ts           Token verification (signature or adonix round trip), cached per request
    auth/grant.ts            Placard scan grants (signed, single use) and the signed-out pending scan
    env.ts                   mockEnabled() / mockDemoEnabled() / the boot assertion
    gavel.ts                 Crowd-BT (port of reference/figma-mock gavel.ts, pure + seedable)
    queue.ts                 Next-project rules (room, path, coverage floor, conflicts, flags, wait vs done)
    judging.ts               Table codes, arrival check + directions, placards, seed validator, conflicts,
                             prize eligibility, absent reports, write times
    floor.ts                 Team presence per room, judge live state, fast-judging signals
    talk/                    Table talk. Server: extract.ts (rule extractor), validate.ts (drops, never repairs),
                             llm.ts (Claude, structured output), transcribe.ts (Workers AI Whisper),
                             service.ts (what the route handlers run), receipt.ts (signed transcripts),
                             fixtures.ts (4 transcripts + a memo). Phone: session.ts (the state machine),
                             registry.ts (sessions per judge and table; stopLive, applyTalkPolicy),
                             engine-mic.ts / engine-fixture.ts (MediaRecorder, or a fixture), client.ts, copy.ts
    outbox.ts                Per-judge offline outbox rules (classify, backoff, dead letters)
    permissions.ts           The staff/admin matrix used by tabs, rows and buttons
    offline.ts               The outbox on localStorage + online hook for flaky Wi-Fi
    __tests__/               vitest
  public/brand/              The 2027 Figma art, copied by the sync (never redrawn)
  scripts/sync-design-system.mjs
```

## How auth works

The session is the adonix JWT itself. It is stored in the httpOnly cookie `gavil_session` and is only ever read on the server. Pages and server actions call adonix with `Authorization: <jwt>`.

- **Staff and admins:** "Sign in with Google" links to `/auth/google?next=…`, which mints a one-time `state` nonce (httpOnly cookie) and sends the browser to `{ADONIX}/auth/login/google/?redirect={origin}/auth/callback?next=…&state=…`.
  adonix runs Google OAuth (`@hackillinois.org`), then redirects back.
  `/auth/callback` reads the token from `?token=` or from adonix's `jwt` cookie (in production that cookie is scoped to the registrable domain, so `*.hackillinois.org` receives it) and sets `gavil_session`.
  The Gav-IL host must be in adonix `ALLOWED_WEB_HOSTS`.
- **Judges:** there is no password. Judge sign-in is modelled on adonix's sponsor flow, and the design doc covers it in §7.
  `/login` ("Howdy, judge.") takes an email and calls `POST /auth/judge/verify/` with `{email}` in the body, which always reports success. The email contains a one-tap link and a 6-digit code.
  - The **code** goes to `POST /auth/judge/login/`. Each code allows 5 tries; the form shows "N tries left", then "Send a new code".
  - The **link** (or the desk QR) is redeemed in two steps. `/auth/magic?token=` only looks the link up (`POST /auth/judge/link/`) and asks "Sign in to judge as <email>?". **Continue** POSTs the token to `/auth/magic/redeem`, which calls `POST /auth/judge/redeem/`. Nothing is redeemed on a GET.
  - Used or expired links show "Link expired."
  - Auth pages send `Referrer-Policy: no-referrer`.
- **Judge tokens** carry `role: JUDGE`, `eventId` and `assignmentId`. adonix checks `JudgeAssignment.revokedAt` on every call. A 401 inside a judge server action that carries nothing to lose (the check-in button, the help request) signs the phone out in the action itself (cookie cleared, `/login?error=revoked`). A 401 inside a **write** (evaluation, skip, vote, ranking, draft, "can't find it", check-in) or a poll that fires while the judge types is answered as data (`SessionEnded` / `Revoked`) and touches no cookie: the screen keeps the write on the phone first, then leaves through `GET /auth/logout`; if the phone can't keep it, the screen stays and offers "Sign in again" (CONTRACT §3, CFX 2).
- **Every token is verified before it becomes a session, and on every request after:** the Google callback (with its one-time `state`), the code login and the link redeem (`verifyJudgeToken`: also a JUDGE token with its event and assignment) verify the JWT before setting `gavil_session`; middleware and `getSession()` verify it again per request (`verifySessionCached`: the HS256 signature with `GAVIL_JWT_SECRET`, else an adonix `GET /auth/roles/` round trip; `exp` required and capped; one verdict per token per minute). A cookie that only decodes opens no shell and reaches no server action.
- **Tokens leave the URL on arrival:** `/auth/magic?token=` moves the token into an httpOnly cookie and redirects to `/auth/magic`; `/t/A12?k=` swaps `k` for a scan grant (below); `/login?next=` never carries either.
- **Mock mode** (`GAVIL_MOCK=1` under `next dev` or vitest only): `/auth/mock?role=judge|staff|admin` sets a token HS256-signed with the dev secret. adonix would reject that token.

The endpoints `/auth/judge/*`, `Role.JUDGE` and `/judging/*` do not exist in adonix yet. `lib/api/CONTRACT.md` specifies them, including the Origin check on writes, idempotent `clientId` writes and Visit leases.

## How the design-system sync works

`../design-system` is the source of truth. `scripts/sync-design-system.mjs` runs before every `dev` and `build` and does three things:

1. It compiles `tokens.json` to `app/styles/tokens.css`.
   This is a line-for-line port of `compile_tokens()` in `design-system/scripts/build_previews.py`: `:root, [data-theme="sunset"]` holds the default theme, `[data-theme="night"]` holds the overrides, and a trailing `:root{}` holds spacing, radius, size, motion (with its reduced values under `prefers-reduced-motion` and `[data-motion="reduce"]`), asset, font and `--type-*` / `--tracking-*` tokens.
   The output is identical to `.preview/tokens.css`.
2. It copies `components/bundle.css` to `app/styles/gavil.css` and drops its Google Fonts `@import`, because `next/font` self-hosts the fonts.
   `app/styles/app.css` points the `--font-*` tokens at the `next/font` variables.
3. It copies the 2027 brand art the `--art-*` tokens name (`assets/brand/…`, originals and `derived/` WebP) to `public/brand/` and points the tokens' urls there. The art is never redrawn or recoloured; a test checks that every `--art-*` url resolves.

All outputs are committed, so a checkout without `../design-system` (CI, or a standalone GavIL repo) still builds; the script then warns and keeps the committed files. You can point it elsewhere with `GAVIL_DESIGN_SYSTEM=path`. Run `npm run sync` again whenever the design system changes (`predev` and `prebuild` do), then port what `bundle.js` changed.

The components in `components/` are hand ports of `bundle.js`. When `bundle.js` changes, port the change: keep the class names, ARIA and copy identical. Three differences from the design system are deliberate, each in a test: the skip sheet says what the picked reason does and keeps a reason that needs the table checked first in the list, disabled, with why (`cweb-skip-copy`, the design system's sheet hides such a reason); a policy lock that stops a *memo* also names where the judge sits (`TalkLock "seat"`, no counterpart in the static previews); and the Round 2 board's "Demo" link defaults to the nominee's Devpost page (`cweb-round2-demo`).

Theme: `<html data-theme>` comes from the `gavil_theme` cookie (`sunset` by default, or `night`).

## What is mocked

With `GAVIL_MOCK=1`, `getApi()` returns `createMockApi()` (`lib/api/mock.ts`) instead of the adonix client. It holds in-memory state that lasts as long as the dev server process:

- The canonical dataset in `lib/api/fixtures.ts`, shared by name and table code with the JudgePrototype:
  - 4 rooms: A = 4217 (Pro), B = 4218 (Pro), C = 4219 (General), D = 1404 (General). Placards carry room-qualified codes (`A12`) and a QR of `https://judging.hackillinois.org/t/A12`.
  - 31 projects (p28 "Typo" at D56 is an invalid row the seed validator rejects).
  - 8 judges: j1 Sarah Kim (Stripe, Pro, 4217) is the demo judge, checked in, and her Round 1 queue is the prototype's four tables (A12, A17, A20, A22: Tidal and Mirror have a member at stripe.com, LedgerLite is in the Stripe track); j3 and j5 are not checked in.
  - 11 prizes: HackIllinois, company (Stripe, Modal, Caterpillar; opt-in), MLH (opt-in), and Pro/General overall (Round 2 only).
  - 7 flags. SoundScape, HealthBridge and SixPack are held; Replay is escalated; Lumen and Quill have review-only flags and are still judged.
- 8 applicants, 3 reimbursements and 3 staff.
- Round 1 started 45 minutes before the server booted and lasts 2 hours.

The mock runs the real `lib/queue.ts`, `lib/judging.ts` and `lib/gavel.ts` and validates every write the way `lib/api/CONTRACT.md` says adonix must, so the judge flow behaves as specified:
- Visits have two phases. En route: 4 minutes to reach the table ("Can't find it?" at 3), never extended; if it runs out the table goes back to the queue with no penalty. At the table (the placard code matched): 10 minutes, renewed on the evaluate screen. Nothing is leased before check-in or the start, and an owed comparison always comes first (even before a live lease). A judge back from a locked phone gets the table they checked in at, also after time-up inside the grace window.
- Right table: notes, Submit and an absent report open only after the judge scans the placard or types its code and the 2-character check printed after the dot ("A12 · K7"; checks use `ACDEFHJKMNPRTUVWXY23479`, a typed Z reads as 2, and a typed O/0/I/1/L gets a hint instead of a miss); a wrong code names the project at that code with directions, an unknown code says so. 5 wrong checks for one table lock typing it for that judge, across visits (scan or the team's name still work). No placard = confirm by team name: allowed, recorded and staff tasked, and that evaluation's **nominations are held** until the placard is scanned at that visit (within 10 min of Submit) or staff press "Placard OK" on the task; the notes count either way.
- Scanning `/t/A12?k=…`: the route checks `k` and swaps it for a 120-second, single-use, httpOnly scan grant bound to the judge and the table, then opens `/judge/evaluate?at=A12&via=scan`; the screen runs the check with one POST and the arrive action adds `k` from the grant. When the phone is on the compare, wait or done screen the scan goes there (code only) and is sent once to the code-only check. A scan whose POST gets no answer is never queued (its `k` lives only in the 120 s grant): the judge types the check instead. The placard of the judge's last, name-only table, scanned within 10 min of its Submit from whatever screen the phone shows, releases that table's held nominations (`409 EarlierTable`, no wrong code at the current table). Signed out, the scan waits in a cookie through sign-in (`/login?next=/t/A12`, no token). In mock mode `mockPlacard("A12").qr` is the printed QR URL (admins: `GET /judging/admin/placards/`).
- Team presence: a team member checks in at the table with the attendee app (or staff do); the queue prefers present teams among equals; Overview shows presence per room and every judge's state (en route, at table, composing a compare, waiting, idle, done).
- Coverage comes first, then Crowd-BT against the previous project. "Wait" (every remaining table is with another judge, cooling after an absent report, or just deferred) is never "Round 1 complete", and the wait screen says which.
- "Can't find" and "team busy" defer the visit; the table comes back first after one other table and never straight back (with nothing else free the judge waits 3 minutes). "Absent" cools the table down for 10 minutes; two reports auto-hold it and task staff.
- Evaluations must be the judge's own checked-in visit, made after arriving; votes must be the judge's current pair, once, made after both evaluations. Saved writes carry `sentAt` so a phone clock that runs fast or slow doesn't matter.
- Replaying a write with the same `clientId` is a no-op (and the same id with other content is refused); the outbox is per judge, and a sign-out, revocation or expiry clears only that judge's data from the phone.
- Notes and nominations are kept on the phone at every edit and restored after a reload or a quick trip to My notes; a compare screen brought back by Back never offers a pair already voted on.
- Codes allow 5 tries, unknown emails never sign in, and links work once.
- Room moves release the old table; revoking a judge (optionally voiding votes) signs the phone out and clears it on its next call.
- Admin: the Overview task list (Mark present for staff and admins; Confirm absent, Done and "Placard OK" for admins, per the permission matrix), the Judges tab's review signals (fast visits, fast votes, team-name check-ins, implausible placard proofs: two rooms under 60 s apart with no staff room move between them, or no time to walk, measured from the first lease of a walk that ran out and was leased again), the absent task's "Team checked in with the app at 8:42 PM", held nominations on the Prizes tab; Settings (admins) holds the Freeze sign-ins switch (a desk QR still works), the Table talk switch with its vendor-retention acknowledgment, AI summaries, the Claude and transcription caps and the teams that opted out of recording; the Judges tab voids a judge's votes with a reason after an inline confirm (audited; rankings replay); the Placards page prints every table's placard (one per page, the check printed after the dot). Every admin endpoint checks the role: STAFF reads, ADMIN writes; admissions edits are per row (the reviewer is the caller's email on the staff roster) and audited by field name.
- Table talk is off until an admin switches it on (Settings, or `PUT /judging/admin/settings/`). To try it in mock mode, start the dev server with `GAVIL_MOCK_TALK=1`: the event begins with Table talk and Claude highlights on. Then a judge may record a table after the team says yes, or dictate a memo (`POST /api/talk/recordings`); the mock transcribes from fixtures (EcoLens, NeuralMesh, PocketLab, Atlas); highlights (`POST /api/talk/highlights`) come from the rule extractor, and from Claude when `ANTHROPIC_API_KEY` is set. An evaluation keeps only highlights the judge kept.
- **A memo is never taken at a table, and one judge has one microphone.** The server refuses a memo while the judge sits at any table (`409 StillAtTable`), and says where they sit in `JudgeMe.talk.seatedAt` (the mock computes it from the same "still seated" rule). On the phone: "I'm at the table" (and every other way the walk ends: a check-in sent or saved, a scan that landed) stops a memo that is still running and keeps what was said (a toast says so; its card is on the next walk, wait, done or My notes screen for 15 minutes); a table recording that starts finishes a running memo first (`beforeRecord`); My notes shows the memo card locked ("You're at C16 now. Dictate memos between tables, not at one.") while the judge sits at a table, by the server's word or by a check-in the phone has saved; and the 6 s policy poll stops a memo that is somehow still running when the server says they sit down, keeping nothing. The app bar's red Recording tag always has a recorder to go to.
- **Consent time on the server's clock.** The upload carries `sentAt` (the phone's clock as the request leaves) and the Gav-IL route moves `consentAt` by `now - sentAt` before the visit check, so a phone a few minutes fast or slow still consents inside the visit (`cweb-consent-clock`). A yes that really was outside the visit is still `409 ConsentOutOfRange`.
- **Round 2 Demo links.** Every nominee carries its project's `devpostUrl`; the board's "Demo" link opens it in a new tab (http(s) only, `webUrl`).

`lib/__tests__/` checks these rules: `findings.test.ts` (one scenario per audit finding), `verifier.test.ts` (one per finding of the review that followed), `simulation.test.ts` (all 8 judges at once, seeded), `visits.test.ts`, `floor.test.ts`, the `talk-*.test.ts` files (W2), `integrity.test.ts` / `auth.test.ts` / `roles.test.ts` (H-integ) and `hf-integ.test.ts` / `hf-auth.test.ts` / `qr-route.test.ts` (the round 3 fixes, including a placard scan end to end). The `cfx-*.test.ts` files are the external review fixes after W3 (`cfx-outbox` dead letters, transcript sweep, legacy scan tokens and two tabs; `cfx-session` an expired session never takes a write the phone couldn't keep (write actions answer 401 as data, the gate lets a judge's action through, the screen leaves only once the write is kept); `cfx-auth` verified clear markers, `ADONIX_URL` at runtime, `sameOrigin`, `Secure` cookies and sign-out's `jwt` cookie; `cfx-origin` the Origin that really leaves; `cfx-round2` the frozen finalists, `cfx-freeze` every API call freezes them first (a table check-in included), `cfx-withdrawn` a finalist pulled after the opening ranks last and is shown as pulled; `cfx-locks` every queue, dead-letter and notice change holds the judge's Web Lock (a two-tab model with stale reads); `cfx-residual` quotes and legacy tokens in storage; `cfx-spend` attempt ids and the settle that makes a slot buy one vendor call; `cfx-idempotency` the retention contract; `cfx-carried` the weak-attestation record; `cfx-offline`). `cweb-memo-walk` (+ `-dom`) is "a memo never runs at a table": `stopLive`, one microphone, the seat lock, `seatedAt` and the screens that wire them; `cweb-consent-clock`, `cweb-round2-demo` and `cweb-skip-copy` are the other three verifier findings of the last round. `cweb-talk-policy.test.ts` is the privacy kill switch (an admin's Table talk switch or a team's opt-out stops a running recording on any screen, with or without a card: `JudgeMe.talk.optedOut`, `pollTalk`, `applyTalkPolicy`, `TalkPolicyWatch`), `cweb-appcss.test.ts` keeps `app/styles/app.css` to tokens only and to rules the design system does not already have. With `GAVIL_MOCK_DEMO=1` the judge code is `123456` and `/auth/magic?token=demo-j1` works once per server run; `mockPlacard("A12").qr` opens Sarah's check-in at NeuralMesh.

Built on the data layer, all of it with the mock: the phone's in-app scanner and en-route nudge; Table talk (consent sheet, recorder, highlights, memos, the late recording); QR rendering (`lib/qr.ts`, `QR.tsx`) and the placard print page; the admin floor view (presence, judge states), the Settings switches, team opt-out and void votes; the painted 2027 art (`public/brand/`).

Not built yet:

- The adonix endpoints themselves (`lib/api/CONTRACT.md` lists every one, including this round's additions: `JudgeMe.talk.seatedAt`, `Round2Nominee.devpostUrl` and `sentAt` on the recording form).
- Real email delivery: adonix sends the judge's link and code; this app only calls it.
- A live challenge for the placard QR: a photo or a forwarded link can still prove presence. The app records a scan that arrived through a signed-out link (`carried`) for staff and blocks nothing; a rotating code the team or staff show needs the attendee app and adonix.
- Service-worker offline caching and the IndexedDB outbox. `lib/offline.ts` is a localStorage outbox: every write carries a `clientId`, votes join it only after the undo window, and it is replayed in order. The next table still needs a connection.
