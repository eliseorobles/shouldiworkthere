# Threat model

Written for the person deciding whether to contribute, and for the person deciding whether to trust a number. Every
mitigation below names the code that implements it. The residual risks that concern people's data are also stated in
the privacy policy and terms; the rest are here and in [hardening-roadmap.md](hardening-roadmap.md). Nothing here is an
anonymity guarantee.

## What is protected

1. **Who wrote an account.** The link between a person (their mailbox, device, network) and a published or held
   contribution.
2. **Unpublished words.** Drafts, held cases and revisions.
3. **The integrity of the record.** That numbers, accounts, keys and policy are what the operator says they are, and
   that no organization can quietly remove or shape them.

## Assets and where they live

| Data | Where | Who can read it |
|---|---|---|
| Drafts, local findings | The author's browser memory | The device (and extensions) |
| Opt-in signing key, proof, juror tokens, unfinished verification | Browser IndexedDB (`siwt-device`) | The device profile, including a managing employer |
| Work email address | Verifier memory; Cloudflare email delivery records (up to 30 days) | Operator's Cloudflare account; the mailbox's readers |
| Keyed mailbox hashes, code records, quotas, issuance counts | Verifier D1 | The operator (who holds `MAILBOX_PEPPER`) |
| Held and waiting contributions, answers, author public keys, capability hashes, decision log | Intake D1 | The operator |
| Published accounts, releases, readings, counts | Public D1, R2 archives | Everyone |
| Approved drafts, questions, published text, names and domains of new listings | Sent to the inference worker and to TypeSafe (Jev) | The operator's inference worker; TypeSafe, whose retention is not yet confirmed |
| Employer listings added by the community (name, domain, community label, time added) | Public D1; the domain, its registration quarter and the employer's community keys in verifier D1 | Everyone (the listing); the operator (the keys) |
| Daily network records for challenges and listing attempts (HMAC of day, purpose and address digest) | Intake D1, until the UTC day ends | The operator (who holds `RATE_LIMIT_SECRET`) |
| Daily verification-email counts for community employers (day, employer slug or `*`, count; no mailbox) | Verifier D1 (`email_budget`), today and yesterday only | The operator |
| Takedown records of community registrations (slug, domain, quarter; no person) | Verifier D1 (`withdrawn_employers`), no fixed limit | The operator |

The main worker has no binding to the verifier database; its `VERIFIER` service binding reaches only the verifier's
internal registration route (authenticated with `INTERNAL_TOKEN`) and its public `/keys`. The verifier never reads the
public database (`tests/protocol.test.ts`); inference has no public address; logging is off for all three workers
(`observability.enabled:false`, checked in `tests/safety.test.ts`).

## Adversaries

### 1. The employer

**Wants:** to identify a contributor, suppress or counter an account, or learn what is coming.

**Can:** read and monitor company mailboxes and managed devices, correlate departures and timing, request codes for any
employee's address, flood the verifier, challenge accounts, send legal process, and (if it controls many mailboxes) try
to astroturf.

**Mitigations:**
- The verifier sends one identical email (same sender, subject and body with a fresh code) whether or not a mailbox
  already holds a credential or juror tokens, and `/start` never reads the quotas (`worker/issuer.ts`). A mail gateway,
  and Cloudflare's delivery log, learn only that a code was requested.
- Blind signatures: the verifier cannot recognize the credential it signed (`shared/proof.ts`). The publisher never sees
  the mailbox.
- Publication is delayed 12 to 72 hours at random, rounded to 6-hour boundaries, and happens only in batches of at least
  5 per employer and verification type (policy 0.8.0, `TESTIMONY_BATCH_MIN`); published dates are quarter-precision
  (`worker/src/submissions.ts`). Questionnaire figures need groups and answers of at least 25.
- Local detectors flag names, contact details, exact dates, narrow locations, unique roles and small teams before
  anything leaves the device (`shared/privacy.ts`); direct identifiers are refused again by the server before storage or
  inference, and re-scanned at publication.
- No employer accounts, no paid priority, no special route. Challenges are equal for everyone, must cite a published
  rule, and reputational discomfort is not a ground (`worker/src/moderation.ts`, `shared/policy.ts`).
- Issuance caps and a 24-hour velocity breaker per employer bound astroturfing (`ISSUANCE_POLICY`).

**Residual risks:**
- A batch of 5 is a small crowd. An employer that knows which few people contributed around the same time (for
  example, because it saw their codes arrive) learns that each of them wrote one of those five accounts, and a telling
  detail can then single one out. Before the launch of September 23, 2026 the batch was 25.
- Anyone who reads a mailbox sees that a code was requested for it. Whoever uses the code learns whether that mailbox
  can still obtain a credential this quarter. Requesting codes for many employees is possible (3 emails per mailbox per
  15 minutes), and so is delaying someone's codes.
- A managed device can reveal a kept key, proof or token, and browser extensions can read the page.
- A small team plus a telling detail can identify an author even after the checks. The meter counts only what the
  detectors recognize.
- An employer controlling many mailboxes can use up its own cap or keep pausing issuance; a legitimate surge also trips
  the pause.
- Because anyone can add an employer with its domain, anyone can make the verifier email codes to almost any
  organization's addresses (one listing per domain). Proof of work, 3 emails per mailbox per 15 minutes, the per-hour
  limiters and a daily email budget for community employers (40 per employer and 1,000 for all of them together per
  UTC day, `COMMUNITY_EMAIL_LIMITS`) make this costly and bounded, not impossible; the emails name the service, so
  recipients learn that someone asked. The same budget lets anyone use up a community employer's emails for the day,
  which silently delays codes for its staff until the next UTC day.

### 2. The operator, or anyone who controls the Cloudflare account

**Wants (dishonest case):** to learn who wrote what, to remove or shape accounts, or to serve different code to some
visitors.

**Can:** change and redeploy any worker, add logging, read all three databases, restore D1 history (30 days), read
Cloudflare email delivery records, and serve a tagging issuer key.

**Mitigations:**
- Separation by service, database and secret, with no stored join between verifier and publisher records. Capabilities
  are stored only as hashes; the verifier holds only keyed hashes.
- No moderation endpoint: the application has no approve, edit, release or delete action (`/api/admin/*` answers 410).
  Removal outside the published rules requires two of three trustee signatures bound to the deployment origin, a public
  exception log entry written before anything is withheld, and an expiry. That process is off (no `TRUSTEE_KEYS`), and
  until it exists the operator acts on legal orders and other removals the law requires through direct database access,
  which the legal pages disclose. Reports that an account breaks a content rule, and not the law, go through the public
  challenge process (the operator can file one for a reporter, with the same budget and no priority), never through
  that access. Residual: a direct removal leaves the author's intake row at `published`, so their status page is wrong
  until an application path withholds through the same code as a challenge.
- Every decision pins the policy version and digest; every policy version stays published at
  `/moderation/v{version}.json`; decision records are append-only (database triggers).
- A signed release manifest (`tools/transparency.mjs`, `/.well-known/siwt-release.json`) covers the served client, every
  worker, shared, database and config source file, the lockfile, every live issuer key and the policy. Transparency
  archives chain by digest and carry RFC 6962 Merkle roots over published accounts and metric releases and the full
  issuer key registry. `tools/verify-deployment.mjs --state=<file>` checks all of it from outside and remembers history,
  so a rewrite of archives it has seen fails.
- The browser blinds only against a key that the publisher and the verifier describe identically and that is in the
  registry the build pinned; it shows the key fingerprint for comparison across devices. A community key (created by
  the verifier for an employer listed after the release) cannot be pinned: the browser accepts one only when the two
  services' copies agree member for member, labels it as added after this release, and `verify-deployment` checks every
  community key the site publishes against the verifier's. The publisher copies community keys into its key registry,
  so transparency archives list them too.

**Residual risks:** all three services share one account, so this is separation, not independent
custody. The issuer private keys are also kept on the machine that provisions them (`.issuer-secrets.json`), so whoever
holds that file or the verifier secrets can mint credentials and juror tokens that no check here would reject. A leaked
key can only be deleted, not revoked: later archives then omit it, and `verify-deployment --state` does not flag a key
that disappears ([operations.md](operations.md), Rollback). The manifest shows what is served, not what executes; there
is one release key and no rotation process. A consistent rewrite of all archives is detectable only by someone who kept
copies. Timing correlation between the
verifier's request metadata and publication remains possible for someone who holds both. No submission triggers a
request to the verifier: the publisher checks a credential against its own copy of the key
(`worker/src/credentials.ts`), and copies community keys only when a listing is added and from its six-hourly job
(`worker/src/community.ts`), so a new quarter's community key is usable from the next copy on, and until then the
previous quarter's key, live through its grace quarter, keeps working. Community keys are not pinned by any release, so
an operator could create one to tag a single visitor as long as both services serve it; only people who compare the
keys they were offered, or the archived registry, would notice. D1 Time Travel keeps erased data recoverable for 30
days, and a court could order recovery. See [hardening-roadmap.md](hardening-roadmap.md).

### 3. The model provider (TypeSafe) and Cloudflare

**Receives:** approved drafts (after explicit consent), questions, published text, masked challenge reasons, and the
name and domain of every new listing (TypeSafe); all traffic, IP addresses, request metadata, email delivery records and
the DNS-over-HTTPS lookups of listed domains' mail records (Cloudflare).

**Mitigations:** direct identifiers are refused before any model call; drafts are sent only after the author approves
the local findings and consents; AI Gateway requests set logging off and skip the cache; no email, credential, token,
capability or IP address is sent to Jev (`tests/privacy.test.ts`, `tests/acceptance.test.ts`).

**Residual:** TypeSafe's legal entity, location, retention, training use and data processing agreement are not yet
confirmed; the privacy policy tells people to assume it may keep what it receives. Cloudflare keeps its own operational
records.

### 4. Other contributors and jurors

**Wants:** to identify a colleague, run a coordinated campaign, or capture juries.

**Mitigations:**
- Contextual re-identification is one of the screening questions (PRIV-05); personal attacks are returned for repair
  when clear (ABUSE-02).
- Clusters of "potentially related" accounts need at least 5 independent sources whose pairs were judged to describe the
  same event and not to be copies; clusters show similarity, not truth.
- Each mailbox gets one credential per employer and quarter and one set of at most 3 juror tokens; tokens of one real
  employer fill at most 2 seats on a case; all tokens of employers added by the community (including a domain someone
  attached to one of our listings) share one seat group and fill at most 1 seat on a case, whichever listing they name,
  and those employers never count toward whether a jury can form (policy 0.8.0, `worker/src/moderation.ts`);
  work-mailbox jurors never sit on cases about their own employer; appeals use 9 new jurors who are not told it is an
  appeal or what the first result was.

**Residual:** a person with several mailboxes has several credentials and tokens, and someone who controls a domain
can list an employer with it and obtain credentials and juror tokens for as many mailboxes as the community caps allow
(50 credentials and 50 juror tokens a quarter; see "8. Someone adding employers"), but however many domains they list,
their tokens hold at most one seat of a 7-seat jury (one of 9 on appeal), so they cannot decide a case alone. Juries
for real employers are switched on and form only when curated juror keys of at least 3 other employers are live (4 for
an appeal). Sandbox
(fictional-employer) tokens exist only where fictional employers are shown (`SAMPLE_EMPLOYERS=on`, never in
production); there they are free, have no seat limit and may staff a case about the fictional employer they name, so
practice juries are not Sybil-resistant and only demonstrate the procedure.

### 5. Challengers and brigades

**Mitigations:** a relevant challenge re-checks the published words at most once per account and policy version, and a
jury decision on a rule is final for those words until the policy changes; challenges need `RATE_LIMIT_SECRET` and are
limited to 5 per network per UTC day (an IPv6 client counts as its /64; a reason that does not fit the rule costs 2
more), plus a per-minute limiter; hosted relevance checks (1,000 a day) and re-checks (100 a day) have separate daily caps, with 50 more
re-checks reserved for the privacy and safety rules; a challenger learns only that an account was
withheld under the published rules, never which rule or finding. Seeded fictional accounts (shown only where
`SAMPLE_EMPLOYERS=on`, never in production) cannot be withheld by a challenge or a jury.

**Residual:** many networks can spend the day's re-checks (100, plus 50 for the privacy and safety rules); relevant
challenges are then queued, not refused, and re-checked by the scheduled job as capacity returns, privacy and safety
first, while the accounts stay published (fails safe for authors). A flood of relevant challenges against many different
accounts can therefore delay a genuine privacy challenge behind others of the same kind. The daily network record is an HMAC of the day, purpose and an address digest,
stored until the day ends. For challenges the purpose is only `challenge`. For opt-in FAQ interest it is
`interest:<employer id>:<standard question id>`, so whoever holds `RATE_LIMIT_SECRET` can test whether a guessed address
shared interest in a given question about a given employer that day (the directory's employers times a small set of
question specs is a small space to search), and the deleted rows stay in D1 recovery history for 30 days. The privacy
policy says so.

### 6. Readers who need to trust a number

**Mitigations:** every metric opens to its question wording, group, n, period, verification method, exclusions and
release; aggregates need 25 answers and are re-released only after 5 changes; answers are fixed templates over released
numbers; counts of written accounts from 1 to 4 are never stated; model readings are labeled and never counted as votes;
production shows no fictional employers (where they are shown, locally, they are labeled everywhere); real employers
without evidence show an honest empty state; community listings show their domain beside the name, and a work-mailbox
verified account shows the employer's listed domains.

**Residual:** thresholds limit but do not prevent inference by someone who controls several changes to a group. A
reader who does not check the domain beside a community listing can mistake accounts from a lookalike domain for
accounts from the employer's staff.

### 7. Legal process

**Mitigations:** the privacy policy lists exactly what each service holds; the publisher holds no names, accounts or
stored email addresses; the legal requests ledger and the exception log are append-only and public when the law allows.

**Residual:** given an email address, the verifier's records show whether that mailbox obtained a credential this
quarter, and Cloudflare's records show when codes were sent (30 days). Given a capability, the intake record shows the
employer and quarters of the contribution for about 12 months after withdrawal or expiry. A court could order recovery
from D1 Time Travel within 30 days.

### 8. Someone adding employers

**Wants:** to make accounts appear to come from an employer's staff, to attach a domain they control to a well-known
employer, to fill the directory with spam or insults, or to use listings to make the verifier email people.

**Can:** list any organization with any domain that has mail records and is not a free, disposable or reserved email
domain, from 5 attempts per client (an IPv4 address or IPv6 /64) and 15 per wider network (an IPv4 /24 or IPv6 /48)
per UTC day (200 listings a day in total), with a proof of work per request; buy a lookalike domain
(`acme-careers.com`) and create mailboxes on it.

**Mitigations:**
- Listing and verifying are separate: a listing reveals nothing about contributors, and every credential still needs a
  code sent to a mailbox at the listed domain (`worker/src/community.ts`, `worker/issuer.ts`).
- A community listing always shows its domain beside the name and is labeled as added by the community; a work-mailbox
  verified account shows the employer's listed domains. The same domain (or a subdomain of a listed one) cannot be
  listed twice, and the verifier refuses a domain it already holds for another employer.
- A domain joins one of our curated listings that has none (for example Charles Schwab) only when Jev judges it at
  least 0.85 likely to be that employer's corporate email domain and the primary label of its registrable name is
  exactly a significant word of the employer's name or a curated alias, or the name written as one word or hyphenated
  at its word breaks (`shared/domains.ts sharesSignificantToken`: `schwab.com` and `charles-schwab.com` pass;
  `schwab.attacker.com`, `notschwab.com`, `schwab-careers.com` and `schwabmail.net` do not); otherwise it becomes a
  separate listing, shown as "Name (domain)".
- A new listing's domain must carry its name (a word of it, the whole name or its initials, generic words such as
  "careers" peeled off) or Jev must read it as at least 0.3 plausible for that name; a domain whose label is another
  listed employer's name or alias can be listed only under that employer's name (`wellsfargo.com` under "Acme
  Holdings" is refused); and a name that means an employer already listed with a domain (with "LLC", a generic word
  such as "Staff", or look-alike Cyrillic or Greek letters) is refused unless the domain attaches to our listing of
  that name.
- Names are refused if they contain identifying details about a person, insults, profanity, accusations or slurs (a
  word list and Jev), invisible characters, mixed Latin, Cyrillic and Greek letters, or a host name other than their
  own domain, or if Jev judges them unlikely to be an organization's name. Domains whose words insult, accuse or
  identify someone are refused the same way.
- Community keys start with conservative caps (50 credentials and 50 juror tokens a quarter) and the usual velocity
  breaker, and a community key signs only while its domain is still registered and acceptable. Verification emails for
  community employers have a daily budget (40 per employer, 1,000 in total per UTC day); over it `/start` answers as
  usual and sends nothing (`worker/issuer.ts`, verifier table `email_budget`).
- The verifier also refuses a parent or subdomain of a domain it holds, and any slug or domain taken down earlier.
- A wrong listing or domain can be reported to legal@; a person reviews it and the operator applies the correction
  with `POST /api/directory/correct` (`ADMIN_TOKEN`), never an account's words. Detaching a domain goes through the
  verifier first (`DELETE /internal/employers` over the binding), which deletes the employer's community keys at once
  and records the slug and domain in `withdrawn_employers`, so they cannot be registered again and no key id is reused;
  then the publisher deletes its key copies, and it accepts a community key only while the employer still has a
  registered community domain, so unused credentials made with a detached key fail. Every correction is appended to
  the public listing correction log ([operations.md](operations.md), "Correcting an employer listing").

**Residual risks:**
- The checks do not prove that an organization exists, uses the domain, or has anything to do with whoever listed it.
  Someone who controls a plausible domain can list "Acme (acme-careers.com)" and publish accounts from mailboxes they
  created, 5 at a time. The domain shown is the defense, and it works only for readers who look at it.
- A domain whose label is exactly a word of a curated employer's name on another suffix (`schwab.co`) or a common
  word of it (`charles.com`), and that convinces Jev, can be attached to that employer's own listing, first come,
  first served, until someone reports it. Accounts published under it would then appear under the real employer's
  name, with that domain among its listed domains. Short domains stay uncertain for Jev (`gs.com` and `kp.org` read
  about 0.5 under unrelated names), so a 2–3 letter domain that is not a curated alias can be listed under an
  unrelated name.
- Accounts show the domains listed for the employer when they are read, not the domain each author used (no key or
  domain is stored with a contribution). After a wrong domain is detached, accounts verified with it no longer show it.
  A domain attached to one of our listings keeps the listing's own name: the record page, the contribution page and
  its accounts label that domain as added by the community (`web/api.ts communitySupplied`), but a reader who sees only
  the name in a list or a chip does not see it.
- A listing is a free way to make the verifier email any address at a domain, limited as described under "1. The
  employer", and a way to use up that employer's daily email budget.
- A takedown needs a person: nothing detects a wrong listing, the only removal path is a request to legal@ that the
  operator applies, and until then a wrong domain keeps working. Someone has to read legal@.

### 9. The network and the device

Not defended: an adversary controlling the author's device or network (keyloggers, managed browsers, TLS interception
on managed networks, traffic analysis). The site sets no cookies, loads no third-party scripts and carries HSTS and a
strict CSP, but Cloudflare zone features that inject scripts, headers or cookies (Web Analytics automatic setup,
Network Error Logging, Email Address Obfuscation, Rocket Loader, Zaraz, bot challenges and their cookies) would change
that. HSTS protects only after a first visit over HTTPS, so the zone must also redirect plain HTTP (Always Use HTTPS).
Some injections happen only for browsers: at launch the Web Analytics beacon was added to pages served to a browser
`User-Agent` and not to plain requests, and the CSP was all that stopped it from running. [operations.md](operations.md)
(deploy step 8) lists the settings and the checks, made as a browser, to run after each deploy. Since then every
response is also marked `no-transform` (the proxy then injects nothing), carries `NEL: {"max_age":0}`, and plain HTTP is
redirected by the workers themselves; the zone settings remain the first line of defense.

## Non-goals

- Deciding whether an account is true. Allegations are published as attributed testimony.
- Promising that an account cannot be attributed. The product reports what its detectors found and leaves the choice to
  the author.
- Protecting an author whose device, browser profile or network is controlled by the adversary.
