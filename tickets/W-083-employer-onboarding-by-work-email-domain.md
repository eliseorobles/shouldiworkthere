---
id: W-083
title: Employer onboarding by work-email domain
phase: Phase 16 - Public launch
status: IN PROGRESS
depends_on: W-014, W-042, W-072, W-082
---

# W-083 - Employer onboarding by work-email domain

**Phase:** Phase 16 - Public launch  
**Depends on:** W-014, W-042, W-072, W-082  
**Status:** IN PROGRESS

## Scope

Owner decision of September 23, 2026: anyone can add a missing employer by name and work-email domain. Listing is separate from verifying and reveals nothing about contributors. The verifier holds the domain registry and creates community contribution and juror keys on demand; the publisher copies their public halves; the browser uses a community key only when both services publish it identically. Abuse controls bound what a listing can do, and a wrong listing can be corrected.

## Acceptance criteria

- [ ] POST /api/employers takes a name of at most 80 characters, refused for identifying details, invisible characters, mixed Latin, Cyrillic and Greek letters, a host name other than its own domain, and abusive or accusatory words (word lists and Jev), and a work-email domain that is a valid host name, not free-mail, disposable, reserved or a bare public suffix (shared/domains.ts), not abusive, and has MX records looked up by DNS over HTTPS at https://cloudflare-dns.com/dns-query from the main worker; a resolver failure lists nothing.
- [ ] Each attempt needs a proof-of-work stamp bound to the domain (W-082) and is limited per client and per wider network (IPv4 /24, IPv6 /48) per UTC day, with a site-wide daily cap; a request refused by the free checks spends no allowance and stores nothing.
- [ ] A listing is shown as 'Name (domain)' with an 'Added by the community' label everywhere it is named; the same domain, a subdomain or a parent of a listed or curated domain cannot be listed; a domain named after a listed employer or alias can be listed only under that employer; a name that means a listed employer with a domain is refused; a bare curated name always resolves to the curated employer.
- [ ] A domain attaches to an existing curated listing that has none only when Jev rates 'Is <domain> the corporate email domain of <employer>?' at least 0.85 AND the domain's registrable label exactly equals a significant word of the name, the whole name or a curated alias; otherwise it becomes a separate community listing. A community domain on a curated listing is labeled as community-supplied wherever it is shown.
- [ ] The main worker registers the employer with the verifier over the VERIFIER service binding, authenticated with INTERNAL_TOKEN (a secret on both workers, never a var, never served or logged); the verifier creates contribution and juror keys on demand (RSA-PSS 2048 through the blind-RSA suite, sealed under ISSUER_MASTER_KEY, COMMUNITY_KEY_LIMITS caps, a daily verification-email budget) and serves them at /keys with source 'community'; the publisher copies them into trusted_issuers with INSERT OR IGNORE; a refused secret leaves no pending listing, closes listing in /api/config and fails verify-deployment.
- [ ] The browser uses a community key only when the publisher's and the verifier's copies agree exactly, labels it as added after this release, never lets it replace a curated or release-pinned key, and checks keys only with the verifier its release names; verify-deployment reports FAIL when the site's and the verifier's community keys differ.
- [ ] Employer records and work-mailbox verified accounts show the employer's verification domains.
- [ ] A wrong listing can be corrected by a person reviewing a request: the operator route detaches a community domain or withdraws or renames a community listing only after the verifier confirms; credentials made with a detached key stop being accepted at once; the public correction log records kind, reason, quarter and a digest; no account is changed.
- [ ] Community juror keys cannot decide a jury: the tokens of all community-listed employers share one seat group per case, capped at 1 seat, and community employers do not count toward whether a jury can form.
- [ ] Every refusal code POST /api/employers can return has plain wording in the add-employer form.

## Implementation paths

- `shared/domains.ts`
- `worker/src/community.ts`
- `worker/src/app.ts`
- `worker/issuer.ts`
- `worker/src/moderation.ts`
- `worker/src/pages.ts`
- `shared/proof.ts`
- `db/migrations/0010_community_employers.sql`
- `db/migrations/0011_listing_corrections.sql`
- `db/verifier-migrations/0005_domain_registry_and_community_keys.sql`
- `db/verifier-migrations/0006_community_email_budget_and_withdrawals.sql`
- `web/add-employer.tsx`
- `web/listing.ts`
- `web/community-keys.ts`
- `tools/verify-deployment.mjs`
- `tools/provision-issuer.mjs`

## Required verification

- tests/community.test.ts (domain rules, the attach rule's deterministic half, name rules, MX lookup, listing gate, proof of work, Jev checks, registration and key copy, duplicates and subdomains, attach at 0.85, pending registration, daily limits, network limits, exact key copies, verification domains on records and accounts, squatting and impersonation refusals, the shared-secret probe, corrections and takedown mirroring, the real-verifier round trip).
- tests/protocol.test.ts: 'registering a domain creates the employer's contribution and juror keys on demand…', 'registration is idempotent and refuses conflicts…', 'a community key signs only for its employer's still-registered, still-accepted domain…', 'an employer anyone listed has a daily email budget…', 'registration refuses a parent domain…', 'DELETE /internal/employers takes a community registration down…'.
- tests/web.test.ts: 'community listings show their domain beside the name and are labeled…', 'adding an employer is checked on the device with the server’s domain rules…', 'a community key is used only when the publisher and the verifier publish it identically…', 'a community listing that shares a curated employer’s name never stands in for it…', 'a community key never replaces a release-pinned key…'.
- Still to add: a tests/moderation.test.ts case where tokens from several community-listed employers fill at most 1 seat of a case and do not make a jury formable.

## Log

- [2026-09-23 05:11 UTC] Ticket created.
- [2026-09-23 05:14 UTC] Started. State read for this entry and checked in the code (group E, 05:00–05:20 UTC). Done and tested (the tests listed on this ticket; all passed in node --test "tests/*.test.ts" at 05:01–05:02 UTC except the one named below): the name and domain rules; MX records by DNS over HTTPS; the proof of work (W-082); per-client, per-network (IPv4 /24, IPv6 /48) and site-wide daily limits; 'Name (domain)' with the community label; refusal of a listed domain, a subdomain or a parent; the squatting and impersonation refusals; registration with the verifier over the VERIFIER binding with INTERNAL_TOKEN; community keys created on demand under COMMUNITY_KEY_LIMITS with a daily verification-email budget (40 per employer, 1,000 in total); INSERT OR IGNORE key copies; exact-copy acceptance in the browser and the verify-deployment agreement check; verification domains on records and accounts; the correction route (POST /api/directory/correct with ADMIN_TOKEN) and the public correction log. The attach rule now needs the registrable label to equal a word of the name, the whole name or an alias: probed for this entry, shared/domains.ts sharesSignificantToken is false for schwab.attacker.com and notschwab.com and true for schwab.com and mail.schwab.com under 'Charles Schwab' (the client group's report of a weak attach check predates that fix).
  Open:
  - High, jury capture. worker/src/moderation.ts keys each juror's seat group by the token's company slug and limits it to 2 seats (policy 0.8.0 keeps 0.7.0's seat classes), with no distinction for community-listed employers. A first jury upholds at 4 of 7 seats and an appeal at 5 of 9 (shared/policy.ts), so someone who lists 2 domains they control can fill the 4 seats that uphold a first jury, and 3 domains the 5 of an appeal; JURY_ENABLED is 'true' in wrangler.jsonc. The criterion 'Community juror keys cannot decide a jury' is the fix and belongs to the jury owner (group B); the stopgaps, JURY_ENABLED off or no community juror keys, depart from the owner decisions and are the owner's call.
  - tests/web.test.ts 'adding an employer is checked on the device with the server’s domain rules, so no proof of work is spent on a refusal' fails ('the listing refusal domain_abusive has plain words'): web/listing.ts has no wording for domain_abusive, name_already_listed, domain_belongs_to_listed and domain_name_mismatch (the main group's requested edit for the client).
  - A community domain attached to a curated listing is not yet labeled: the server sends communityDomains, and web/ does not show it.
  - tools/build.mjs does not define __SIWT_VERIFIER_ORIGIN__; until it does, web/community-keys.ts pins the verifier only when the page is served from https://shouldiworkthere.com.
  - Documents lag the code: docs/operations.md 'Correcting an employer listing' says there is no application path and does not describe POST /api/directory/correct, and docs/threat-model.md still describes the attach rule as sharing a significant word and says a takedown has no application path.
  - Owner decisions from the main group's report: who staffs legal@ for correction requests during a public push; a same-name community listing when an attach fails (for example 'Charles Schwab (schwab-careers.com)'); 2–3 letter domains Jev cannot judge (curated aliases such as 'gs' and 'kp' would protect them); the site-wide cap of 200 listings a day with no alert; batches of 5 for very small community-listed employers; the per-client daily shares raised to 150 searches and 200 Live readings. [read docs/operations.md sha256:98f2532f049c] [read docs/threat-model.md sha256:1813a789fc8f]
- [2026-09-23 06:29 UTC] Final launch verification: re-read docs/operations.md and docs/threat-model.md for this entry. operations.md 'Correcting an employer listing' now describes POST /api/directory/correct (rename, detach, withdraw, the reasons and the refusals) with the verifier-first takedown, and threat-model.md section 8 describes the exact-label attach rule and the correction route. Checked in the code against the 05:14 open items: jury capture is fixed (worker/src/moderation.ts seatGroup and jurorEmployers, policy 0.8.0 communitySeatsPerCase 1; tests/moderation.test.ts 'jury capture: ...' passed at 06:17-06:18 UTC, and a scratch test of 4 community domains with 3 tokens each seated 1); web/listing.ts has wording for domain_abusive, domain_name_mismatch, name_already_listed and domain_belongs_to_listed, and tests/web.test.ts passes; the community-domain label is shown (web/api.ts communitySupplied; npx playwright test 131 passed and 1 skipped at 06:19-06:23 UTC); tools/build.mjs defines __SIWT_VERIFIER_ORIGIN__. Attach attack, run by the final verifier through the real POST /api/employers route with DNS and Jev stubbed and Jev forced to 0.99: schwab.attacker.com, notschwab.com, schwab-careers.com, sch-wab.com, schwab.github.io, mail.schwab.com.evil.net and schwabmail.com never attach to the curated Charles Schwab listing, and schwab.com does. Residual, an owner decision already listed: while Charles Schwab has no domain, the first look-alike whose label carries the name (schwab-careers.com, sch-wab.com or schwabmail.com, even with Jev at 0) becomes its own community listing named 'Charles Schwab' with its domain beside it; later same-name attempts are then refused name_already_listed, and schwab.com can still attach. The other owner decisions in the 05:14 entry remain open. [read docs/operations.md sha256:23803f99bfdc] [read docs/threat-model.md sha256:d4dfb76d64f7]
- [2026-09-23 06:41 UTC] Re-read docs/operations.md after the launch deploy: the only change is the zone-check header grep in deploy step 8, which now accepts the workers' intentional 'nel: {"max_age":0}'. The earlier entry still holds. [read docs/operations.md sha256:b88f975dd416]
- [2026-09-23 17:37 UTC] Reviewed the open-source release edit to docs/operations.md: the prerequisites now require Node 24+ (26.5.0 pinned) and Bun 1.4.0 to match the dependencies. The remaining operational instructions and this ticket's recorded scope are unchanged. Clean-export build and typecheck passed; ticket reference checks are being refreshed for the updated document. [read docs/operations.md sha256:b0fe3595a3a9]
