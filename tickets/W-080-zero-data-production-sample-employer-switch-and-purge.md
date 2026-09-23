---
id: W-080
title: Zero-data production: sample employer switch and purge
phase: Phase 16 - Public launch
status: IN PROGRESS
depends_on: W-005, W-067
---

# W-080 - Zero-data production: sample employer switch and purge

**Phase:** Phase 16 - Public launch  
**Depends on:** W-005, W-067  
**Status:** IN PROGRESS

## Scope

Owner decision of September 23, 2026: production holds no fictional sample employers, fixtures, practice content or test records. SAMPLE_EMPLOYERS on the main worker and on the verifier ('on' locally and in tests, 'off' in production) hides every kind='sample' employer and its sandbox keys, and tools/purge-samples.mjs removes the fictional data and the pre-launch test records from the production databases.

## Acceptance criteria

- [ ] While the main worker's SAMPLE_EMPLOYERS is not exactly 'on', no kind='sample' employer appears anywhere: the directory, search and Jev company options, discovery, /c/<slug> (404), Open Graph images, the FAQ, /api/config, server-rendered copy (including the jury-capacity lines on the moderation and transparency pages), and practice juries or challenges on fixtures.
- [ ] While the verifier's own SAMPLE_EMPLOYERS is not exactly 'on', /keys and /stats omit the fictional employers' sandbox keys, and /start, /issue and /issue-juror refuse them as unknown keys.
- [ ] Production sets both vars to 'off' (wrangler.jsonc, issuer.wrangler.jsonc); tools/prepare-local.mjs sets both to 'on' in the local env files, so local practice juries and the browser and integration suites keep working after a fresh prepare.
- [ ] tools/purge-samples.mjs is a dry run by default and --local runs the same plan on the local databases; a remote --apply needs --bookmark=<id>; it removes the fictional employers and everything recorded about them from the public, intake and verifier databases; --all-intake also clears the pre-launch intake test records but keeps work-mailbox-verified contributions unless --include-real-contributions is given; it never touches a real employer's row, the migration tables, the append-only public ledgers or the R2 archives.
- [ ] A release build ships no fictional employer's Open Graph image; the committed production registry (db/issuer-public-keys.json) holds no sandbox ('demo') key, so no release pins one; building or signing a release from a production registry that holds one is refused.
- [ ] verify-deployment reports FAIL when the site lists a fictional employer or either host serves a sandbox key.
- [ ] docs/operations.md describes the purge as the tool runs it (the verifier step, --all-intake keeping real contributions, --include-real-contributions).

## Implementation paths

- `worker/src/flags.ts`
- `worker/src/app.ts`
- `worker/src/pages.ts`
- `worker/issuer.ts`
- `wrangler.jsonc`
- `issuer.wrangler.jsonc`
- `tools/purge-samples.mjs`
- `tools/provision-issuer.mjs`
- `tools/prepare-local.mjs`
- `tools/build.mjs`
- `tools/transparency.mjs`
- `tools/verify-deployment.mjs`
- `db/issuer-public-keys.json`
- `docs/operations.md`

## Required verification

- tests/community.test.ts: 'fictional employers are hidden everywhere while SAMPLE_EMPLOYERS is not on…', 'production configuration: no fictional data, publication and juries on…', 'the sample purge removes every fictional employer and everything about them, and nothing else', 'a purge needs an explicit target, and a remote purge a restore point', 'the sample purge also removes the fictional employers' sandbox keys and their challenges from the verifier database, and nothing real', 'a release build leaves the fictional employers' Open Graph images out of the bundle; a local build keeps them'.
- tests/protocol.test.ts: 'the fictional employers' sandbox keys are listed and sign only while SAMPLE_EMPLOYERS is exactly on; production sets it off', 'provisioning leaves sample employers out when SAMPLE_EMPLOYERS is not on (or with --no-samples)…'; tests/web.test.ts 'with sample employers off, nothing fictional is listed or offered…'.
- Still to add: a verify-deployment test for a served sandbox key, a build or transparency test that refuses a production registry holding a sandbox key, a prepare-local test that both workers' local vars set SAMPLE_EMPLOYERS=on, and a pages test that jury capacity ignores fictional employers while the switch is off.

## Log

- [2026-09-23 05:11 UTC] Ticket created.
- [2026-09-23 05:14 UTC] Started. Code state read for this entry (group E, 05:00–05:15 UTC). Runs for this entry: npx tsc --noEmit clean (05:01 UTC); node --test "tests/*.test.ts" 602 of 604 passed (05:01–05:02 UTC; the two failures were tests/tickets.test.ts, on the stale citations this sync settles, and tests/web.test.ts 'adding an employer is checked on the device with the server’s domain rules…', see W-083).
  Done and tested: the main worker's switch (worker/src/flags.ts samplesEnabled and visibleCompanySql; tests/community.test.ts 'fictional employers are hidden everywhere while SAMPLE_EMPLOYERS is not on…'); the verifier's own switch (tests/protocol.test.ts 'the fictional employers' sandbox keys are listed and sign only while SAMPLE_EMPLOYERS is exactly on; production sets it off'); both vars are 'off' in wrangler.jsonc and issuer.wrangler.jsonc; tools/purge-samples.mjs with its dry run, the bookmark requirement, --all-intake keeping work-mailbox-verified contributions, --include-real-contributions and the verifier step (tests/community.test.ts 'the sample purge removes every fictional employer…', 'a purge needs an explicit target…', 'the sample purge also removes the fictional employers' sandbox keys…'); release builds without the fictional employers' Open Graph images.
  Open, each checked in the code for this entry:
  1. worker/src/pages.ts juryCapacity counts companies of kind 'sample' without checking the switch (the main group's requested edit).
  2. tools/prepare-local.mjs localVars writes SAMPLE_EMPLOYERS=on only into .dev.vars.main and rebuilds .dev.vars.verifier from its secrets alone. The local .dev.vars.verifier holds SAMPLE_EMPLOYERS=on today, but the next prepare-local run drops it, and the local verifier then hides the sandbox keys, which breaks local practice juries and the browser and integration suites (the verifier group's requested edit 3).
  3. The committed db/issuer-public-keys.json holds 48 keys, 12 of them sandbox ('demo') keys, so a release built from this checkout pins them; neither tools/build.mjs nor tools/transparency.mjs refuses such a registry. The registry is cleared by provision-issuer --remote with samples off, a remote step (W-079).
  4. tools/verify-deployment.mjs reports sandbox keys the verifier still serves as WARN ('sandbox keys retired'), not FAIL.
  5. docs/operations.md 'Removing sample data' still says the tool does not reach the verifier database and that --all-intake empties every intake table, and does not mention --include-real-contributions; docs/hardening-roadmap.md section 8 still lists verifier coverage of the purge as future work.
  The launch release is not deployed (the last deploy, 01:45–02:55 UTC, was the round-3 release; see W-021), so the switch and the purge reach production only through W-079. [read docs/operations.md sha256:98f2532f049c] [read docs/hardening-roadmap.md sha256:176123a1bbda]
- [2026-09-23 06:29 UTC] Final launch verification: re-read docs/operations.md and docs/hardening-roadmap.md for this entry. The five open items of the 05:14 entry, checked in the code: (1) worker/src/pages.ts juryCapacity now counts only non-community juror keys, and counts fictional employers only while samplesEnabled; (2) tools/prepare-local.mjs localVars writes SAMPLE_EMPLOYERS=on into .dev.vars.verifier (a run at 06:19 UTC kept it, and after the restart the local site and verifier both served 26 keys); (3) db/issuer-public-keys.json still holds 48 keys, 12 of them sandbox, and node tools/build.mjs now refuses a release build on them (06:26 UTC, nothing written); clearing them is still the remote provisioning step (W-079); (4) tools/verify-deployment.mjs sandboxKeysFinding reports FAIL when the site hides the fictional employers and either host serves a sandbox key; (5) operations.md 'Removing sample data' now describes the verifier step, --all-intake keeping work-mailbox contributions and --include-real-contributions, and hardening-roadmap.md section 8 no longer lists the purge's verifier step as future work. node tools/purge-samples.mjs --local (dry run, 06:25 UTC): 3 fictional employers, 14 accounts, 546 rows (public 152, intake 388, verifier 6 sandbox keys), no real employer row or migration table touched. [read docs/operations.md sha256:23803f99bfdc] [read docs/hardening-roadmap.md sha256:edf2eb228985]
- [2026-09-23 06:41 UTC] Re-read docs/operations.md after the launch deploy: the only change is the zone-check header grep in deploy step 8, which now accepts the workers' intentional 'nel: {"max_age":0}'. The earlier entry still holds. [read docs/operations.md sha256:b88f975dd416]
- [2026-09-23 17:37 UTC] Reviewed the open-source release edit to docs/operations.md: the prerequisites now require Node 24+ (26.5.0 pinned) and Bun 1.4.0 to match the dependencies. The remaining operational instructions and this ticket's recorded scope are unchanged. Clean-export build and typecheck passed; ticket reference checks are being refreshed for the updated document. [read docs/operations.md sha256:b0fe3595a3a9]
