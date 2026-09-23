---
id: W-082
title: Proof-of-work gate on verification and listing
phase: Phase 16 - Public launch
status: IN PROGRESS
depends_on: W-014
---

# W-082 - Proof-of-work gate on verification and listing

**Phase:** Phase 16 - Public launch  
**Depends on:** W-014  
**Status:** IN PROGRESS

## Scope

Owner decision of September 23, 2026: mailbox verification stays on, and the requests anyone can send without an account (a mailbox code, a juror token batch, a new employer listing) need an in-browser proof of work, so automated floods cost compute.

## Acceptance criteria

- [ ] shared/pow.ts is hashcash over SHA-256: the stamp's prefix binds the requesting origin, the action, the issuer key id (empty for a listing), a digest of what the request concerns (the normalized email address for /start, the exact blinded messages for /issue-juror, the domain for /api/employers) and the UTC minute; a server accepts a stamp within 2 minutes of its own clock, checks it with one hash, and refuses a stamp made for any other request.
- [ ] The verifier requires a stamp on /start and /issue-juror, and the main worker on POST /api/employers, before reading a key, sending an email or looking anything up; no spent-stamp table is kept and nothing about the person is stored.
- [ ] The browser computes the stamp in a Web Worker served from the site's own origin (/pow-worker.js, allowed by the CSP), refuses a difficulty above 24 bits before starting, and can be stopped with nothing sent.
- [ ] The default difficulty is 20 bits (POW_BITS), tuned so a laptop takes about 0.5 to 1.5 s; the measured solve time is recorded with the constant, and the time the page states matches it.

## Implementation paths

- `shared/pow.ts`
- `web/pow-client.ts`
- `worker/issuer.ts`
- `worker/src/community.ts`
- `worker/src/app.ts`
- `issuer.wrangler.jsonc`

## Required verification

- tests/pow.test.ts (SHA-256 search, binding to origin, action, key and subject, the time window, difficulty and clamping, malformed stamps, the self-contained Web Worker script, abort).
- tests/protocol.test.ts '/start and /issue-juror require a proof of work bound to this origin, route, key and request, checked before any key is read or email sent'; tests/community.test.ts 'a listing needs a proof of work bound to this origin, the listing action and the exact domain…'.
- tests/web.test.ts: 'a proof-of-work stamp computed without a worker verifies on the server’s check…', 'the proof of work refuses a difficulty far above the default before any work, and stops, sending nothing, when asked'.
- A recorded in-browser timing of the default difficulty on a laptop.

## Log

- [2026-09-23 05:11 UTC] Ticket created.
- [2026-09-23 05:14 UTC] Started. State read for this entry (group E, 05:00–05:15 UTC). Done and tested: shared/pow.ts (tests/pow.test.ts, all 9 tests passed in node --test "tests/*.test.ts" at 05:01–05:02 UTC); the verifier's check on /start and /issue-juror before any key is read or email sent (tests/protocol.test.ts '/start and /issue-juror require a proof of work bound to this origin, route, key and request…'); the main worker's check on POST /api/employers (tests/community.test.ts 'a listing needs a proof of work bound to this origin, the listing action and the exact domain…'); /pow-worker.js served from the site's origin with worker-src 'self' (tests/community.test.ts 'production configuration…'); the client's refusal above 24 bits and its Stop (tests/web.test.ts 'the proof of work refuses a difficulty far above the default before any work, and stops, sending nothing, when asked').
  Open: the tuning criterion. The only measurement recorded (the comment on POW_BITS in shared/pow.ts, 2026-09-23) was made with searchPow in Node on an Apple-silicon laptop: median 0.23–0.44 s, mean 0.4–0.5 s, 90th percentile about 1 s, longest 2.5–3.2 s. The median is below the 0.5–1.5 s the owner decision aims for, and no timing inside a browser Web Worker is recorded. web/pow-client.ts tells people the calculation is 'usually about a second'. The owner's choice: keep 20 bits and state the measured time, or raise POW_BITS to 21 or 22 on both workers and update the page's estimate with it.
- [2026-09-23 05:18 UTC] Final runs for this sync (group E): npx tsc --noEmit clean (05:16 UTC); node --test "tests/*.test.ts" at 05:16–05:18 UTC: 602 of 604 passed. One failure is transient and concerns this ticket: tests/protocol.test.ts '/start and /issue-juror require a proof of work bound to this origin, route, key and request…' accepted the 'another origin' stamp (200 instead of 400 pow_required) and passed on three reruns of that test. The test runs at 8 bits, so a stamp solved for a different binding also meets the target for the real one with probability about 1 in 256 per wrong stamp (6 wrong stamps a run, about 2%); at the production 20 bits the chance is about 1 in a million. The server check is correct; the test should re-solve any wrong stamp that happens to verify for the true binding (group B's file). The other failure is the add-employer wording test on W-083.
