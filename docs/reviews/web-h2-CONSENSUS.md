# web-h2 consensus (web/ after the server fix round; snapshot = code at the start of this run)
Reviewers that finished: opencode default free model (flint-40b) = "oc", nemotron-3-ultra (free) = "nem". Both: "VERDICT: fix first". codex/cursor/muse/agy had no quota; deepseek/glm/mimo free models were rate-limited mid-review. [n] = reviewers raising it. Free models are noisy: confirm each item against the code with a failing test before fixing; decline refuted ones with the reason. Raw: out/opencode.md, out/oc-opencode_nemotron-3-ultra-free.md.

## Table talk write path (highest)
1. [2] C5 not fixed: the judge client never sends the Table talk proof. lib/outbox.ts evaluation write has no talkProof; useJudgeOutbox replay omits it; EvaluateScreen submit() sends only {clientId, projectId, notes, nominations}. So recording/highlights/demoStatus are always dropped, online or queued. Fix: EvaluationInput built in full (talkProof, recording, highlights incl. explicit [], demoStatus) in submit() and carried through the outbox + replay; surface "dropped" results to the judge. Test end to end: record (fixture) -> receipt -> keep -> submit -> highlights stored; same via outbox replay.
2. [1 nem] Receipt single-use race: talkReceipts is marked used after the commit; two submits with the same receipt and different clientIds can both pass verifyTalkProof. Fix: mark inside the synchronous commit section (or atomically with the write); race test.

## Auth / origin / grant
3. [2] Scan-grant spent ledger is per isolate (lib/auth/grant.ts ~201-206): a copied grant cookie replays once more on another isolate within its TTL. Fix: derive the arrival clientId from the grant nonce (so adonix dedupes a replay) and document the residual in CONTRACT.md; adonix owns the durable single-use check (contract note).
4. [1 nem] publicOrigin() (lib/auth/cookie.ts ~67-76) may trust Host/x-forwarded-host; staff Google callback URL could be built from a spoofed host. Fix: with GAVIL_ORIGIN set, only ever use allow-list entries; boot assertion that GAVIL_ORIGIN is set when not in mock mode (env.ts). This overlaps the known item "a GAVIL_ORIGIN list breaks staff Google sign-in": fix both together with tests.
5. [1 nem] Grant cookie SameSite=Lax: check whether Strict is safe for the /t flow (QR opens a top-level navigation from the camera app, which is a cross-site navigation in some browsers -> Strict may break it). Decide with a test; decline with reason if Lax is required.
6. [1 nem] ArrivalInput.clientId (and other judge write inputs) optional in types.ts while CONTRACT says required; arriveAt accepts no clientId (no idempotency, wrong-code counting bypass). Fix: required in types + mock validation (400 without it).
7. [1 nem] earlierProof drops the incoming clientId (mock.ts ~2007), so re-scanning an earlier name-only table is not idempotent and can inflate proofFailures. Fix: pass a deterministic clientId through.
8. [1 oc] /auth/logout GET routes on an unverified JWT decode. Fix: use the verified session (or treat as signed out) - low.

## Error echo / privacy
9. [1 oc] S21 partial: scrubText/safeDetails applied only in talkHighlights and submitEvaluation; skip/vote/draft/defer/help error details (web/app/judge/actions.ts run()) can echo notes text. Fix: scrub in run() for every judge action; test.

## Smaller (verify first)
10. [1 nem] Signed-out /t scans set a pending cookie with no rate limit -> add a per-session/IP token bucket (generous; venue NAT).
11. [1 nem] seatedAt may return a table whose project is now leased to another judge after the first judge's lease lapsed -> memo for the wrong project. Check, fix with a test.
12. [1 nem] completeTask row denial returns {ok:false} rather than a 403-shaped error; make the UI show "Admins only" clearly (low).
13. [1 nem] web/.env.example: add generation hints (openssl rand -base64 32), "required in production" markers (GAVIL_ORIGIN, GAVIL_GRANT_SECRET, GAVIL_TALK_SECRET when Table talk is on), CF keys for Table talk.
14. [1 nem] Client items C1/C2/C3/C6/C7 from docs/PRIOR-REVIEW (k/check/clientId/queued on outbox arrival; judgeId on every write; queue on 408/429/5xx/network; WrongJudge mapping; dead-vote re-vote, defer offline path) - nem claims "not fixed", oc says client layers look hardened. Verify each with a test; fix what still breaks.
Refuted/noise (do not act): nem #5 RNG (randomToken uses Web Crypto - confirm only), #8 receipt age vs honoured time (correct per contract), #12 team email case (normalize on ingest is fine to add if trivial), #13 audit breaker reason, #17 "vacuous tests" (no specific test named), #19 nonce cleanup O(n).
