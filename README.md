# Should I Work There

[![CI](https://github.com/eliseorobles/shouldiworkthere/actions/workflows/ci.yml/badge.svg)](https://github.com/eliseorobles/shouldiworkthere/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[Live site](https://shouldiworkthere.com) · [Contribute](CONTRIBUTING.md) · [Self-host](docs/self-hosting.md) · [Report a vulnerability](SECURITY.md) · [Changelog](CHANGELOG.md)

An open-source, privacy-focused workplace evidence platform built with React, TypeScript, and three
Cloudflare Workers. This is preview software; see [Honest status](#honest-status) for current limitations.

### Quick start

Use Node **26.5.0** (`.node-version`) and Bun **1.4.0**. Node 24+ is required by dependencies.

```sh
git clone https://github.com/eliseorobles/shouldiworkthere.git
cd shouldiworkthere
bun install --frozen-lockfile
npm run fonts
npm run prepare:local
npm run dev
```

Open **http://localhost:8788**. Local development uses fictional evidence and generates its own keys.
No cloud credentials are needed; an optional TypeSafe key enables hosted understanding. Rebuild browser
changes with `npm run build:local`, and stop the stack with `npm run dev:stop`.

![Project overview graphic](web/og/home.jpg)

## Overview

Institutional memory about workplaces. Contributors can prove they had access to a work mailbox without revealing who
they are, and every number on the site opens to the question wording, sample size, period and verification method
behind it. The product brief is [`docs/product-principles.md`](docs/product-principles.md); this file describes the code
as it is.

Live site: https://shouldiworkthere.com (verifier: https://verify.shouldiworkthere.com). It is still labeled a preview.
The release of September 23, 2026 opens it to the public: accounts about real employers are published (written accounts
in batches of at least 5 per employer and verification type, questionnaire figures only for groups of at least 25),
real-employer juries are switched on and form when enough jurors can serve, anyone can add an employer with its
work-email domain, and production shows no fictional data. Three fictional sample employers (Northwind Labs, Helios
Semiconductor, Meridian Retail Group) exist only in local development and tests (`SAMPLE_EMPLOYERS=on`), labeled as
such wherever they appear.

## What it does

- **Ask.** One input. Jev, a classification model, turns a question into typed decisions with probabilities (employer,
  comparison, group, period, event, topic, view, route). Deterministic code and SQL compute every number shown. Answers
  are fixed sentences filled in with released numbers; no model writes prose for the site. Uncertain readings appear as
  editable chips and confidence forks. Live understanding is on by default and starts off under Global Privacy Control.
- **Evidence.** Published accounts are immutable. Jev records narrow descriptive readings of them (topics, six
  workplace dimensions, specificity), which are labeled as model readings and never counted as votes. Written accounts
  are released in batches of at least 5 after screening and a random 12–72-hour delay; questionnaire results are
  released only as aggregates of at least 25 answers.
- **Proof.** A separate verifier checks control of a work mailbox and blind-signs a credential the browser prepared
  (RFC 9474 blind RSA). The publisher verifies the signature offline and never learns the mailbox; the verifier never
  sees the contribution. Requests for a code, for juror tokens and for a new listing carry a proof of work the browser
  computes in a Web Worker (`shared/pow.ts`); it makes floods costly and carries nothing about the person.
- **Directory.** Curated employers, plus employers anyone adds by name and work-email domain (`worker/src/community.ts`).
  A community listing shows its domain beside the name and is labeled as added by the community. The domain must be a
  real host with mail records, not a free or disposable provider, not already listed and not named after another listed
  employer, and it must carry the name (a word of it, the whole name or its initials) or Jev must read it as at least
  30% plausible for that name (`shared/domains.ts`); a name that means an employer already listed with a domain is
  refused, and Jev checks that the name is an organization's and that neither the name nor the domain is abusive. A
  domain is attached to one of our own listings that has none only when Jev judges it at least 85% likely to be that
  employer's corporate domain and the domain's registrable label is exactly a significant word of its name or alias, or
  the name written as one word or hyphenated (`sharesSignificantToken`). The verifier holds the domain registry and
  creates the employer's keys on demand; they are served as community keys, which no release can pin, so the browser
  accepts one only when the site's and the verifier's copies agree exactly. A wrong listing is corrected by the operator
  on request through `POST /api/directory/correct` (`ADMIN_TOKEN`), and every correction is logged publicly.
- **Constitutional moderation.** Jev answers narrow policy questions; a published, versioned policy
  (`shared/policy.ts`, served at `/moderation/current.json`) decides clear, repair or jury. There is no moderator
  dashboard and no delete button in the application. Until the trustee process exists, the operator acts on valid legal
  orders and other removals the law requires through direct database access, and the legal pages and `/moderation` say
  so. A report that an account breaks a content rule, and not the law, goes through the public challenge process, never
  through that access.

## Architecture

Three Cloudflare Workers in one Cloudflare account, each with only its own secrets:

| Worker | Config | Entry | Public address | Databases | Holds |
|---|---|---|---|---|---|
| Main (publisher, site and API) | `wrangler.jsonc` | `worker/src/index.ts` → `worker/src/app.ts` | shouldiworkthere.com | `DB` (public), `INTAKE` (private) | `RATE_LIMIT_SECRET`, `INTERNAL_TOKEN`, `ADMIN_TOKEN`, optional `INFERENCE_CALLER_SECRET` and `TRUSTEE_KEYS` |
| Inference (Jev) | `inference.wrangler.jsonc` | `worker/inference.ts` → `worker/inference-core.ts` | none (`workers_dev:false`, no routes) | `DB` (public, for budgets and readings) | `TYPESAFE_API_KEY`, the Workers AI binding, optional `INFERENCE_CALLER_SECRET` |
| Verifier (issuer) | `issuer.wrangler.jsonc` | `worker/issuer.ts` | verify.shouldiworkthere.com | `VERIFIER` | `ISSUER_MASTER_KEY`, `MAILBOX_PEPPER`, `INTERNAL_TOKEN`, the email binding |

- The main worker reaches inference through a service binding (`INFERENCE`) and the verifier through another
  (`VERIFIER`). The `VERIFIER` binding carries only the registration of a newly listed employer's domain, the takedown
  of a community domain when the operator corrects a listing, a check that the verifier accepts the shared secret (all
  three authenticated with `INTERNAL_TOKEN`, which both workers hold) and reads of the verifier's public
  `/keys?source=community`, so the publisher can copy community keys (when a listing is added and every 6 hours); the
  main worker never sees an email address and never calls the verifier to check a credential. The browser talks to the verifier directly (CSP
  `connect-src` names only that origin).
- A Worker entry module may export only its default handler (workerd treats named exports as entrypoints), so
  `index.ts` and `inference.ts` are two-line re-exports; `tests/entry.test.ts` enforces this.
- Jev runs on Cloudflare Workers AI (`typesafe/jev`) through AI Gateway `default` with logging and caching off, with the
  TypeSafe HTTP API as a labeled fallback (`worker/src/ai.ts`). Daily model-call budgets per purpose live in
  `worker/inference-core.ts` (about 100,000 a day: search 45,000, which also pays for listing checks; live 45,000;
  screening 5,000; analysis 4,000; challenge relevance 1,000).
- Launch switches are read in one place, `worker/src/flags.ts` (fictional employers, the written-account batch, the
  aggregate minimum).
- Scheduled work: main every 6 hours (publication and erasure housekeeping, moderation housekeeping, daily-digest purge,
  community listing registration and key copy, transparency archive to R2), inference hourly (analysis backfill),
  verifier every 15 minutes (expired challenges, quotas, counts, pauses, keys, and community keys for a new quarter).

```
worker/src/app.ts          main worker: routes, canvas API, security headers, scheduled steps
worker/src/interpretation.ts, jev.ts, evidence.ts   interpretation, route choice, evidence compiler, answers
worker/src/submissions.ts  intake, screening decisions, delayed batched publication, erasure, withdrawal
worker/src/moderation.ts   challenges, juries, appeals, trustee exceptions, receipts, moderation statistics
worker/src/community.ts    employer listing by anyone: checks, MX lookup, verifier registration, community key copy
worker/src/flags.ts        launch switches read from Worker vars
worker/src/credentials.ts  offline verification of credentials and juror tokens
worker/src/ledger.ts       public counts, finance and legal ledgers, transparency archives (Merkle roots)
worker/src/release.ts      serves the signed release manifest at /.well-known/siwt-release.json
worker/src/legal.ts        privacy policy, terms, accessibility statement (one source for live pages and docs/legal)
worker/src/pages.ts        server-rendered trust pages (covenant, moderation, transparency, legal requests, source, finances)
worker/inference-core.ts   Jev calls: intent, rank, screen, relevance, analysis, employer checks, optional retrieval
worker/issuer.ts           verifier: mailbox codes, blind signing, issuance limits, domain registry, /keys and /stats
shared/                    code used by browser and workers: proof protocol, proof of work, domain rules, policy, privacy detector, crisis lexicon, brand
web/                       React client (canvas, contribution flow, adding an employer, jury, status)
db/                        public, intake and verifier schemas and numbered migrations; db/seed.sql (local only)
tools/                     build, local stack, migrations, key provisioning, sample purge, release signing, deployment watcher, eval
tests/                     unit and integration tests (node --test), Playwright browser specs
docs/                      principles, protocol, threat model, moderation, operations, roadmap, evaluation, legal review copies
```

## Local development

Requirements: Node 24 or later (26.5.0 is pinned in `.node-version` and CI), [Bun](https://bun.sh) 1.4.0
for the committed lockfile and `bunx`. The tools and tests run `.ts` files directly and use `node:sqlite`.

```bash
bun install --frozen-lockfile
node tools/fonts.mjs              # once: self-hosted fonts
node tools/prepare-local.mjs      # env files per worker, local D1 migrations, local seed, locally sealed issuer keys
node tools/dev.mjs                # three local workers: main :8788, inference :8789, verifier :8790
node tools/build.mjs --local      # after any change under web/ or shared/ (wrangler dev hot-reloads worker code)
```

- `prepare-local` writes `.dev.vars.main` (`SAMPLE_EMPLOYERS=on`, a local `RATE_LIMIT_SECRET` and `INTERNAL_TOKEN`),
  `.dev.vars.inference` (`JEV_PROVIDER=typesafe` and `TYPESAFE_API_KEY` from `.env` or the shell, kept if already
  present) and `.dev.vars.verifier` (local `ISSUER_MASTER_KEY`, `MAILBOX_PEPPER` and the same `INTERNAL_TOKEN`). Each
  worker loads only its own file; `dev.mjs` refuses to start a worker whose file holds another worker's secret, or an
  inference file that would call the billable Workers AI binding.
- Without a TypeSafe key, hosted Jev is unavailable locally and the site runs in its degraded mode (manual controls and
  exact employer names still work; adding an employer answers "checks unavailable").
- `node tools/dev.mjs --restart` stops the three local workers and starts them again. Logs are in
  `.wrangler/local-{main,inference,verifier}.log`; each worker's cron can be triggered at `/__scheduled`.
- `db/seed.sql` deletes and replaces public rows. It is applied only locally, only to an empty database, and never
  remotely (`tools/db.mjs` refuses). It holds the fictional sample employers, which production never shows.
- Open Graph images: `node tools/og.mjs` (needs Playwright's Chromium; it reads its thresholds from `shared/policy.ts`)
  renders `web/og/*.jpg` when directory employers change; then run `node tools/build.mjs` and commit the images.
- Page addresses carry only public, typed identifiers: `/c/<employer>` plus `view`, `vs`, `topic`, `cohort`, `event`,
  `layer`, `time`, `sector`, `pref` and `faq`. Question text never enters a URL; it stays in the tab's `history.state`.
  A group or sector that nothing publishes is dropped from a link when it loads.

## Tests

```bash
npx tsc --noEmit                       # typecheck
node --test "tests/*.test.ts"          # unit, API, moderation, publication, protocol, transparency and legal tests
node tools/build.mjs --local && npx playwright test   # browser specs; start the local stack first
node tests/integration.mjs             # live-stack suite against http://localhost:8788
node tools/eval-intents.mjs            # live Jev intent evaluation (needs the TypeSafe key); results in docs/evaluation.md
```

`tests/safety.test.ts` also checks that the legal pages match the code: numbers are read from `shared/policy.ts`,
`shared/pow.ts`, `worker/src/community.ts` and `worker/inference-core.ts` and checked against their sources, switches
follow the Wrangler configs and `worker/src/flags.ts`, and `docs/legal/*.md` must equal what `worker/src/legal.ts`
renders for the production configuration.

## Release and deploy

Nothing deploys automatically. The order matters because the main worker binds inference and the verifier and reads
tables that migrations add ([`docs/operations.md`](docs/operations.md) has the full runbook, with rollback, and the
exact steps for the launch release of September 23, 2026: the legal gate, the shared `INTERNAL_TOKEN`, the sample
purge and the verifier's sandbox keys):

0. **Legal gate.** `legalLaunchBlockers()` in `worker/src/legal.ts` must be empty. For the launch release it is:
   contact mail arrives, `LEGAL_REVIEWED_VERSION` is `'1.2.0'` on the owner's statement that counsel approved the terms
   (set it back to `null` if that is not so for the text in `docs/legal`), and contributions accepted under 1.1.0 keep
   the batch of 25 in code (`publishDue`, `legacyBatchMin`).
1. **Check and migrate.** Record a D1 Time Travel bookmark (`npm run db:bookmarks` prints all three) and row counts
   first (`docs/operations.md`). `node tools/db.mjs remote` prints each pending migration's header and refuses a
   migration that changes existing rows unless `--accept-row-changes` is given (and verifier 0001 also needs
   `--accept-legacy-quota-reset` when legacy rows exist). The launch release adds public 0010 and 0011 and verifier
   0005 and 0006, all additive. `node tools/db.mjs check remote --for=main` is the read-only gate before a deploy.
2. **Secrets.** The same `INTERNAL_TOKEN` on both workers (verifier first), and `RATE_LIMIT_SECRET` and `ADMIN_TOKEN`
   on the main worker.
3. **Zero data.** `node tools/purge-samples.mjs --remote --all-intake` is a dry run; `--apply --all-intake --no-export
   --bookmark=<public bookmark>` removes the fictional employers from the public and intake databases, their sandbox
   keys and challenges from the verifier database, and the pre-launch intake test records, keeping real (work-mailbox)
   contributions unless `--include-real-contributions` is passed. It never touches a real employer's row or a
   migration table.
4. **Keys.** `ISSUER_MASTER_KEY=… node tools/provision-issuer.mjs --remote --no-samples` (add `--next-quarter` before a
   quarter starts) creates the quarter's curated contribution and juror keys, drops every sandbox key, and writes
   `db/issuer-public-keys.json`, which the release signs. Community keys are created by the verifier itself.
5. **Build and sign the main worker:** `node tools/build.mjs`, then `node tools/transparency.mjs` (add `--init-key` the
   first time; it refuses if any signed source changed since the build), and commit the new
   `docs/releases/<date>-<hash>.json`. A release build refuses while the production registry lists sandbox keys and
   `SAMPLE_EMPLOYERS` is not `on`, or while `VERIFIER_ORIGIN` is not the verifier the client pins.
6. **Deploy the verifier, then inference, then main:** `npx wrangler deploy --config issuer.wrangler.jsonc`,
   `npx wrangler deploy --config inference.wrangler.jsonc`, then `npx wrangler deploy`. `npm run deploy` runs the build,
   signing and deploy commands for the main worker only; commit the release record yourself.
7. **Verify:** `node tools/verify-deployment.mjs --state=.siwt-watch-state.json`, and keep the state file. It also checks
   that fictional employers are hidden and neither host serves a sandbox key, that listing is open, that the verifier
   accepted the shared secret at the main worker's last scheduled check, and that every community key is identical on
   the site and the verifier.
8. **Check the zone as a browser** (`docs/operations.md`, step 8). Cloudflare adds its Web Analytics beacon only to
   pages it serves to browsers, so request pages with a browser `User-Agent`: no injected script, no `nel`,
   `report-to` or `set-cookie` header, and `http://` redirecting to `https://` on both hosts. Web Analytics automatic
   setup, Network Error Logging, Email Address Obfuscation, Rocket Loader, Zaraz, and Bot Fight Mode and JavaScript
   detections must be off for the zone, and Always Use HTTPS on.

`npm run deploy:all` chains bookmarks, migrate, inference, verifier, main and verify. It prints the D1 bookmarks but
records no row counts, and it cannot pass the acceptance flags, set secrets, purge sample data or provision keys; use
the steps above when a migration changes rows and for the launch release.

### Secrets

| Worker | Secret | Purpose |
|---|---|---|
| Main | `RATE_LIMIT_SECRET` (32 random bytes; required) | Keys rate-limit hashes, jury seat groups and daily network records. Without it, challenges and employer listing are closed and FAQ interest is not counted. |
| Main and verifier | `INTERNAL_TOKEN` (the same value on both, at least 32 characters; required) | Authenticates the main worker's registration of a newly listed employer's domain at the verifier, the takedown of a community domain on correction, and the scheduled link check. Without it, employer listing is closed and corrections cannot reach the verifier. |
| Main | `ADMIN_TOKEN` (required) | Applies listing corrections (`POST /api/directory/correct`) and appends to the finance and legal-request ledgers (`POST /api/ledger/*`). Nothing else. |
| Main and inference | `INFERENCE_CALLER_SECRET` (optional) | When set, inference answers only calls that carry it. Set it on the main worker first. |
| Main | `TRUSTEE_KEYS` (leave unset) | Two-of-three trustee exceptions. Unset: `/api/exception` answers 503. |
| Inference | `TYPESAFE_API_KEY` | The TypeSafe fallback; the Workers AI path uses the key stored in AI Gateway (BYOK). |
| Verifier | `ISSUER_MASTER_KEY` | AES-256-GCM key that seals the issuer private keys, curated and community, in the verifier database. |
| Verifier | `MAILBOX_PEPPER` | HMAC key for mailbox, code, throttle and limiter hashes. |

Set them with `npx wrangler secret put NAME --config <config>`. Only `INTERNAL_TOKEN` (and the optional
`INFERENCE_CALLER_SECRET`) is shared between two workers; no other secret is held by more than one.

### Switches

| Switch | Where, production value | Effect |
|---|---|---|
| `SAMPLE_EMPLOYERS` | main var, `"off"` | Only `on` (local and tests) shows the fictional employers and their practice juries; anything else hides them everywhere. |
| `SAMPLE_EMPLOYERS` | verifier var, `"off"` | Only `on` lists the fictional employers' sandbox keys at `/keys` and `/stats` and signs with them; keep it equal to the main worker's value. |
| `REAL_PUBLICATION_ENABLED` | main var, `"true"` | Real-employer accounts publish in batches. Off: they are held and erased after 180 days unless published. |
| `TESTIMONY_BATCH_MIN` | main var, `"5"` | Written accounts per batch, per employer and verification type (never below the policy's minimum). |
| `MIN_COHORT_N` | main var, `"25"` | Minimum group and answer count for questionnaire figures (never below the policy's minimum). |
| `JURY_ENABLED` | main var, `"true"` | Real-employer juries, which form only when juror keys of enough other employers are live. |
| `CRISIS_RESOURCES_ENABLED` | main var, `"true"` | The publisher's crisis phrase check adds support resources to the asker's own reply. |
| `POW_BITS` | verifier var, `"20"` (main: unset, 20) | Proof-of-work difficulty in leading zero bits, clamped to 8–32. |
| `SELF_HARM_SCREENING` | inference var, `"true"` | Screening asks Jev one optional self-harm question, used only to offer resources. |
| `JEV_PROVIDER`, `JEV_FALLBACK`, `JEV_GATEWAY_ID` | inference vars | Workers AI primary, TypeSafe fallback, AI Gateway id. |
| `EMAIL_ENABLED` | verifier var | Mailbox codes; off makes `/start` answer 503. |
| `TRUSTEE_KEYS` | main secret | Presence enables trustee exceptions. |
| `CRISIS_CARD_ENABLED`, `LEGAL_REVIEWED_VERSION`, `SERVES_EU_UK` | `shared/safety.ts`, `shared/brand.ts` | On-device crisis card; the legal version recorded as approved by counsel (`'1.2.0'`, on the owner's statement; the draft notice shows whenever it differs from `LEGAL_VERSION`); the EU/UK legal sections. |

Legal text reads these switches (`legalConfig`), so changing one changes what the privacy policy and terms say; the
tests pin the review copies to the Wrangler configs.

## Documentation

- [`docs/product-principles.md`](docs/product-principles.md): the product brief.
- [`docs/protocol-poewi.md`](docs/protocol-poewi.md): proof of employment without identity (blind RSA credentials,
  juror tokens, curated and community keys, key consistency, proof of work, limits).
- [`docs/threat-model.md`](docs/threat-model.md): who can learn what, and what the design does not stop.
- [`docs/constitutional-moderation.md`](docs/constitutional-moderation.md): the executable policy, juries, challenges,
  exceptions and statistics.
- [`docs/operations.md`](docs/operations.md): deploy order, the launch release, secrets, switches, sample purge,
  listing corrections, rollback, verification, legal go-live.
- [`docs/hardening-roadmap.md`](docs/hardening-roadmap.md): OHTTP, DKIM proofs, onion service, transparency logs,
  independent operation, trustees and audit.
- [`docs/demo.md`](docs/demo.md): two reproducible demo flows (local, with the fictional employers) and what they show.
- [`docs/evaluation.md`](docs/evaluation.md): live Jev intent evaluation.
- [`docs/legal/`](docs/legal): review copies of the privacy policy, terms and accessibility statement, generated from
  `worker/src/legal.ts` for the production configuration.

## Honest status

- Mailbox verification proves control of a mailbox at an employer's listed domain at verification time, not identity,
  job title, current employment or one person per contribution. For an employer added by the community, the domain was
  supplied by whoever added the listing and checked only automatically, so accounts under it show control of that
  domain's mail, not that the domain belongs to the employer named; listings show the domain so readers can judge.
- The three services are separated in code, databases and secrets, but they run in one Cloudflare account under one
  operator. The signed release manifest shows what is served, not what executes, and it cannot cover community keys,
  which are created after the release; those are checked only for agreement between the site and the verifier.
- A batch of 5 hides an author among fewer accounts than the previous 25; the local checks and the random delay matter
  more for small employers.
- Real-employer juries are switched on; a case goes to a jury only when curated juror keys of at least 3 other
  employers are live (4 for an appeal), and token holders are not proven unique people. Anyone who controls a domain
  can list it and obtain juror tokens, so all tokens of employers added by the community together fill at most one seat
  on a case and never count toward forming a jury (policy 0.8.0). Production has no practice juries.
- Written accounts accepted before September 23, 2026 (legal version 1.1.0) keep that version's rule: they are
  published only in batches of at least 25 such accounts per employer, reporting period and verification type.
- Moderation thresholds are provisional and have not been evaluated on labeled cases.
- The legal pages (version 1.2.0) carry no draft notice because `LEGAL_REVIEWED_VERSION` is `'1.2.0'`, set on the
  owner's statement of September 23, 2026 that counsel had approved the terms. No sign-off document is in this
  repository, and the 1.2.0 text was corrected again after that statement; open owner and counsel items are listed in
  the header of each file in `docs/legal`. Nothing blocks launch (`legalLaunchBlockers()` is empty). By the owner's
  decision, TypeSafe's facts, the DMCA registration and the EU, EEA and UK representatives and assessments are
  follow-ups that the pages describe as pending.
- Verification emails for community employers have a daily budget (40 per employer, 1,000 in total), so anyone can use
  up an employer's emails for the day and its staff's codes may not arrive until the next UTC day. A wrong listing is
  corrected only when someone asks (legal@) and the operator applies it with `POST /api/directory/correct`, which takes
  the community domain down at the verifier and deletes the publisher's key copies; each correction is logged at
  `/transparency#listing-corrections`. Someone has to read legal@ for that to happen.

Original code is MIT licensed (`LICENSE`). Cloudflare's blind-signature library is Apache-2.0.

Full runtime dependency notices are in [`licenses/`](licenses/) and their scope is explained in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). The code license does not grant rights to user
submissions or production data. See [`TRADEMARKS.md`](TRADEMARKS.md) when naming a fork.

## Contributing and releases

Start with [`CONTRIBUTING.md`](CONTRIBUTING.md), the [community code](CODE_OF_CONDUCT.md), and the
[open issues](https://github.com/eliseorobles/shouldiworkthere/issues). Use synthetic examples in reports.
Security issues have a [private reporting channel](SECURITY.md).

[`public-source.json`](public-source.json) is the exact reviewed publication manifest. Builds package
only its text files for `/api/source`; adding local documents does not automatically publish them.
CI checks the manifest, runtime notices, tests, and secrets. Release procedures are in
[`docs/open-source-release.md`](docs/open-source-release.md).
