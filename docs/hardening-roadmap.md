# Hardening roadmap

What would close the residual risks in [threat-model.md](threat-model.md), in the order that buys the most. Nothing in
this document is implemented unless it says so; each item names what exists today, the design, what it would and would
not change, and the prerequisites. Items that need people (trustees, an independent operator, auditors, counsel) are
blocked on those people, and the product says so rather than simulating them.

## 1. Independent verifier operator

**Today.** The verifier is a separate Worker with its own database and secrets, but it runs in the same Cloudflare
account as the publisher, deployed by the same operator, who also holds the issuer private keys on the provisioning
machine.

**Design.** Move `worker/issuer.ts`, `issuer.wrangler.jsonc`, the verifier migrations and `tools/provision-issuer.mjs`
to an account and domain controlled by an independent organization with its own deploy keys, release key and
`MAILBOX_PEPPER`. The publisher keeps only the public keys it already receives. The browser already refuses keys that
the two services describe differently and keys outside the pinned registry, so the protocol does not change; the
verifier's own release manifest and `verify-deployment.mjs` run against both origins.

**Changes.** The publisher's operator can no longer read mailbox hashes or mint credentials. **Does not change:**
mailbox monitoring by employers, or timing correlation by an adversary who sees both services' traffic.

**Needs.** An organization willing to run it, a written agreement (no data sharing, publication of its own ledger), and a
key ceremony for the first issuer keys.

## 2. Mailbox proof without an email step (DKIM)

**Today.** The verifier sends a code to the mailbox, so it sees the address in memory, Cloudflare keeps a delivery
record for 30 days, and anyone who reads the mailbox sees that a code was requested.

**Design.** The author sends an email from the work mailbox (or forwards a received one) and proves, in the browser, that
a DKIM-signed message from the employer's domain contains a verifier-issued nonce, without revealing the address. Two
routes:

- *zkEmail-style proof:* a zero-knowledge circuit over the DKIM RSA signature, the `From` domain and the nonce, with the
  local part hidden. The verifier checks the proof against the domain's published DKIM key and blind-signs as today.
- *Interim, weaker:* the verifier checks a DKIM signature on a message the author pastes, then discards it. This removes
  the outbound email but lets the verifier see the address, so it only helps against mail-log and monitoring leaks.

**Changes.** No email is sent, so nothing appears in the employer's inbox and no delivery log exists. **Does not change:**
the one-credential-per-mailbox quota needs a nullifier derived from the address inside the proof (so the verifier must
still keep a keyed value per mailbox); employers can rotate DKIM keys, and some domains sign poorly; proof generation in
a browser is slow on phones.

**Plan.** (a) Survey DKIM coverage for listed employers. (b) Prototype the circuit and measure proving time. (c) Add a
second issuance path next to `/start`, feature-flagged per employer. (d) External review of the circuit before any real
employer uses it.

## 3. Oblivious HTTP relay for search and screening

**Today.** Cloudflare sees each request's IP address; the publisher reads it only in memory for rate limits and keeps
daily keyed records for two limits.

**Design.** Serve `/api/canvas` and `/api/screen` through an OHTTP gateway (RFC 9458) with a relay run by a third party.
The relay sees the IP address but not the content; the gateway sees the content but not the IP address. Rate limits move
to anonymous tokens (Privacy Pass, RFC 9576-9578) issued per client, so no IP digest is needed.

**Changes.** The operator can no longer tie a question or draft to a network. **Does not change:** the verifier still
sees the mailbox; timing across services; the relay operator and gateway operator colluding.

**Needs.** A relay operator, OHTTP key configuration publishing, a token issuer, and client support in the React app.

## 4. Onion service

**Design.** Publish the site and the verifier as Tor onion services (with the same release manifest), and document how
to contribute over Tor Browser. The CSP, same-origin scripts and absence of third-party requests already fit.

**Changes.** Readers and authors can hide their network from Cloudflare and from us. **Does not change:** Cloudflare
Workers cannot host an onion service directly, so this needs a separate front end (for example a small proxy that
forwards to the Workers), which becomes another component to trust and to publish in the manifest.

## 5. Key and bundle transparency

**Today.** Implemented: a signed release manifest with digests of the served client, sources, lockfile, issuer keys and
policy; transparency archives with RFC 6962 Merkle roots, the full issuer key registry and a digest chain;
`verify-deployment.mjs --state` pins history. Optional and never exercised against the live log: submitting the manifest
to Sigstore Rekor (`tools/transparency.mjs --rekor`).

**Design.**
- Submit every release and every archive digest to Rekor (or another public append-only log) so a rewrite of history is
  detectable without having kept copies; `verify-deployment.mjs --check-rekor` then requires inclusion proofs.
- Sign archives with an online key held by the Worker, separate from the offline release key, and publish both keys in
  the manifest.
- Release key rotation: a new key is announced in a release signed by the old one; watchers pin both.
- Issuer key revocation that keeps the registry complete: a revoked flag (or revocation list) outside the fingerprint
  that the publisher and verifier honour and the archives publish, a fresh key id for a same-quarter replacement, and a
  `verify-deployment --state` check that fails when a pinned key disappears from a later archive. Today a leaked key can
  only be deleted (see the key step under Rollback in [operations.md](operations.md)), which removes it from later
  archives.
- Reproducible builds: pin the build toolchain so anyone can rebuild `/app.js` and compare with the signed digest.
- Several independent watchers running `verify-deployment.mjs` from different networks and publishing their results.
- Community keys (created by the verifier for employers listed after a release) are checked today only for agreement
  between the site and the verifier, and appear in later archives. Submitting each new community key's fingerprint to a
  public append-only log when it is created, and having the browser require an inclusion proof, would give them the
  same protection against a key served to one visitor that a signed release gives curated keys.

**Does not change:** the manifest still cannot prove which code the Workers execute. Remote attestation of Workers is not
available.

## 6. Trustees

**Today.** The two-of-three exception protocol is implemented and tested (`shared/trustees.ts`, `/api/exception`):
Ed25519 signatures bound to the deployment origin, a nonce, one account, an expiry, and a public log entry written first.
It is off because no trustees exist; legal orders and other removals the law requires are handled by direct database
access, recorded in the ledger when the law allows. Content-rule reports go through challenges, never that access. A
direct removal leaves the author's status page saying "published"; an authenticated path that withholds through the
same code as a challenge, with a legal reason, would fix that before trustees exist.

**Needs.** Three independent people or organizations with no conflict with any listed employer, a written charter
(scope limited to valid legal orders and credible imminent-safety issues, maximum durations, publication duties),
hardware-backed keys and a key ceremony, and a rotation and revocation procedure. Then set `TRUSTEE_KEYS` and remove the
operator's direct-access path from the runbook.

## 7. Independent audit

**Scope worth paying for:** the blind-signature flow and key handling (`shared/proof.ts`, `worker/issuer.ts`,
`web/submit.tsx`), the erasure and publication paths (`worker/src/submissions.ts`), the moderation policy engine
(`shared/policy.ts`, `worker/src/moderation.ts`), the privacy detector's false-negative rate on real workplace text, the
release and archive verification tools, and the legal pages against the code. The audit report would be published on
the transparency page with the release it covers.

## 8. Smaller items already scoped

- Evaluate moderation thresholds on labeled cases and publish the results next to `docs/evaluation.md`.
- A per-case jury assignment that makes seat concentration harder than today's 2-seats-per-employer cap for real
  employers (practice juries have no cap). Employers added by the community already share one seat per case and never
  make a jury formable (policy 0.8.0); a stronger rule would let a proven curated domain count on its own.
- A removal runbook that writes an intake action for removals under legal orders, so the author's status page can show
  them.
- Shorter retention for the minimal record after withdrawal once idempotent withdrawal can work without it.
- Record each published account's verification domain (the one domain of a community key, or the key's primary domain)
  at publication, so that correcting a listing's domain cannot change what older accounts show.
- Create and copy a quarter's community keys before the quarter starts (the verifier could create them ahead of time),
  so a community employer's new key is usable from the first minute of the quarter rather than from the publisher's
  next six-hourly copy. The publisher never contacts the verifier when a credential arrives, so this is about
  availability, not timing.
- A public way to ask for a listing correction that does not depend on one inbox. Today corrections are applied only
  through the operator route (`POST /api/directory/correct`, `ADMIN_TOKEN`) after a person reads the request at legal@,
  and each is logged publicly; nothing notices a wrong listing on its own, and an unread inbox leaves it up. A
  challenge-like request with a receipt, and an alert when the daily listing cap is reached, would help.
