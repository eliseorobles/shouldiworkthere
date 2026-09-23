# Constitutional moderation

Nobody at the operator decides what a contributor may say, and there is no moderator dashboard. Jev answers narrow
policy questions with probabilities; a published, versioned policy turns them into outcomes; people are involved only
as temporary anonymous jurors, and exceptions need independent trustees. This document describes the code in
`shared/policy.ts` (policy **0.7.0**), `worker/src/moderation.ts`, `worker/src/submissions.ts` and
`worker/inference-core.ts`. The live page is `/moderation`; the machine-readable policy is `/moderation/current.json`.

## Pipeline

1. **On the device.** `shared/privacy.ts` flags direct identifiers, exact dates, narrow locations, unique roles and
   small teams while the author types. "Make safer" proposes generalizations; each needs the author's approval, and
   testimony is never rewritten silently. A phrase coach flags personal characterizations and broad allegations
   (advisory only). Direct identifiers must change before anything is sent.
2. **Screening.** Only after explicit consent, the approved draft goes to the inference worker, which asks Jev seven
   narrow questions (one per rule signal) and returns probabilities. The publisher applies its own pinned policy to the
   signals (`decide()`); a decision computed elsewhere is never trusted. If screening is unavailable the outcome is
   repair and nothing is stored.
3. **Outcome.** Clear (eligible for delayed, batched publication), repair (the author changes the words; nothing is
   stored), or jury (held privately). The receipt names the rules, the policy version and digest, and the model,
   provider and prompt version.
4. **Publication.** Batches of at least 5 written accounts per employer and verification type (policy 0.8.0;
   `TESTIMONY_BATCH_MIN`), after a random 12 to 72 hour delay; questionnaire figures need groups and answers of at least
   25. An account submitted before September 23, 2026 keeps the rule it was accepted under (`retention.legacyBatch`):
   it is published only in a batch of at least 25 such accounts per employer, reporting period and verification type,
   never mixed with later accounts (`worker/src/submissions.ts publishDue`). The local identifier check runs again at publication and can hold one contribution for repair. Real-employer
   publication is on (`REAL_PUBLICATION_ENABLED`).
5. **After publication.** Anyone can challenge an account under a cited rule (below).

## Policy 0.7.0

Every rule has a category, and the category decides what uncertainty leads to:

| Category | When unsure | Rules |
|---|---|---|
| Privacy | Repair | PRIV-04 identification of a private person (repair at 0.55); PRIV-05 contextual author identification (0.65) |
| Safety | Repair | SAFE-01 credible threat (0.55); SAFE-02 exposed private contact or location (0.55) |
| Abuse | Repair when clear | ABUSE-02 personal attack: repair at 0.85 or more; anything less is published, because criticism of conduct is protected. Never a jury. |
| Spam | Jury | SPAM-01 promotion: jury from 0.55 to 0.97, repair above 0.97 |
| Manipulation | Jury | SPAM-02 fabricated coordination or impersonation: jury from 0.55 |
| Criticism, opinion | Publish | CRIT-01 protection: criticism and opinion are published; reputational harm is not a ground |
| Factual allegation | Attributed testimony | FACT-01 protection: published as the contributor's testimony, never as a finding of fact |

The thresholds are provisional until evaluated on labeled cases. Protected principles (never removable by amendment):
criticism and opinions are protected, allegations stay attributed testimony, only authors edit testimony, no payment or
sentiment influences publication, no unilateral override, no privileged organization, every decision pins its policy
version and digest, and removal outside the rules needs two of three trustees.

**Versioning.** Every version (0.2.0 to 0.8.0) stays published verbatim at `/moderation/v{version}.json` with an
`x-policy-digest` header (SHA-256 of the canonical JSON). 0.5.0 changed ABUSE-02 from jury to repair-first, allowed at
most 2 seats per employer on every case, added the daily challenge budget, protected seeded fictional accounts, and
added the 12-month scrub of erased records. 0.6.0 kept the rules and thresholds of 0.5.0 and changed the procedures:
juror tokens reach a mailbox once per employer and quarter as one set; words revised back to exactly what a jury or a
challenge re-check decided keep that result; relevant challenges that cannot be re-checked at once are queued, with
separate daily re-checks for the privacy and safety rules; per-network limits count an IPv6 client by its /64; trustee
exceptions can be renewed without a gap; moderation counts that follow contributions are rounded like contribution
counts and refreshed daily; jury cases record only the day they opened. 0.7.0 changed only practice juries (round-3
red team RT-B1): under 0.6.0 a case about one of the three fictional employers needed juror keys of 3 other fictional
employers, so no practice jury could ever form. For fictional-employer cases only, a juror may now sit on a case about
the fictional employer their token names, and there is no per-employer seat limit, because sandbox tokens need no
mailbox and those limits separated no one. Real-employer juries keep both limits. 0.8.0 (the public launch of September
23, 2026) publishes written accounts in batches of at least 5 per employer and verification type instead of 25 per
employer, reporting period and verification type, keeps questionnaire figures at groups of 25, raises hosted challenge
relevance checks to 1,000 a day, and runs practice juries only where fictional employers are shown (the public site
shows none). It also keeps accounts submitted before September 23, 2026 at the earlier batch of 25
(`retention.legacyBatch`), seats all juror tokens of employers added by the community in one group of at most 1 seat
per case that never counts toward forming a jury (`jury.communitySeatsPerCase`), and adds a `listings` block: employer
listings are directory entries corrected under the terms, each correction publicly logged, never an account. Earlier
documents and digests are unchanged.

## Juries

- **Scope:** only spam and manipulation, from screening, and published accounts whose challenge re-check lands in the
  cited rule's jury range.
- **Permission:** unpublished words reach jurors only if the author allowed juror review when submitting or revising
  (unchecked by default). Without it, a jury-range case stays held privately and can be repaired or withdrawn; it is
  erased 30 days after it was held.
- **Panel:** 7 randomly drawn anonymous jurors, each answering one question about one rule: YES (the passage clearly
  breaks the rule), NO or UNSURE (abstains). A rule is upheld only when YES reaches a strict majority of the required
  seats (4 of 7; 5 of 9 on appeal), whether or not every seat voted.
- **Seats:** one juror token staffs one seat on one case of its class (sandbox tokens for fictional employers,
  work-mailbox tokens for real employers). A work-mailbox juror never sits on a case about their own employer, and the
  tokens of one real employer fill at most 2 seats on a case. All tokens of employers added by the community
  (including a domain added to one of our listings) share one seat group and fill at most 1 seat on a case, whichever
  listing they name (`policy.jury.communitySeatsPerCase`). A practice juror may sit on a case about the fictional
  employer their token names, with no seat limit (`policy.jury.ownEmployerExcluded`, `seatsPerEmployer`). A seat lasts
  48 hours, then reopens.
- **Closing:** when every seat has voted; or after 7 days if at least 70% of seats (rounded up) voted; otherwise at 30
  days with no decision (no quorum). A held case with no decision is erased at the next scheduled run within about a day
  unless repaired; erasure is deferred, not paused, while a case is open.
- **What jurors see:** the rule, the question, the passage with detected identifiers masked, and the seat deadline.
  Never the author, the challenger, other votes, the stage or the panel size, so an appeal juror cannot tell that a first
  jury upheld the rule.
- **Appeals:** the author, with the capability, once per decision; a new case of 9 freshly drawn jurors. The appeal is
  final for those words until the policy version changes.
- **Activation:** real-employer juries need `JURY_ENABLED=true` (on in production) and work-mailbox juror keys of at
  least 3 other employers (4 for an appeal), because the 7-day quorum (5 of 7, 7 of 9) must be reachable at 2 seats per
  employer; only curated keys count, never the keys of employers added by the community (`worker/src/moderation.ts
  jurorEmployers`), since anyone who controls a few domains could otherwise make juries formable and fill them. Practice juries and appeals form only where fictional employers are
  shown (`SAMPLE_EMPLOYERS=on`, locally and in tests) and sandbox juror keys of at least one of them are published;
  production has neither.
  `/api/config` states whether each kind of jury and an appeal can form right now.
- **Limits:** token holders are not proven unique people (one set of up to 3 tokens per mailbox, employer and
  quarter); practice juries are not Sybil-resistant, and with no seat limit one person can hold several seats on a
  practice case, so they demonstrate the procedure only; appeal jurors hold different tokens, not provably different
  people.

## Challenges

- **Who and how:** anyone, on equal terms, from the account itself, citing one published rule and explaining (10 to 500
  characters, no identifying details) how the account breaks it. Challenges are open only while `RATE_LIMIT_SECRET` is
  set.
- **Relevance:** the reason, with detected identifying details masked, and the public rule text go to Jev, which answers
  "does the reason describe a specific way the account breaks the rule?" (relevant at 0.6) and "is it only that the
  account is unflattering or untrue?" (must be below 0.5). If Jev is unavailable, failed in the last 15 minutes, or its
  1,000 daily relevance checks are spent, the reason must contain one of the rule's published ground terms. Citing a
  protection is answered and never acted on.
- **Re-check:** a relevant challenge re-checks the published words under the current policy, at most once per account
  and policy version (100 hosted re-checks per UTC day, plus 50 reserved for PRIV-04, PRIV-05, SAFE-01 and SAFE-02,
  which go first). A relevant challenge whose re-check cannot run at once (the day's re-checks are spent, or Jev is
  unavailable) is queued with a receipt, never refused; the scheduled job re-checks the queue as capacity returns,
  privacy and safety first, and the account stays published meanwhile. The queue row holds no reason. A direct
  identifier or a repair threshold withholds the account for its author to repair; the cited rule's jury range opens a
  jury (where one can form) while the account stays published; otherwise it stays published.
- **Finality:** a challenge merges into an open case for the same rule, and into any decided case for the same words,
  rule and policy version (an appeal, or a first jury that did not uphold the rule or reached no decision).
- **Budgets:** 5 challenges per network per UTC day (an IPv4 address, or an IPv6 /64), stored only as an HMAC under
  `RATE_LIMIT_SECRET` of the day, the purpose (`challenge`) and a digest of the network, deleted after the day; a reason
  that does not fit the rule costs 2 more, and a challenge refused before it is considered (an identifying detail in
  the reason, or an account that is not published) costs nothing. A per-minute limiter applies on top.
- **Fixtures:** seeded fictional sample accounts (shown only where `SAMPLE_EMPLOYERS=on`, never in production) cannot
  be withheld by a challenge or a jury. A challenge to one is a practice case: no hosted check, no re-check, no jury,
  and a receipt that says so.
- **What each side learns:** the challenger learns only that an account was withheld under the published rules; the
  author's status page names the rule, the model that re-checked the words and what judged the reason. The reason is
  never stored.

## Exceptions (break-glass)

Valid legal orders (at most 90 days) and credible imminent-safety issues (at most 14 days) are the only exceptions. They
need Ed25519 signatures of two distinct, unrevoked trustees over `siwt-exception-v1:<origin>:<canonical action JSON>`
(so a signature is valid for one deployment), a fresh nonce, a scope of one account, and an expiry. The expiry and nonce
are recorded first, then the public exception log entry (kind, scope, a digest of the target, expiry day, signers), and
only then is the account withheld; it is restored at expiry. The process is **off**: with no `TRUSTEE_KEYS`,
`/api/exception` answers 503, and legal orders and other removals the law requires are handled through direct
administrative access, recorded in the legal requests ledger when the law allows. A report that an account breaks a
content rule, and not the law, is never handled that way: it is decided by a challenge under the published rules, which
the operator can file for the reporter through the public route, with the same budget and no priority. Trustees do not
exist yet.

## Receipts and statistics

Author receipts (`/api/author/status`, shown on `/status`) list each decision: screening, the publication re-scan,
publication, withholding, restoring, challenges, jury and appeal outcomes with vote totals, erasure. Each names the rule,
policy version and digest, and the model where one decided.

Public statistics (`/api/moderation/stats`, `/moderation`, and each transparency archive) are per quarter and written
at most once per UTC day, by the first scheduled run of the day. Counts that follow contributions (submitted,
publishedAutomatically, repairs, jury, heldByReason, juryOutcomes) are `<25` from 1 to 24 and otherwise rounded down to a
multiple of 25; the other counts below 5 are `<5`:

| Measure | Counts |
|---|---|
| submitted | first submissions this quarter |
| publishedAutomatically | publications this quarter of words cleared by automated screening alone |
| repairs | automated repair requests, plus accounts withheld for repair after a challenge |
| jury | first-jury cases opened this quarter |
| rejected | challenges answered without change (practice cases excluded) |
| practice | challenges to seeded fictional accounts |
| legal | entries in the public exception log |
| appeals | appealed decisions (one per appeal) |
| overturned | appeals in which every appealed rule was cleared |
| heldByReason | contributions held now, by reason (jury, no quorum, upheld, publication re-scan, challenge repair, exception) |
| juryOutcomes | first-jury outcomes this quarter (upheld, not upheld, no quorum, moot) and cases open now |

## Honest limits

- Thresholds are hypotheses; no labeled evaluation exists yet for screening.
- Real-employer juries are switched on and form only while juror keys of enough other employers are live; whether a
  jury can form is stated on `/moderation` and at `/api/config` from the same switches and keys the code uses. Token
  holders are not proven unique people, and someone who controls a domain can list an employer and obtain juror tokens
  for its mailboxes up to the community cap. Trustees are not operating. Production has no practice juries.
- The screening model can miss context; the author's own review and the publication re-scan are the other layers.
- A constitutional API cannot stop the sole account owner from replacing the software; the signed release, archives and
  the roadmap's independent operation are the answers to that, and only the first two exist.
