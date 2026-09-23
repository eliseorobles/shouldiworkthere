# Operations runbook

For whoever deploys and runs Should I Work There. Everything here uses the tools in this repository and Wrangler; nothing
deploys automatically. Commands assume the repository root, Node 24 or later (26.5.0 is pinned; the tools and tests run TypeScript
directly and use `node:sqlite`), Bun 1.4.0 (for `bunx`), and a Wrangler login with access to the
account in the Wrangler configs.

## The three workers

| Worker | Config | Depends on | Cron |
|---|---|---|---|
| Inference | `inference.wrangler.jsonc` | public D1, Workers AI, AI Gateway `default`, analysis queue consumer | `23 * * * *` (analysis backfill) |
| Verifier | `issuer.wrangler.jsonc` | verifier D1, Email Sending, rate limiters `ABUSE`, `JUROR_LIMIT` and `REGISTER_LIMIT` | `*/15 * * * *` (expiry and quota cleanup; community keys for the new quarter) |
| Main | `wrangler.jsonc` | public and intake D1, `INFERENCE` and `VERIFIER` service bindings, R2 archives, analysis queue producer, rate limiters | `0 */6 * * *` (publication, erasure, moderation, daily-digest purge, community listing registration and key copy, archive) |

The main worker binds inference and the verifier, and all three read tables that migrations add, so the order below is
required. The `VERIFIER` binding carries four kinds of request, all authenticated with `INTERNAL_TOKEN` except the key
read: registering a newly listed employer's domain (`POST /internal/employers`), taking a community domain down when an
operator corrects a listing (`DELETE /internal/employers`, from `POST /api/directory/correct`), a side-effect-free check
that the verifier accepts the shared secret (a `DELETE` with an empty body, made by the 6-hourly job), and reading the
verifier's public `/keys?source=community` to copy community keys. It never carries a contribution, a question or an
email address, and the publisher never calls the verifier to check a credential (`worker/src/credentials.ts` reads
only its own `trusted_issuers`). The internal route is also reachable at
`https://verify.shouldiworkthere.com/internal/employers` for anyone holding the token; the normal way to correct a
listing is the main worker's operator route (see "Correcting an employer listing"). A wrong or missing token is
answered 401 and counts against the caller's network limit.

## Launch release (September 23, 2026): the zero-data public launch

This release carries the owner decisions of September 23, 2026. What it changes in production:

- **Zero data.** `SAMPLE_EMPLOYERS` is `off` in `wrangler.jsonc`: no fictional employer is shown anywhere (directory,
  search options, discovery, `/c/<slug>` answers 404, Open Graph images, FAQ, `/api/config`), and no practice jury or
  practice challenge can run. The verifier has its own `SAMPLE_EMPLOYERS` var, also `off` in `issuer.wrangler.jsonc`:
  it neither lists the fictional employers' sandbox keys at `/keys` and `/stats` nor signs with them. The existing
  fictional rows, the verifier's sandbox keys and the pre-launch test records are removed with
  `tools/purge-samples.mjs` (below). A release build refuses while the committed production registry still lists
  sandbox keys (below). Locally and in tests both vars are `on`.
- **Publication.** `REAL_PUBLICATION_ENABLED` is `true`. Written accounts publish in batches of at least
  `TESTIMONY_BATCH_MIN` (5) approved accounts per employer and verification type, after screening and the random
  12–72-hour delay (policy 0.8.0). A contribution submitted before September 23, 2026 (`created_day` before
  `LEGAL_EFFECTIVE`, or no `created_day`) keeps the rule legal version 1.1.0 promised: `publishDue` batches it only with
  other such contributions, per employer, reporting period and verification type, and only at `legacyBatchMin` (25,
  policy 0.8.0 `retention.legacyBatch`). Questionnaire percentages and answer bands still need `MIN_COHORT_N` (25).
- **Juries.** `JURY_ENABLED` is `true`. A real-employer jury forms only when curated juror keys of enough other
  employers are live (`/api/config` and the moderation page say whether one can form now); otherwise a held case stays
  held. Employers added by the community never count toward that, and all their juror tokens together fill at most one
  seat on a case (policy 0.8.0 `jury.communitySeatsPerCase`, `worker/src/moderation.ts`).
- **Employers added by the community.** `POST /api/employers` lets anyone list an employer by name and work-email
  domain. It is open only while the main worker has the `VERIFIER` and `INFERENCE` bindings, an `INTERNAL_TOKEN` of at
  least 32 characters and `RATE_LIMIT_SECRET` (`worker/src/community.ts listingOpen`), and `/api/config` reports it
  closed while the last scheduled check found the verifier refusing the shared secret. Each client (an IPv4 address or
  IPv6 /64) gets 5 attempts a day and each wider network (IPv4 /24 or IPv6 /48) 15, with 200 listings a day in total.
  The verifier sends at most 40 verification emails per UTC day for one community employer and 1,000 for all of them
  together (`COMMUNITY_EMAIL_LIMITS` in `shared/proof.ts`, counted in the verifier table `email_budget` from migration
  0006); over either budget `/start` answers as usual and sends nothing, so codes for that employer may not arrive
  until the next UTC day. A domain taken down is recorded in `withdrawn_employers` and cannot be registered again.
- **Listing corrections.** `POST /api/directory/correct` (with `ADMIN_TOKEN`) applies a correction a person reviewed:
  rename a community listing, detach a community-added domain, or withdraw a community listing with nothing published or
  waiting. Each one is appended to the public `listing_corrections` log (public migration 0011), shown on
  `/transparency#listing-corrections` and at `/api/transparency`. The terms promise that a person reviews every request
  sent to legal@, so someone must read that inbox (see "Staffing legal@ during the launch").
- **Proof of work.** `/start` and `/issue-juror` at the verifier and `/api/employers` at the main worker need a
  hashcash stamp (`shared/pow.ts`, 20 bits by default, `POW_BITS` on the verifier) computed in a Web Worker in the
  browser. No spent-stamp table exists.
- **Model-call budgets** (`worker/inference-core.ts BUDGETS`, per UTC day): search 45,000 (listing checks are charged
  here), live 45,000, screen 5,000, analysis 4,000, relevance 1,000.
- **Legal pages 1.2.0**, effective September 23, 2026, served without the "Draft — pending attorney review" notice:
  `LEGAL_REVIEWED_VERSION` in `shared/brand.ts` is `'1.2.0'`, set on the owner's statement of September 23, 2026 that
  counsel approved the terms (see "Legal go-live checklist"). `legalLaunchBlockers()` is empty: contact mail arrives,
  and the `change-notice` question (1.1.0, first served on September 22, promised 30 days' notice of material changes
  and batches of at least 25) no longer blocks, because the owner recorded the approval and the publication code keeps
  the batch of 25 for contributions accepted under 1.1.0.

### Deploy order for this release

Run every step; do not skip the dry runs. Nothing here needs `db/seed.sql`, which is never applied remotely.

0. **Legal gate (`change-notice`).** Do not start before September 23, 2026 (UTC), the effective date of 1.2.0.
   `legalLaunchBlockers()` must be empty (it is: contact mail arrives, and 1.1.0 contributions keep their batch in
   code). `LEGAL_REVIEWED_VERSION` is `'1.2.0'` on the owner's statement that counsel approved the terms; if counsel has
   not in fact approved the text now in `docs/legal`, set it back to `null` and regenerate `docs/legal` before building,
   so the pages carry the draft notice again instead of being served as reviewed. For the record, count the real
   contributions accepted under 1.1.0 that are still waiting (read-only). The code keeps each of them at a batch of 25,
   so this no longer has to return no rows; it tells you how many are waiting for a batch of 25:

   ```bash
   npx wrangler d1 execute shouldiworkthere-intake --remote --config wrangler.jsonc --json \
     --command "SELECT verification_class, status, COUNT(*) AS n FROM submissions WHERE verification_class<>'demo' AND status IN ('held','approved','publishing') AND (created_day IS NULL OR created_day<'2026-09-23') GROUP BY verification_class, status"
   ```

1. **Local checks.** `npx tsc --noEmit`, `node --test "tests/*.test.ts"`, then the local stack (`node tools/build.mjs
   --local`, `npx playwright test`, `node tests/integration.mjs`; see "Before any deploy"). Regenerate `docs/legal` if
   `worker/src/legal.ts`, `shared/brand.ts`, `shared/policy.ts` or a Wrangler var changed.
2. **Snapshot and count** (deploy order step 1 below): bookmarks of all three databases and row counts.
3. **Migrate** (step 2 below): public `0010_community_employers.sql` (additive: `companies.origin`,
   `trusted_issuers.source`, `employer_domains` and the domains of the nine curated employers already provisioned) and
   `0011_listing_corrections.sql` (additive: the append-only `listing_corrections` log), then verifier
   `0005_domain_registry_and_community_keys.sql` (additive: `employer_domains`, `issuer_keys.source`) and
   `0006_community_email_budget_and_withdrawals.sql` (additive: `email_budget`, `withdrawn_employers` and two indexes).
   The verifier code of this release reads both new tables, so deploy it only after 0006.
4. **Secrets.** Generate one internal token and put the same value on both workers, verifier first (the verifier's
   config lists it in `secrets.required`). Never paste it into a var, a log, a ticket or chat:

   ```bash
   TOKEN=$(openssl rand -base64 48 | tr -d '\n')
   printf %s "$TOKEN" | npx wrangler secret put INTERNAL_TOKEN --config issuer.wrangler.jsonc
   printf %s "$TOKEN" | npx wrangler secret put INTERNAL_TOKEN
   unset TOKEN
   ```

   Confirm `RATE_LIMIT_SECRET` and `ADMIN_TOKEN` are set on the main worker (`npx wrangler secret list`): without the
   first, challenges and employer listing are closed; without the second, no listing can be corrected (the correction
   route answers 401).
5. **Purge the fictional data** ("Removing sample data" below): dry run and read it, then apply with the public
   bookmark from step 2, `--all-intake` and `--no-export`. It removes the fictional employers from the public and intake
   databases and their sandbox keys, and the verification challenges made with them, from the verifier database; it
   records the intake and verifier bookmarks itself. Real (work-mailbox) contributions are kept unless you also pass
   `--include-real-contributions`, which only counsel's decision justifies.
6. **Keys, samples off.** `ISSUER_MASTER_KEY=<production value> node tools/provision-issuer.mjs --remote --no-samples
   --next-quarter`. Without samples it drops every sandbox key from `.issuer-secrets.json`, the registry and both SQL
   files, so no purged key is re-created or re-published (`wrangler.jsonc`'s `SAMPLE_EMPLOYERS` `off` has the same
   effect; `--no-samples` makes it explicit). `--next-quarter` also creates the keys for October 1 now, so this release
   pins them. It refuses if it cannot read the verifier's community registry (pass `--skip-community-check` only
   knowingly). Commit `db/issuer-public-keys.json`.
7. **Build and sign** (step 6 below, without the deploy): `node tools/build.mjs`, then `node tools/transparency.mjs`,
   and commit the new `docs/releases/<date>-<hash>.json`. A release build refuses, writing nothing, while
   `db/issuer-public-keys.json` lists any sandbox (`demo`) key and `wrangler.jsonc` does not set `SAMPLE_EMPLOYERS` to
   `on`, or while `wrangler.jsonc`'s `VERIFIER_ORIGIN` is not `https://verify.shouldiworkthere.com` (the only verifier a
   release client will contact). If it refuses for sandbox keys, re-run step 6; never build with `--local` for a
   release.
8. **Deploy the verifier, then inference, then main:**

   ```bash
   node tools/db.mjs check remote --for=verifier && npx wrangler deploy --config issuer.wrangler.jsonc
   node tools/db.mjs check remote --for=inference && npx wrangler deploy --config inference.wrangler.jsonc
   node tools/db.mjs check remote --for=main && npx wrangler deploy
   ```

   The main worker binds both, so it goes last; deploy it from the tree you just built and signed.
9. **Verify** (step 7 below). For this release, `verify-deployment` must also report fictional employers hidden,
   "sandbox keys retired" (neither host serves a `demo` key; FAIL otherwise), listing open, and the site's and the
   verifier's community keys identical (none exist yet, so it reports none). "verifier link" warns until the main
   worker's first scheduled run after the deploy (at most 6 hours) and must then pass; a FAIL means the two workers do
   not hold the same `INTERNAL_TOKEN`.
10. **Zone check as a browser** (step 8 below).
11. **Smoke checks that create no data.** In production, never create a listing, a contribution or a jury seat to test:
    each is real data and has to be corrected or erased by hand.

    ```bash
    curl -s https://shouldiworkthere.com/api/config | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const c=JSON.parse(s);console.log({sampleEmployers:c.sampleEmployers,realPublication:c.realPublicationEnabled,publication:c.publication,employerListing:c.employerListing})})"
    curl -s -o /dev/null -w "%{http_code} /c/northwind-labs\n" https://shouldiworkthere.com/c/northwind-labs          # 404
    curl -s -X POST https://shouldiworkthere.com/api/employers -H 'content-type: application/json' -d '{"name":"x","domain":"example.com"}'   # {"error":"pow_missing",...}: refused before anything is read or stored
    curl -s -o /dev/null -w "%{http_code} /api/directory/correct without a token\n" -X POST https://shouldiworkthere.com/api/directory/correct -H 'content-type: application/json' -d '{}'   # 401
    ```

    Then open `/privacy` and `/terms` and check the version line (1.2.0, September 23, 2026) and that no draft notice
    is shown, and `/transparency#listing-corrections` ("No listing has been corrected.").

### Staffing legal@ during the launch

The terms say a person reviews every request to correct a listing and every legal notice sent to
`legal@shouldiworkthere.com`, and acknowledge notices normally within 5 business days; nothing in the product does it
for you. Before promoting the launch, name who reads legal@ (and privacy@ and dmca@) every day, and keep doing so while
traffic is high: a wrong listing (a domain that is not the employer's, or a squatted name) stays up, and mailboxes at
its domain can keep obtaining credentials and juror tokens under it, until someone applies a correction. Handle a correction request as
described under "Correcting an employer listing"; answer the requester with what was changed, never with anything
about a contributor.

## Before any deploy

```bash
npx tsc --noEmit
node --test "tests/*.test.ts"
node tools/build.mjs --local                           # the local stack's build; never release it
node tools/dev.mjs --restart && npx playwright test     # against the local stack
node tests/integration.mjs                             # live-stack suite
```

The release build (`node tools/build.mjs`, without `--local`) pins the production key registry and the production
verifier, so the local contribution and juror flows refuse it; build it only for the release, in the deploy step.

The legal review copies must match the code: if `worker/src/legal.ts`, `shared/brand.ts`, `shared/policy.ts` or a
Wrangler var changed, regenerate them and commit the result (the test suite fails otherwise). The review copies are
rendered for the production configuration (`reviewConfig()` in `worker/src/legal.ts`: the Wrangler vars, the service
bindings, and the main-worker secrets this runbook marks as required):

```bash
node --input-type=module -e "import {legalMarkdownFiles,reviewConfig} from './worker/src/legal.ts'; import {writeFileSync} from 'node:fs'; for (const f of legalMarkdownFiles(reviewConfig())) writeFileSync(f.path, f.content);"
```

## Deploy order

1. **Snapshot and count.** D1 keeps 30 days of point-in-time history, so record a bookmark for each database instead of
   exporting private data to a laptop. `npm run db:bookmarks` prints the current bookmark of all three databases; copy
   the output into your deploy notes. The same commands by hand:

   ```bash
   for db in shouldiworkthere-public shouldiworkthere-intake; do npx wrangler d1 time-travel info $db --config wrangler.jsonc; done
   npx wrangler d1 time-travel info shouldiworkthere-verifier --config issuer.wrangler.jsonc
   ```

   Record row counts of the tables the pending migrations touch (read-only), for example:

   ```bash
   npx wrangler d1 execute shouldiworkthere-intake --remote --config wrangler.jsonc --json \
     --command "SELECT status, COUNT(*) AS n FROM submissions GROUP BY status"
   npx wrangler d1 execute shouldiworkthere-public --remote --config wrangler.jsonc --json \
     --command "SELECT (SELECT COUNT(*) FROM testimony) AS testimony, (SELECT COUNT(*) FROM metric_releases) AS releases, (SELECT COUNT(*) FROM trusted_issuers) AS keys, (SELECT COUNT(*) FROM companies WHERE kind='sample') AS samples"
   npx wrangler d1 execute shouldiworkthere-verifier --remote --config issuer.wrangler.jsonc --json \
     --command "SELECT verification_class, COUNT(*) AS n FROM issuer_keys GROUP BY verification_class"
   ```

   Never export the intake or verifier database off Cloudflare: they hold unpublished text and mailbox hashes.
2. **Migrate.** `node tools/db.mjs remote`. It prints each pending migration's header, refuses if it cannot read remote
   state, and refuses any migration that changes existing rows unless you pass `--accept-row-changes` after reading the
   header (verifier 0001 also needs `--accept-legacy-quota-reset` when legacy quota rows exist). `db/seed.sql` is never
   applied remotely. Re-run the row counts and compare.
3. **Keys (first deploy of a quarter).** `ISSUER_MASTER_KEY=<production value> node tools/provision-issuer.mjs --remote`.
   It reads real employers' headcount bands from the public database and refuses when a band is unreadable, unless
   `--accept-default-caps`. It rewrites the limits on every live row, loads the public keys and writes
   `db/issuer-public-keys.json`; commit that file (the next build pins it and the release signs it). The issuer private
   keys themselves live in `.issuer-secrets.json` (mode 0600, git-ignored) on the machine that provisions: anyone with
   that file can sign credentials, so keep it offline and backed up like the release key. It creates sandbox keys only
   while the main worker would show fictional employers (`SAMPLE_EMPLOYERS` exactly `on`); in production it creates
   none. It never touches community keys: the verifier creates those itself, at registration and at each quarter's
   start, and the main worker's scheduled job copies their public halves.
4. **Verifier.** `node tools/db.mjs check remote --for=verifier && npx wrangler deploy --config issuer.wrangler.jsonc`.
5. **Inference.** `node tools/db.mjs check remote --for=inference && npx wrangler deploy --config inference.wrangler.jsonc`.
   The order of steps 4 and 5 does not matter to the code; both must come before the main worker, which binds them.
6. **Main, signed.**

   ```bash
   node tools/build.mjs
   node tools/transparency.mjs            # --init-key the first time; refuses if any signed source changed since the build
   git add docs/releases                  # release records are append-only; never edit one
   node tools/db.mjs check remote --for=main && npx wrangler deploy
   ```

   `npm run deploy` is build, sign and deploy for the main worker only. A release build refuses, writing nothing, while
   `db/issuer-public-keys.json` lists sandbox (`demo`) keys and `wrangler.jsonc` does not set `SAMPLE_EMPLOYERS` to `on`,
   or while `wrangler.jsonc`'s `VERIFIER_ORIGIN` is not the verifier a release client pins
   (`https://verify.shouldiworkthere.com`); its message says how to fix each.
7. **Verify.** `node tools/verify-deployment.mjs --state=.siwt-watch-state.json`. Expect no FAIL; "archive release
   link" warns until the first archive written after the release. Keep the state file (it is how a later rewrite of the
   archive history is caught) and back up `.release-signing-key.json` offline; losing it means announcing a new release
   key. It fetches pages as a browser does (a browser `User-Agent` and `Accept: text/html`), because Cloudflare adds
   the Web Analytics beacon only to responses it serves to browsers; at launch (September 2026) an earlier version that
   used a plain request printed PASS while every browser was sent the beacon. Step 8 stays the check of the zone.
   Community keys cannot be signed in a release (the verifier creates them after it); the tool checks instead that
   every community key the site publishes is identical on the verifier, and warns while a live one is not yet copied
   to the site.
8. **Check the zone as a browser.** Cloudflare zone features can add scripts, headers or cookies to what visitors get,
   and the code sets none of them. Left on, they contradict the privacy policy (no analytics or third-party scripts, no
   cookies of our own, encrypted connections with HSTS) and the threat model. Plain `curl` is not enough: at launch a
   request with curl's default `User-Agent` got clean HTML, and the same page requested with a browser `User-Agent`
   carried `<script src="https://static.cloudflareinsights.com/beacon.min.js/…" data-cf-beacon=…>`. So request as a
   browser:

   ```bash
   UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
   # 1. Injected scripts: must print nothing.
   for path in / /privacy /submit /jury /c/stripe; do
     curl -s -A "$UA" -H 'Accept: text/html' "https://shouldiworkthere.com$path" \
       | grep -o -E "cloudflareinsights|beacon\.min\.js|data-cf-beacon|/cdn-cgi/[^\"' ]+|data-cfemail|__cf_email__|rocket-loader|data-cf-settings|zaraz" | sort -u
   done
   # 2. Added headers and cookies: must print nothing (no set-cookie, nel or report-to on either host).
   for url in https://shouldiworkthere.com/privacy https://verify.shouldiworkthere.com/keys; do
     curl -s -D - -o /dev/null -A "$UA" -H 'Accept: text/html' "$url" | grep -i -E "^(set-cookie|nel|report-to):" \
       | grep -v -i -E '^nel: \{"max_age":0\}'   # the workers send this on purpose: it withdraws error reporting
   done
   # 3. Plain HTTP: each must answer 301 (or 308) with a location: https://… header, never 200.
   for url in http://shouldiworkthere.com/ http://shouldiworkthere.com/api/config http://verify.shouldiworkthere.com/keys; do
     curl -s -o /dev/null -w "%{http_code} %{redirect_url}  $url\n" "$url"
   done
   ```

   Open `https://shouldiworkthere.com/` in a browser with the developer console open as well: there must be no
   Content Security Policy error and no request to a host other than `shouldiworkthere.com` and
   `verify.shouldiworkthere.com`. A CSP error naming `static.cloudflareinsights.com` means the beacon is still being
   injected; the CSP only stops it from running.

   Code-side guard (since the 2026-09-22 production fix): all three workers send `Cache-Control: … no-transform` on
   every response, which stops Cloudflare's proxy from modifying what they serve, so the Web Analytics beacon, email
   obfuscation and Rocket Loader cannot be injected even if one of the settings below is switched on. They also send
   `NEL: {"max_age":0}`, which tells browsers to drop any error-reporting policy for the host. Both workers redirect plain
   HTTP to HTTPS themselves outside local development. Keep the settings below as documented anyway: the headers are a
   second line of defense, and Cloudflare may still add its own `nel`/`report-to` headers at the edge.

   In the Cloudflare dashboard, for the `shouldiworkthere.com` zone (which also serves `verify.shouldiworkthere.com`):

   | Setting | Must be | What it does if left in the wrong state |
   |---|---|---|
   | Web Analytics automatic setup (RUM beacon injection): under Web Analytics, "Manage site" for the hostname, choose to disable it; also no RUM enabled from Speed > Observatory | Off | Adds the `static.cloudflareinsights.com` beacon to every HTML page served to a browser |
   | Network Error Logging (NEL) | Off | Adds `nel` and `report-to` headers to every response from both hosts, so Chromium-based browsers send reports of failed requests, including the address requested, to `a.nel.cloudflare.com` |
   | Email Address Obfuscation (Scrape Shield) | Off | Rewrites email addresses and adds an `/cdn-cgi/…/email-decode` script |
   | Rocket Loader (Speed > Optimization) | Off | Rewrites script tags and adds its own loader script |
   | Zaraz | Off | Adds a `/cdn-cgi/zaraz/` script |
   | Bot Fight Mode and JavaScript detections (Security > Bots) | Off | Adds `/cdn-cgi/challenge-platform/` scripts and `__cf_bm` or `cf_clearance` cookies |
   | Any other challenge (Security Level, WAF rules) on normal page requests | Off | Sets `cf_clearance` |
   | Always Use HTTPS (SSL/TLS > Edge Certificates; the encryption mode must not be Off for the switch to show) | On | Redirects `http://` to `https://` at Cloudflare's edge for every host in the zone, before any worker runs. Without it, a host whose worker does not redirect by itself answers `http://` requests in plain text; at launch both hosts did, for the whole site and the verifier's API. Browsers ignore HSTS sent over plain HTTP, so a first visit or an `http://` link is unprotected |

   The same settings through the Cloudflare API (from its API reference, September 2026), with a token that can edit
   zone settings and Web Analytics:

   - Network Error Logging: `PATCH /zones/{zone_id}/settings/nel` with `{"value":{"enabled":false}}`. The reference says
     it is on by default for Free and Pro zones, so check it on every new zone.
   - Always Use HTTPS: `PATCH /zones/{zone_id}/settings/always_use_https` with `{"value":"on"}`.
   - Rocket Loader and Email Address Obfuscation: `PATCH /zones/{zone_id}/settings/rocket_loader` and
     `…/settings/email_obfuscation`, each with `{"value":"off"}`.
   - Web Analytics: find the zone's site with `GET /accounts/{account_id}/rum/site_info/list`, then either
     `PUT /accounts/{account_id}/rum/site_info/{site_id}` with `"auto_install": false` (no automatic injection) or
     `DELETE` that site.

   The dashboard's location for a switch can change; the commands above are the test. Rerun them after changing any
   zone setting, and after every deploy.

`npm run deploy:all` chains bookmarks (`npm run db:bookmarks`), migrate, inference, verifier, main and verify. It prints
the bookmarks but saves nothing and records no row counts (the migrate step counts only the legacy verifier rows that
verifier 0001 would delete), and it cannot pass the acceptance flags, provision keys, set secrets or purge sample data.
Use the steps above whenever a migration changes rows, for the launch release, and copy the printed bookmarks into your
notes either way.

## Removing sample data (`tools/purge-samples.mjs`)

Production holds no fictional data (owner decision of September 23, 2026). `tools/purge-samples.mjs` removes the
fictional employers (`companies.kind='sample'`) and everything recorded about them from all three databases:

- **Public:** their groups, events, releases and bands, accounts with their readings, pair judgments and vector ledger
  rows (left for the inference sweep when a Vectorize index is bound), clusters, question trails, interest counts,
  aliases, verification domains and sandbox (`demo`) keys in `trusted_issuers`, then the employer rows.
- **Intake:** contributions to them with their decision log, jury cases and seats about them, aggregate groups, and
  challenges, queued challenges, re-checks and exceptions naming their accounts.
- **Verifier:** their sandbox (`demo`) signing keys in `issuer_keys` (with the sealed private halves), the verification
  challenges made with those keys, and any count or pause of an employer that has only sandbox keys.

With `--all-intake` it also clears the pre-launch test records from intake (decision log, juries, challenges, counters,
daily budgets, snapshots) and the public `moderation_stats`, which the scheduled job recomputes, but it keeps every real
(work-mailbox verified) contribution with its decision log, exceptions, real-employer juries, aggregate groups and every
spent-credential record, unless you also pass `--include-real-contributions`. It never touches a real employer's row,
the migration tables (`d1_migrations`, `sqlite_*`, `_cf_*`), the append-only public ledgers (finance, legal requests,
moderation actions, release manifests, the exception log, the listing correction log) or the R2 archives.

1. **Bookmark.** `npx wrangler d1 time-travel info shouldiworkthere-public --config wrangler.jsonc` (and `npm run
   db:bookmarks` for your notes). A remote `--apply` refuses without the public bookmark, and records the intake and
   verifier bookmarks itself (it refuses if it cannot).
2. **Dry run.** `node tools/purge-samples.mjs --remote --all-intake`. It reads the three databases and prints how many
   rows each statement would remove, the real contributions it keeps, by status, and the SQL; nothing changes. Read it.
   A `mailbox` contribution submitted before September 23, 2026 was accepted under legal version 1.1.0; it is kept and
   the code publishes it only in a batch of at least 25 such contributions. Remove real contributions
   (`--include-real-contributions`) only on counsel's decision: their authors' status pages then find nothing.
3. **Apply.** `node tools/purge-samples.mjs --remote --apply --all-intake --no-export --bookmark=<public bookmark>`. It
   drops and re-creates the append-only triggers of the intake decision log around the delete in the same file, and
   checks the triggers afterwards. Pass `--no-export`: without it the tool first exports the three databases to
   `.private-backups/` on this machine, which puts unpublished text, mailbox hashes and daily network records on a
   laptop, against the rule in "Deploy order" step 1; the Time Travel bookmarks are the backup (30 days).
4. **Check.** Re-run the dry run: it must report zero rows. After the deploy, `/c/northwind-labs` answers 404,
   `/api/directory` lists no `sample` row, `/api/config` says `sampleEmployers: false`, and `verify-deployment` reports
   fictional employers hidden and "sandbox keys retired" (PASS). Then provision without samples (launch step 6) so the
   registry, `.issuer-secrets.json` and the SQL files drop the sandbox keys too; until they do, a release build refuses.

`--local` runs the same plan against the local development databases. It removes the local samples too, so re-seed
afterwards: delete the local state and run `node tools/prepare-local.mjs`.

## Secrets

The "Required" column is what production needs. `worker/src/legal.ts reviewConfig()` renders `docs/legal` assuming the
main worker's required secrets are set, and `tests/safety.test.ts` reads this table to check that.

| Worker | Secret | In production | Set with | Notes |
|---|---|---|---|---|
| Main | `RATE_LIMIT_SECRET` | Required | `npx wrangler secret put RATE_LIMIT_SECRET` | 32 random bytes. Keys limiter hashes, seat groups and daily network records. Without it, challenges and employer listing are closed and FAQ interest is not counted. |
| Main | `INTERNAL_TOKEN` | Required | see "Deploy order for this release", step 4 | At least 32 characters, the same value as the verifier's. Authenticates the main worker's calls to the verifier's internal route over the `VERIFIER` binding (registration, takedown on correction, the link check); never sent to a browser. Without it, employer listing is closed. |
| Main | `ADMIN_TOKEN` | Required | `npx wrangler secret put ADMIN_TOKEN` | The operator's token for `POST /api/directory/correct` (listing corrections) and for appending to the finance and legal ledgers. Without it those routes answer 401, so no listing can be corrected. Keep it offline like the release key. |
| Main | `INFERENCE_CALLER_SECRET` | Optional | `npx wrangler secret put INFERENCE_CALLER_SECRET`, then the same value with `--config inference.wrangler.jsonc` | When set, every call over the `INFERENCE` binding carries it, and the inference worker then refuses calls without it. Set it on the main worker first. |
| Main | `TRUSTEE_KEYS` | Leave unset | | Enables trustee exceptions; needs three independent trustees first. |
| Inference | `TYPESAFE_API_KEY` | Required | `npx wrangler secret put TYPESAFE_API_KEY --config inference.wrangler.jsonc` | The fallback path; the primary path uses the key stored in AI Gateway (BYOK). Never set it on the main worker. |
| Verifier | `ISSUER_MASTER_KEY` | Required | `ISSUER_MASTER_KEY=… node tools/provision-issuer.mjs --remote --put-master-secret` | Seals issuer private keys, curated and community, in the verifier database. To rotate, run the same command with the new value: every live curated key is re-sealed from `.issuer-secrets.json`. Community keys exist only in the verifier database, sealed under the current value, so a rotation that does not re-seal them makes them unusable: do not rotate until the tool can re-seal community keys. Signing fails for the minute between the secret upload and the new rows. `--retire-legacy-secret` only deletes the old `ISSUER_KEYS` secret. |
| Verifier | `MAILBOX_PEPPER` | Required | `npx wrangler secret put MAILBOX_PEPPER --config issuer.wrangler.jsonc` | Rotating it mid-quarter lets every mailbox obtain a second credential that quarter; rotate only at a quarter boundary. |
| Verifier | `INTERNAL_TOKEN` | Required | see "Deploy order for this release", step 4 | The same value as the main worker's. The verifier refuses internal calls unless it is set and at least 32 characters long. Corrections normally reach the verifier through the main worker; a direct takedown at the verifier needs this token (see "Correcting an employer listing"). |

Rotating `RATE_LIMIT_SECRET` resets the day's challenge budgets, listing allowances and interest de-duplication, and
while a real-employer case is open it lets one employer take up to 2 more seats on it (and the community group one
more). Rotate `INTERNAL_TOKEN` by putting a new value on the verifier and then on the main worker: in between, listings
fail with "listing unavailable" and corrections with `verifier_refused_token`, and if the main worker's scheduled job
runs in between it records the link as refused, which reports listing closed on `/api/config` and makes
`verify-deployment` fail "verifier link" until a later run (up to 6 hours) finds the secret accepted. Local development uses its own values in `.dev.vars.*`, written by
`tools/prepare-local.mjs` (which gives both local workers the same `INTERNAL_TOKEN` and sets `SAMPLE_EMPLOYERS=on`).

## Switches

Changing a var means editing the Wrangler config and redeploying that worker (the legal pages read the same switches,
so regenerate `docs/legal` and commit).

| Switch | Production | Off, or unset | On |
|---|---|---|---|
| `SAMPLE_EMPLOYERS` (main) | `"off"` | Anything but `on` hides every fictional employer and everything about them; no practice juries or practice challenges | `on` (local and tests): the fictional employers are shown, labeled, with practice juries |
| `SAMPLE_EMPLOYERS` (verifier) | `"off"` | Anything but `on`: sandbox (`demo`) keys are left out of `/keys` and `/stats` and sign nothing | `on` (local and tests): sandbox keys are listed and sign without a mailbox. Keep it equal to the main worker's value |
| `REAL_PUBLICATION_ENABLED` (main) | `"true"` | Real-employer contributions are held and erased after 180 days unless published | Batched publication for real employers |
| `TESTIMONY_BATCH_MIN` (main) | `"5"` | The policy's `retention.minimumBatch` (5 under policy 0.8.0) | Written accounts per batch, per employer and verification type; never below the policy's minimum |
| `MIN_COHORT_N` (main) | `"25"` | The policy's `retention.aggregateMinimum` (25) | Minimum group and answer count for questionnaire figures; never below the policy's minimum |
| `JURY_ENABLED` (main) | `"true"` | No real-employer juries; jury-range cases stay held | Real-employer juries when enough juror keys of other employers are live |
| `CRISIS_RESOURCES_ENABLED` (main) | `"true"` | No server-side crisis resources | The publisher's phrase check adds resources to the asker's reply |
| `POW_BITS` (verifier; also read by the main worker) | `"20"` on the verifier, unset (20) on main | 20 leading zero bits | Proof-of-work difficulty, clamped to 8–32. Raise it only with the client, which reads the difficulty the server reports |
| `SELF_HARM_SCREENING` (inference) | `"true"` | The self-harm question is never asked | One optional question during screening, only to offer resources |
| `JEV_PROVIDER` (inference) | `cloudflare` | Any value other than `cloudflare` or `typesafe` stops every model call: search degrades to manual controls, screening answers "unavailable, nothing stored", employer listing answers "checks unavailable", challenge relevance falls back to the ground terms, and relevant challenges are queued with a receipt until re-checks can run again (the scheduled job drains the queue, privacy and safety rules first) | `cloudflare` (Workers AI via AI Gateway) with `JEV_FALLBACK=typesafe` |
| `EMAIL_ENABLED` (verifier) | `"true"` | Mailbox codes stop (`503`) | Codes are emailed |
| `RATE_LIMIT_SECRET` (main secret) | set | Challenges and employer listing closed; FAQ interest not counted; seat groups unkeyed | Normal |
| `INTERNAL_TOKEN` (secret on both) | set | Employer listing closed; listing corrections cannot reach the verifier (`503 verifier_unavailable`) | Listing registers domains with the verifier; corrections take domains down there |
| `TRUSTEE_KEYS` (main secret) | unset | `/api/exception` answers 503 | Two-of-three exceptions |
| `LEGAL_REVIEWED_VERSION` (`shared/brand.ts`) | `'1.2.0'` (the owner's statement of September 23, 2026) | `null`: legal pages show "Draft — pending attorney review" | Set to the exact `LEGAL_VERSION` recorded as approved by counsel; any later version brings the notice back |

Emergency stops, none of which deletes data: all model use, redeploy inference with `JEV_PROVIDER` set to `off`;
verification, `EMAIL_ENABLED` to `false` on the verifier; employer listing, delete `INTERNAL_TOKEN` from the main
worker (`npx wrangler secret delete INTERNAL_TOKEN`), which closes `/api/employers` at once and leaves existing listings
and keys in place (it also stops `/api/directory/correct` from detaching domains until the secret is back); publication, `REAL_PUBLICATION_ENABLED` to `false` on the main worker (accepted contributions wait,
and are erased after 180 days if publication stays off).

## Rollback

- **Code.** `npx wrangler deployments list --config <config>` and `npx wrangler rollback <version-id> --config <config>`.
  Roll back the main worker first, then inference or the verifier. Migrations are forward-only and additive where
  possible, so older code usually runs on the newer schema; check the migration headers before rolling back across one.
  A rolled-back main worker serves the older release manifest, and `verify-deployment --state` flags the older release.
  Rolling the main worker back past this release also brings back the old legal pages (1.1.0), which say real-employer
  publication is paused while `REAL_PUBLICATION_ENABLED` would be `true`: set the var to match the code you roll back
  to.
- **Data.** `npx wrangler d1 time-travel restore <database> --bookmark=<bookmark>` only to recover from data loss or
  corruption. A restore brings back text that authors withdrew or that expired after the bookmark: re-run the erasure
  (withdrawals are in the append-only actions log) before reopening, and add a dated note about the restore under
  `docs/`, as for a key leak below. Restoring the public or intake database to a bookmark from before the sample purge
  brings the fictional data back: run the purge again.
- **Keys.** A leaked issuer private key lets whoever holds it sign credentials (or juror tokens) for that employer until
  the key expires. There is no revocation tooling yet: the publisher accepts every unexpired row of `trusted_issuers`,
  `expiresAt` is part of the published fingerprint (so shortening it changes the fingerprint too), provisioning
  re-inserts every live key in `.issuer-secrets.json`, and key ids are fixed per employer, quarter and purpose. The
  manual procedure:
  1. Record the key id (from `/api/proof/keys`) and its fingerprint (from the latest archive at `/archives/<id>.json`).
  2. Remove the key's entry from `.issuer-secrets.json`; otherwise every later provisioning run puts it back. (A
     community key has no entry there; the verifier database holds its only private copy.)
  3. Delete its row from `trusted_issuers` (public) and `issuer_keys` (verifier) with `npx wrangler d1 execute … --remote`.
     The public row must go: provisioning and the community key copy write public keys with `INSERT OR IGNORE`, so a
     surviving row would keep the leaked public key.
  4. If the key belongs to the current quarter, run provisioning (step 3 of the deploy order) for a curated key; for a
     community key the verifier's scheduled job creates a new one under the same id within 15 minutes, and the main
     worker's job copies it within 6 hours. A key from an earlier quarter is not replaced; that quarter's unused
     credentials stop working.
  5. Build, sign and deploy a release, then run `verify-deployment --state`.

  Unused credentials signed with the leaked key then fail verification; contributions already accepted stay. What this
  costs, and must be said publicly: archives written before the deletion keep the old fingerprint and later archives
  list the replacement (or nothing), so the transparency page's registry is no longer a complete history for that key,
  and `verify-deployment --state` does not flag a registry that shrinks or changes between archives. The product has no
  notice channel for this: add a dated note under `docs/` naming the key id, the old and new fingerprints and the reason,
  so it ships in the downloadable source bundle (`/api/source`) of the next release.

## Routine work

- **Quarterly:** provision keys (step 3), build and release; after each provisioning run the old manifest no longer lists
  the live curated keys and `verify-deployment` fails "issuer keys signed" until you release. Community keys renew
  themselves: the verifier creates each registered employer's keys for the new quarter, and the main worker copies them.
- **Ledgers:** append a legal request or a cost with the admin token (entries cannot be edited; corrections are new
  entries):

  ```bash
  curl -X POST https://shouldiworkthere.com/api/ledger/legal -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
    -d '{"received_on":"2026-10","kind":"subpoena","jurisdiction":"…","scope_summary":"…","responded":"…","data_disclosed":"…"}'
  ```

- **Correcting an employer listing.** The terms promise that a person reviews every request to correct a listing sent to
  legal@ (a wrong organization, a domain that is not the employer's, a duplicate, or a name that breaks the content
  rules), that only a person applies a correction, and that a correction changes the listing, never an account's words.
  Apply the outcome with the operator route `POST /api/directory/correct` (`worker/src/community.ts correctListing`),
  which needs `ADMIN_TOKEN`, and keep a private note of the request and your reasons (the public log records only the
  kind, the reason, the quarter and a digest of the slug):
  - Look at the listing first (public database, read-only):
    `SELECT c.id, c.slug, c.name, c.origin, d.domain, d.source, d.registered FROM companies c LEFT JOIN employer_domains d ON d.company_id=c.id WHERE c.slug='<slug>'`.
  - Send the correction. `action` is `rename` (a community listing's name; give `name`, which must pass the same name
    rules and must not mean another listing that has a domain), `detach` (the community-added domain of a community
    listing, or one someone attached to one of our listings) or `withdraw` (detach, then remove the community listing,
    only while nothing about it is published in any public table and no contribution about it is held, approved,
    publishing or published). `reason` is one of `wrong_organization`, `wrong_domain`, `duplicate`, `content_rules` or
    `legal_order`. Keep the token off the command line:

    ```bash
    read -rs ADMIN_TOKEN   # paste the token; nothing is echoed
    curl -s -X POST https://shouldiworkthere.com/api/directory/correct \
      -H @<(printf 'authorization: Bearer %s\n' "$ADMIN_TOKEN") -H 'content-type: application/json' \
      -d '{"slug":"<slug>","action":"detach","reason":"wrong_domain"}'
      # 200 {"corrected":true,"action":"detach","company":{"slug":"<slug>","name":"<name>"},"domainsDetached":["<domain>"]}
    unset ADMIN_TOKEN
    ```

    For `detach` and `withdraw` the route asks the verifier first (`DELETE /internal/employers` over the binding): the
    verifier deletes the registration and the employer's community keys and records the slug and the domain in
    `withdrawn_employers`, so neither can be registered again and no key id is reused. Only when the verifier confirms
    does the main worker delete its `employer_domains` community rows and its `trusted_issuers` community copies, which
    makes unused credentials already issued with those keys fail; accounts already accepted stay. Every applied
    correction is appended to `listing_corrections`, shown on `/transparency#listing-corrections`.
  - Refusals change nothing: 400 `invalid_request`; 401 (no or wrong token); 404 `unknown_listing`; 409
    `curated_listing` (a rename or withdrawal of one of our listings, or the verifier holds curated keys for the slug),
    `no_community_domain`, `has_published_evidence`, `has_contributions` or `name_already_listed`; 422 with a name-rule
    code; 503 `verifier_unavailable` or `verifier_refused_token` (the two workers' `INTERNAL_TOKEN` differ). One of our
    own listings' names and domains cannot be changed this way: that needs a directory migration in a release.
  - Direct takedown at the verifier (only if the main worker cannot reach it): the same `DELETE /internal/employers
    {"slug":"<slug>"}` at `https://verify.shouldiworkthere.com`, with `INTERNAL_TOKEN`. Cloudflare cannot show a
    secret's value, so rotate the token on both workers for the call (verifier first; listing answers "listing
    unavailable" in between), and keep it off the command line as above. The main worker's scheduled job then mirrors
    the takedown within 6 hours (it detaches the listing's community domain and key copies and logs it with reason
    `verifier_withdrawn`), at most 3 listings a run; when more disappear at once it skips them all as a probable verifier
    fault, so apply each with the route (`detach` is idempotent at the verifier).
  - Archives written before the correction keep the removed keys' fingerprints and later ones omit them: add a dated
    note under `docs/` naming the key ids and the reason, as for a leaked key (Rollback). `verify-deployment` passes
    "community keys agree" once the site's copies are gone.
  - Published accounts stay; beside them readers see the domains now listed. The route never removes a listing that has
    anything published or waiting.
  - Re-admitting: delete the verifier's `withdrawn_employers` row for the slug, which frees both the slug and the
    domain. To free only the slug (one of our listings whose wrong domain must stay blocked while its right domain is
    added), rename the row instead: `UPDATE withdrawn_employers SET company_slug='withdrawn-'||company_slug WHERE
    company_slug='<slug>'`. A registration in the same quarter as the takedown creates new key material under the key
    ids that were deleted, so first make sure the public copies are gone, and mention it in the dated note.
  - A report that an account under the listing breaks a content rule is a challenge, never a correction: file it
    through `/api/challenge` as described below.
- **Removals the law requires** (until trustees exist): only a valid legal order, a valid copyright notice, notice of
  content that is illegal, or an objection or erasure request the law obliges us to grant. A report that an account
  breaks a content rule, and not the law, is never a reason: file it as a challenge through the public `/api/challenge`
  route (the same route anyone uses, with the same budget and no priority), and email the reporter the receipt. For a
  required removal, act through direct database access, limited to what the law requires, append the ledger entry when
  the law allows, and keep a private note of what changed. There is no application path for this yet: a direct removal
  of the public `testimony` row leaves the author's intake row at `published`, so their status page keeps saying the
  account is published. The status page does not show such removals, and the terms say so.
- **Watching:** there are no logs by design (`observability.enabled:false`). Use `/api/transparency`,
  `/api/moderation/stats`, `/api/config`, the verifier's `/stats` and `/keys`, `verify-deployment`, and the daily budget
  rows in the public `inference_health` table (`budget:search`, `budget:live`, `budget:screen`, `budget:analysis`,
  `budget:relevance`). The day's listing count is the intake `moderation_counters` row `community_listings`; listings
  the verifier has not acknowledged yet are `employer_domains` rows with `registered=0`, which the scheduled job retries.
  The verifier's `email_budget` rows (`scope` is a community employer's slug, or `*` for all of them) show how many
  verification emails community employers used today; a slug at 40, or `*` at 1,000, means further codes for it are
  silently not sent until the next UTC day. `/api/transparency` also carries `listingCorrections` (the public correction
  log) and `verifierLink` (whether the verifier accepted the shared secret at the main worker's last scheduled check,
  and that UTC day; recorded in the intake `stats_snapshots` row `verifier_link`).

## Optional semantic retrieval (off)

Retrieval is lexical until all of these exist; do them together, and only after the privacy policy describes them
(`CODE_FACTS.semanticIndex` in `worker/src/legal.ts` switches the text, and a test checks it against the config):

1. `npx wrangler vectorize create <index> --dimensions=768 --metric=cosine` and
   `npx wrangler vectorize create-metadata-index <index> --property-name=company_id --type=string`.
2. Public migration 0007 (the `vector_index` deletion ledger) applied.
3. A `vectorize` binding named `VECTORIZE` in `inference.wrangler.jsonc`, then deploy inference.

Only published, non-identifying account text is embedded (Workers AI `@cf/baai/bge-base-en-v1.5` through AI Gateway),
with the employer id as the only metadata; a withdrawn account's vector is deleted by the sweep after each withdrawal and
hourly.

## Legal go-live checklist

1. Check that `legalLaunchBlockers()` in `worker/src/legal.ts` is empty (items marked "Launch blocker" at the top of
   `docs/legal/privacy-policy.md`). Contact mail that does not arrive blocks launch. So would 1.2.0's notice question
   (`change-notice`) if the publication code stopped keeping contributions accepted under 1.1.0 at a batch of 25
   (`worker/src/submissions.ts publishDue` and `legacyBatchMin`; `tests/safety.test.ts` pins it). The owner decided on
   2026-09-22 (D13) that the model provider's facts, the DMCA registration and the EU, EEA and UK representatives and
   assessments are not launch blockers: the pages say each is pending or not yet confirmed, and they stay on the open
   items list as owner and counsel follow-ups. Record each in `shared/brand.ts` once it exists, then regenerate.
2. `LEGAL_EFFECTIVE` in `shared/brand.ts` is the day the current version takes effect (1.2.0: September 23, 2026).
   `LEGAL_FIRST_SERVED` (September 22, 2026) is the day the pages and the covenant were first served and never moves.
   Policy 0.8.0's `retention.legacyBatch.submittedBefore` restates `LEGAL_EFFECTIVE`; the tests check they agree.
3. `LEGAL_REVIEWED_VERSION` in `shared/brand.ts` records the exact version approved by counsel; while it equals
   `LEGAL_VERSION` the pages carry no draft notice, and the next text change after the pages are served (which bumps
   `LEGAL_VERSION`) brings the notice back. For 1.2.0 it is `'1.2.0'` on the owner's statement of September 23, 2026
   that counsel had said the terms were good and that they should be published. No sign-off document is in the
   repository, and the 1.2.0 text was corrected again on September 23 after that statement (the daily email limits of
   community employers, the shared jury seat of community employers, the attach rule, the correction process, and 1.1.0
   contributions keeping their batch of 25). If counsel has not approved the text now in `docs/legal`, set it back to
   `null` before deploying. The same statement stands in for counsel's view of 1.2.0 taking effect one day after 1.1.0,
   although 1.1.0 promised 30 days' notice of material changes; if counsel finds the changes material, 1.2.0 cannot take
   effect on September 23, 2026: move `LEGAL_EFFECTIVE` to at least 30 days after the day the text is posted and keep
   this release (or at least publication in batches of 5 and listing by anyone) undeployed until then.
4. Regenerate `docs/legal`, run the tests, release and deploy.
