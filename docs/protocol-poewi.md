# Proof of Employment Without Identity (PoEWI) v1

This is the credential protocol as implemented: `shared/proof.ts` (used by the browser, the publisher and the verifier),
`shared/pow.ts` (proof of work), `shared/domains.ts` (work-email domain rules), `worker/issuer.ts` (verifier),
`worker/src/credentials.ts`, `worker/src/community.ts` and `worker/src/submissions.ts` (publisher), `web/submit.tsx`,
`web/add-employer.tsx` and `web/jury.tsx` (browser). Tests: `tests/protocol.test.ts`, `tests/publication.test.ts`,
`tests/moderation.test.ts`, `tests/acceptance.test.ts`.

The claim it supports is narrow: **someone controlled a mailbox at a domain listed for an employer, this quarter.** It
does not prove identity, job title, current employment, or that two contributions or two juror tokens come from
different people. For an employer added by the community, the domain was supplied by whoever added the listing and
checked only automatically, so the claim is about that domain's mail, not about the employer named.

## Roles and what each one learns

| Party | Learns | Never learns |
|---|---|---|
| Browser | Its own mailbox, credential, signing key, withdrawal capability, juror tokens | — |
| Verifier (`verify.shouldiworkthere.com`, own database) | That a code was requested for a mailbox at a listed domain; keyed hashes of the mailbox; the blinded messages it signed; counts per employer; the domain registry | The finished credential or token, any contribution, any vote |
| Publisher (`shouldiworkthere.com`, public and intake databases) | A valid credential for an employer and key, its nullifier, the contribution, a per-contribution public signing key | The mailbox, the email address, anything the verifier stored |
| Inference (no public address) | Approved drafts after consent, questions, published text | Emails, credentials, tokens, capabilities, IP addresses |

The verifier and publisher have separate databases and separate secrets. The main worker's `VERIFIER` service binding
reaches only the verifier's internal registration route (`POST /internal/employers`, authenticated with the shared
`INTERNAL_TOKEN`) and its public `/keys`; it carries directory information and public keys, never a contribution or an
email address. All three run in one Cloudflare account under one operator: see [threat-model.md](threat-model.md).

## Cryptography

- **Blind signatures:** RFC 9474 RSABSSA-SHA384-PSS-Randomized, 2048-bit keys, via `@cloudflare/blindrsa-ts`
  (`suite()` in `shared/proof.ts`). "Randomized" means `prepare` prefixes the message with 32 random bytes, so the
  signed message is `random32 || JSON payload`.
- **Issuer key storage:** each private key is sealed with AES-256-GCM under the verifier secret `ISSUER_MASTER_KEY`, with
  the key id as associated data, so a sealed key cannot be moved to another row (`sealIssuerKey`, `openIssuerKey`).
- **Mailbox hashes:** HMAC-SHA-256 under the verifier secret `MAILBOX_PEPPER`.
- **Author keys:** ECDSA P-256, generated per contribution in the browser, non-exportable.
- **Encoding:** base64url without padding, strict. `decode()` accepts only the one canonical spelling of each byte string,
  so a token cannot be resubmitted under a different spelling to get a different nullifier.

## Keys

Keys come from two sources (`keySource`, `issuer_keys.source` and `trusted_issuers.source`):

- **Curated.** `tools/provision-issuer.mjs` creates, each quarter, one contribution key and one juror key per employer in
  its `EMPLOYERS` list (an employer with configured mailbox domains gets `mailbox` keys), plus sandbox keys for the
  fictional employers only while the main worker shows them (`SAMPLE_EMPLOYERS` exactly `on`; never in production).
  The release signs and the client pins them.
- **Community.** When someone adds an employer (`POST /api/employers`), the main worker registers its domain with the
  verifier, which records it in its `employer_domains` registry (one domain per employer, one employer per domain, the
  registration quarter and no finer time) and creates the employer's contribution and juror keys on the spot, and at
  each later quarter's start from its scheduled job: RSA-2048 through the same suite, sealed under `ISSUER_MASTER_KEY`,
  with `COMMUNITY_KEY_LIMITS` (50 credentials and 50 juror tokens a quarter; velocity 10 and 15). Their ids end in
  `:community` (`communityKeyId`). A community key signs only while its employer's registered domain is still its one
  domain and still passes `shared/domains.ts`. The main worker copies their public halves into `trusted_issuers` with
  `INSERT OR IGNORE`, at registration and from its scheduled job. The verifier refuses a domain that is a parent or
  subdomain of one it holds or that a curated key verifies. `DELETE /internal/employers` (same token) takes a community
  registration down: it deletes the registry row and the employer's community keys at once and records the slug and
  domain in `withdrawn_employers`, so neither can be registered again and a key id is never reused for other key
  material. The operator reaches it through the main worker's `POST /api/directory/correct` (`ADMIN_TOKEN`), which
  calls it over the binding and, once the verifier confirms, deletes the publisher's copies of the keys and logs the
  correction publicly; a takedown made directly at the verifier is mirrored by the main worker's scheduled job
  ([operations.md](operations.md)). The publisher serves and accepts a community key only while the employer still has
  a registered community domain (`worker/src/credentials.ts`), so a copy left behind signs nothing it would accept.

A directory employer with neither has no keys, so nobody can obtain a credential for it:

| Key | Id | Class | Who can obtain it |
|---|---|---|---|
| Contribution, curated real employer | `<slug>:<quarter>:mailbox` | `mailbox` | Someone who receives a code at a domain configured for the employer |
| Contribution, community-listed employer | `<slug>:<quarter>:community` | `mailbox` | Someone who receives a code at the listed domain |
| Juror, curated real employer | `<slug>:<quarter>:juror:mailbox` | `mailbox` | Someone who receives a code at a configured domain |
| Juror, community-listed employer | `<slug>:<quarter>:juror:community` | `mailbox` | Someone who receives a code at the listed domain |
| Contribution, fictional employer (local and tests only) | `<slug>:<quarter>:demo` | `demo` (sandbox) | Anyone; no email. Labeled "Sandbox credential; employment not verified" |
| Juror, fictional employer (local and tests only) | `<slug>:<quarter>:juror:sandbox` | `demo` | Anyone; limited per connection |

- A key is valid for its quarter and the next one (expiry: the start of the quarter after next).
- A key's purpose is decided by its id (`keyPurpose`): a stored purpose that disagrees makes the key unusable, so a
  relabelled juror key can never sign contributions or the reverse. Juror payloads carry `purpose:'juror'` and no author
  key, so they never parse as contribution proofs.
- The provisioning run writes the sealed rows for the verifier, the public keys for the public database
  (`trusted_issuers`), and `db/issuer-public-keys.json` (public registry with fingerprints). Real employers' rows carry
  their issuance cap and velocity limit (below); fictional employers' rows carry none. Provisioning refuses a curated
  employer whose slug or domain the verifier's community registry already holds.

## Contribution credential

1. **Key choice and consistency.** The browser takes the employer's current contribution key from the publisher
   (`/api/proof/keys`, `currentIssuerKey`), refuses if more than 4 live keys of that purpose exist for the employer
   (`MAX_CONCURRENT_KEYS`), fetches the verifier's `/keys`, and refuses unless both describe the key identically
   (`sameIssuerKey`: id, employer, quarter, expiry, class, purpose and public key). When the build pins a registry
   (`tools/build.mjs` reads `db/issuer-public-keys.json`), the key's fingerprint must also be in it. The page shows the
   start of the fingerprint so two devices or networks can compare. A key served to only some visitors ("tagging") would
   have to fool all three checks. A community key cannot be in a registry built before it existed: the browser accepts
   it only when the two services' copies agree member for member, and labels it as added after this release, so for those
   keys a tagging operator has to fool two checks, not three.
2. **Mailbox code (real employers).** The browser sends `{action:'start', keyId, email, pow}` to the verifier, and only
   after the author clicks. `pow` is a proof-of-work stamp (below) bound to this action, the key and a digest of the
   normalized address; the verifier checks it with one hash before anything else. The verifier canonicalizes the mailbox (lowercase, `+tag` removed, the employer's first listed domain
   for aliases), refuses domains it does not list, and answers every eligible address with the same body
   `{challengeId, expiresInMinutes:15}`. It stores, per request: a keyed hash of mailbox, employer and quarter; a keyed hash
   of the mailbox alone (for the email throttle); a keyed hash of the code; an attempt counter; the expiry.
   - **The email is identical in every case.** Same sender, subject ("Should I Work There verification request") and
     body with a fresh six-digit code, for credentials and juror tokens, whether or not the mailbox already has what it
     can get this quarter. `/start` never reads the quotas; they are enforced only when the code is used. Cloudflare's
     delivery record (recipient, subject, time) therefore reveals only that a code was requested.
   - **Throttle.** At most 3 unexpired requests per mailbox in 15 minutes, across purposes and quarters. Beyond that a
     request still gets a challenge row and the same reply, but no email is sent. Anyone can therefore delay codes to a
     given mailbox.
   - **Daily budget for community employers.** For a community key, an email is also sent only while that employer has
     used fewer than 40 of its verification emails this UTC day and all community employers together fewer than 1,000
     (`COMMUNITY_EMAIL_LIMITS`, counted in the verifier's `email_budget` table, kept for today and yesterday). Over
     either, the reply is the same and nothing is sent, so anyone can delay codes for a community employer's staff
     until the next UTC day.
3. **Blinding.** The browser creates a fresh P-256 author key and prepares the payload
   `{v:1, scope:<keyId>, nonce:<32 random bytes>, authorKey:<public JWK>}`, blinds it, and sends
   `{action:'issue', keyId, blinded, challengeId, code}`. Retries after a lost response resend the identical blinded message
   (RSA blind signing is deterministic), and only that message is re-signed for a used challenge.
4. **Issuance.** For a real employer the verifier checks the code (at most 5 attempts), refuses if the mailbox already
   received a credential for this employer and quarter (`credential_already_issued_this_period`), checks the employer's
   cap and pause, records the quota row (keyed mailbox hash and blinded-message hash, deleted after the quarter) and the
   employer counts, and returns the blind signature. Sandbox keys skip the mailbox and are limited per connection.
5. **Finalization.** The browser unblinds and verifies the signature. With the author's opt-in, it may keep the finished
   proof, or the in-progress blinding state, in its local database so a reload does not lose the quarter's credential;
   the blinding state links the verifier's request to the credential, so it is kept only on the device and deleted once
   used.
6. **Redemption.** The browser submits `{companySlug, layer, body, period, proof, structured, publicationConsent,
   screeningConsent, adultConfirmed, juryReviewConsent, sensitiveConsent}` to the publisher. The publisher verifies the
   signature against its own copy of the key (`validateProof`: key purpose, employer, expiry, RSA-PSS verification, payload
   shape), refuses a real employer without a mailbox-class key, and records the **nullifier** `SHA-256(prepared message)`
   in `spent_proofs` until the key expires. A second use of the same credential fails on the unique nullifier.
7. **Receipt.** The publisher returns a random withdrawal **capability** once and stores only `SHA-256(capability)`.
   Withdrawal needs only the capability. A revision of held or waiting words is signed with the author key over
   `{v:2, subject:SHA-256(capability), action, revision, payloadHash, screeningConsent}`, and each signed request is usable
   once (its signature's `r` half is recorded for 181 days).

The verifier sees the blinded message; the publisher sees the unblinded proof. Blindness means the two cannot be matched
by value. They can still be matched by **time** if one party holds both services' records: publication is delayed a
random 12 to 72 hours, rounded to 6-hour boundaries, and happens only in batches of at least 5 per employer and
verification type (policy 0.8.0; `TESTIMONY_BATCH_MIN`), and published dates are quarter-precision. Redemption itself
sends nothing to the verifier: the publisher checks the proof against its own copy of the key
(`worker/src/credentials.ts`), and copies community keys only when a listing is added and from its six-hourly job, so a
community key is usable from the first copy on (the browser uses a key only when both services publish it).

## Proof of work

`shared/pow.ts`, owner decision of September 23, 2026. The three requests anyone can send without an account need a
hashcash stamp: a mailbox code (`/start`), a juror token batch (`/issue-juror`) and a new employer listing
(`POST /api/employers` at the publisher).

- The browser finds a 16-hex-character nonce such that `SHA-256(prefix ‖ nonce)` starts with `bits` zero bits (20 by
  default, `POW_BITS`, clamped to 8–32), in a Web Worker served from the site's own origin (`/pow-worker.js`).
- The prefix binds the stamp to the requesting origin, the action, the issuer key id (empty for a listing), a digest of
  what the request concerns (the normalized email address, the exact blinded messages, or the domain) and the UTC
  minute. A server accepts a stamp within 2 minutes of its own clock and checks it with one hash.
- Nothing about the person is in a stamp: the address and the domain enter only as a digest, and the verifier receives
  the address itself anyway. No spent-stamp table is kept; replaying a stamp within its window repeats the same request,
  which the email throttle, the one-batch juror quota and the one-listing-per-domain rule absorb.
- It is a cost, not an identity check: it slows floods from one machine and does nothing against someone willing to
  spend the compute.

## Juror tokens

- **Payload:** `{v:1, scope:<juror keyId>, nonce, purpose:'juror'}`. A request carries 1 to 5 blinded tokens
  (`JUROR_BATCH_MAX`); a batch is re-signed only if it is byte-identical.
- **Quota (real employers):** one set of up to 3 tokens per mailbox, employer and quarter (`JUROR_QUOTA`), issued in a
  single batch and stored as a keyed mailbox hash and the number issued until the quarter ends, separate from the
  contribution quota. A later request for the same mailbox, employer and quarter is refused whatever its size, with one
  answer that never says how many were issued. The code flow is the same
  `/start` challenge, and every `/issue-juror` request carries a proof-of-work stamp bound to its blinded messages.
  Sandbox tokens (only where fictional employers are shown) need no mailbox and are limited per connection (an hourly
  keyed hash of the IP address, never stored).
- **Nullifier:** `SHA-256("siwt-juror-v1:" || base64url(prepared))`, domain-separated from contribution nullifiers and
  computed over the signed bytes, so one token has exactly one nullifier. A token is spent only together with a seat.
- **Seats:** a token staffs one seat on one randomly drawn open case of its class. Policy 0.7.0 splits the classes
  (`policy.jury.ownEmployerExcluded`, `policy.jury.seatsPerEmployer`): a work-mailbox token is never drawn for a case
  about its own employer, and the tokens of one real employer fill at most 2 seats on a case; a sandbox token may be
  drawn for a case about the fictional employer it names, and sandbox seats have no per-employer limit, because anyone
  can hold every fictional employer's tokens. Policy 0.8.0 adds `policy.jury.communitySeatsPerCase` (1): every token
  whose key is a community key (`source:'community'`, read by `inspectJurorToken`), whichever listing it names, shares
  one seat group per case capped at 1, and community keys never count toward whether a jury can form
  (`worker/src/moderation.ts seatGroup`, `jurorEmployers`), because anyone who controls a domain can list it and obtain
  such tokens. For a real-employer seat, the seat group is an HMAC under the main worker's `RATE_LIMIT_SECRET` of the
  case and the token's employer, or of the case and the community group label for a community token (a plain digest
  without the secret), deleted with the seat when the case closes; a sandbox seat records no seat group. The seat is stored under a hash of a secret only
  the juror's browser holds.
- **What a juror sees:** the rule, the question, the passage with detected identifiers masked, and the seat deadline;
  not the stage, the number of jurors or any earlier result (so an appeal juror cannot tell that a first jury upheld the
  rule).
- **Limits.** Token holders are not proven unique people: one mailbox holds up to 3 tokens, so up to 2 seats (the
  per-employer cap) on one real-employer case. Someone who controls a domain can list an employer with it and obtain
  tokens for its mailboxes up to the community cap, but all community tokens together hold at most 1 seat on a case. Sandbox tokens, where fictional employers are shown, are free for
  anyone and have no seat limit, so one person can hold several seats on a practice case: practice juries are not
  Sybil-resistant and demonstrate the procedure only. Production shows no fictional employers.
  Appeal jurors hold different tokens from the first jury; that they are different people is not guaranteed.

## Issuance limits (real employers only)

`ISSUANCE_POLICY` in `shared/proof.ts`, embedded in each sealed key row at provisioning:

- Credentials per employer and quarter scale with the lower bound of the published headcount band: 50 (unknown or under
  1,001), 150, 300, 600, 1,200, 2,000 (100,001 or more). Juror tokens: twice that.
- Velocity: within a rolling 24 hours, at most the larger of 10 credentials (25 tokens) and 10% of the cap. A request that
  would exceed it is refused and pauses the employer for 24 hours; a contribution trip pauses both purposes, a juror trip
  juror tokens only. The cap is a database `CHECK` and the velocity breaker a trigger, so an over-limit batch rolls back.
- `GET /stats` on the verifier publishes, per employer and purpose, a coarse issued band (`<25`, `25–99`, `100–249`,
  `250+`), the cap, the velocity limit and whether the cap is reached or issuance is paused; no timestamps or exact counts.
- Community-listed employers have no published headcount; their keys carry `COMMUNITY_KEY_LIMITS` (50 credentials and
  50 juror tokens a quarter, velocity 10 and 15).
- Fictional employers (local and tests only) have no cap, count or pause. These numbers are provisional. A legitimate surge (a layoff day) also
  trips the pause, and an employer that controls many mailboxes can exhaust its own cap.

## Key and bundle consistency

- The fingerprint of a key is `SHA-256("siwt-issuer-key-v1:" || JSON [id, companySlug, epoch, expiresAt,
  verificationClass, purpose, kty, n, e])`; the set digest is `SHA-256` of the JSON array of sorted fingerprints.
- The signed release manifest (`tools/transparency.mjs`, served at `/.well-known/siwt-release.json`) lists every live
  key's fingerprint and the set digest, with digests of the served client and of every worker, shared, database and
  config source and the lockfile.
- Each transparency archive lists every key in the publisher's `trusted_issuers` registry (expired keys stay listed) and
  the set digest, so a watcher that keeps archives can see a key that appeared for some visitors or disappeared. The
  application never deletes registry rows, but the operator can (the key-leak runbook in
  [operations.md](operations.md) does): archives written before a deletion keep the fingerprint, later ones omit it, and
  `verify-deployment --state` does not yet flag a registry that shrinks between archives.
- `tools/verify-deployment.mjs` checks that the site and the verifier publish identical curated keys, that each is in
  the manifest and pinned by the served client, that every community key the site publishes is identical on the
  verifier (and warns while a live one is not yet copied), that purposes and sources agree with ids, and that no
  employer has more than 4 live keys of a purpose.

None of this proves which code the Workers execute. See [hardening-roadmap.md](hardening-roadmap.md) for independent
operation and key transparency.

## Invariants and where they are tested

| Invariant | Enforced by | Tests |
|---|---|---|
| One credential per mailbox, employer and quarter, across keys and aliases | `issuance_quota_v3` keyed by mailbox, employer, quarter | `tests/protocol.test.ts` |
| A credential is single use | unique `spent_proofs.nullifier` | `tests/publication.test.ts`, `tests/acceptance.test.ts` |
| A credential is bound to one employer and purpose | `validateProof` (scope, employer, purpose) | `tests/protocol.test.ts` |
| One token, one nullifier, one seat | canonical decoding; nullifier over bytes; token spent with the seat | `tests/protocol.test.ts`, `tests/moderation.test.ts` |
| Emails do not reveal issuance | one template; `/start` never reads quotas | `tests/protocol.test.ts`, `tests/safety.test.ts` |
| The verifier never reads the public database | its only binding is `VERIFIER`; limits travel in its own key rows | `tests/protocol.test.ts` |
| Each local worker gets only its own secrets | one env file per worker; `dev.mjs` refuses foreign secrets | `tests/acceptance.test.ts` |
| Keys agree between services | `sameIssuerKey`, fingerprints, 4-key limit | `tests/protocol.test.ts`, `tests/transparency.test.ts` |

## What v1 does not do

1. **Identity or employment.** A mailbox is not a person, a title or a current job. Former-worker attestation does not
   exist.
2. **One human, one vote.** Credentials and tokens are per mailbox; mailboxes can be shared or controlled by an employer.
3. **Mailbox privacy.** Anyone can make the verifier email any address at a listed domain, and anyone can list an
   employer with almost any organization's domain (bounded per day for community employers); anyone who reads that
   mailbox (an employer included) sees that a code was requested.
4. **Timing unlinkability against the operator.** Batching and quarter-precision dates weaken correlation; they do not
   remove it for someone holding both services' request metadata.
5. **Independent custody.** One account, one operator. The roadmap describes an independent verifier operator and a
   DKIM-based proof that would remove the verifier's email step.
