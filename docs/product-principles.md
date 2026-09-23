# Product principles

Should I Work There is institutional memory about workplaces: contributors can
prove they were there without revealing who they are, and every number opens to
its evidence. This document is the product brief the implementation and the
waterfall tickets are measured against.

## Three pillars

- **Proof.** A cryptographically verified relationship to an employer, without
  identity. The service that verifies a mailbox never sees testimony; the
  service that stores testimony never learns who wrote it.
- **Evidence.** Original testimony is immutable. Jev structures it; nothing
  rewrites it. Structured questionnaire answers and written accounts stay
  distinct, and model readings are never counted as votes.
- **Ask.** Every company has an Infinite FAQ whose answers are assembled from
  traceable evidence, with sample sizes, periods and limits visible.

## Jev is the decision layer, not a writer

```
human language → Jev → typed, probabilistic decisions → deterministic code + verified evidence
```

- Jev returns Noul, Choice and Score answers with probabilities. It chooses an
  interface and its parameters; SQL and code compute every value shown.
- No generated answer prose, no invented employees, counts, ratings or
  percentiles. When a question needs generation, the product shows the
  evidence it has and says what it cannot answer.
- Each published account is read by 20–50 narrow, independent judgments
  (firsthand, specific allegation, layoff, reorganization, pay, workload,
  promotion, retaliation, harassment, discrimination, six descriptive
  dimensions, specificity). Unknown stays unknown.
- Route decision per question: metric view, comparison, timeline,
  distribution, cohort, evidence reader, clusters, existing FAQ, discovery,
  needs generation (answered with evidence instead), or cannot safely answer.

## Probabilistic UI

Interaction → inference → interface mutation. Not input → spinner → AI text.

- **One input, no modes.** A company name navigates. Two companies compare. A
  criterion list explores. A time question becomes a timeline. A complaint
  question becomes clusters. A group question becomes a cohort view.
- **Semantic controls.** Every inferred dimension (employer, comparison,
  function, seniority, geography, period, event, topic, preferences) appears as
  an editable chip. Removing one is authoritative until cleared.
- **Confidence-native.** High confidence transforms the interface. Medium
  confidence exposes the alternatives with their probabilities. Low confidence
  asks. Uncertainty is interface state, and the last valid view stays in place.
- **Semantic cursor.** Recognized concepts are annotated in the user's own
  words. Matching known entities happens on the device while typing; hosted
  Jev runs only on explicit submit or when Live understanding is switched on.
- **Morphing evidence views.** Every question chooses a visual grammar from a
  finite set of canonical views. FAQ entries transform the canvas; they do not
  open generated prose.
- **Evidence Lens.** Every number opens to its question wording, group, n,
  period, verification method, exclusions, release and source identifiers, and
  the related account clusters.
- **Answers assembled from evidence.** A deterministic headline built from the
  released numbers ("Management trust fell from 71% (n=183) to 48% (n=96)
  around the restructuring"), never a model opinion.

## Privacy as visual language

- Drafts stay on the device. Local detectors flag direct identifiers, exact
  dates, narrow locations, unique roles and small teams as the author types.
- "Make safer" walks through each proposed generalization; the author approves
  every edit individually. Testimony is never silently rewritten.
- A meter shows how many identifying details remain, built only from real
  facts. It is not an anonymity guarantee and never claims to be one.
- Only an author-approved, locally checked draft reaches hosted Jev, after
  explicit consent, for contextual re-identification and policy checks.
- Email, verification data, credentials, IP addresses and raw identity-bearing
  drafts never reach Jev or any log. This boundary is enforced by service
  separation, not by promises.

## Constitutional moderation

Nobody at the company decides what you are allowed to say, and there is no
moderator dashboard.

- Jev asks narrow policy questions; deterministic code applies the published,
  versioned constitution (`/moderation/vX.Y.Z.json`). Every decision pins the
  policy version and digest.
- Privacy and safety uncertainty: hold and ask the author to repair.
  Criticism and opinion uncertainty: publish. Spam and manipulation
  uncertainty: anonymous jury. Factual allegations: publish as attributed
  testimony, never as a platform finding of fact.
- Repair-first editing turns names, personal characterizations and broad
  allegations into specific, publishable accounts of what happened.
- Ambiguous cases go to seven randomly selected, temporary, anonymous jurors
  answering one YES / NO / UNSURE question about one rule, with the minimum
  necessary passage. No reputation, no permanent moderators.
- Appeals are automatic: nine different jurors who cannot see the first result.
- Employers get no special button. Anyone can challenge under a cited
  published rule; Jev checks the challenge maps to that rule, reputational
  discomfort is not a ground, and challenge budgets deter abuse. No paid
  priority.
- Every decision produces a receipt: rule, policy version and digest, model,
  decision path, vote summary, appeal and outcome. The public ledger publishes
  aggregates without unpublished text, juror identities or precise timing.
- Break-glass: valid legal orders and credible imminent-safety issues require
  two of three independent trustees, bounded scope, expiry and a transparency
  entry. No single person, including the operator, has a delete button.

## Honesty limits

- Mailbox verification proves control of a work mailbox at verification time,
  not identity, title, current employment or one human per vote.
- Juror eligibility and appeal disjointness are only as strong as the
  credential protocol; the product states the active proof strength.
- Juries, trustee exceptions and real-employer publication run only when
  their prerequisites exist, and the product says which do. Since the public
  launch (September 23, 2026) real-employer publication is on, in batches of
  at least 5 written accounts with survey figures at 25 (accounts submitted
  before the launch keep the batch of 25 they were promised); real-employer
  juries are switched on and form only when enough jurors of curated
  employers can serve, and employers added by the community share one seat
  per case; trustees are not operating.
- The live site holds no fictional data. Fictional sample employers exist only
  in local development and tests, labeled everywhere they appear. Real
  employers show honest empty states until verified evidence clears the
  privacy thresholds.
- Anyone can add a missing employer by name and work-email domain. The
  listing shows its domain, says it was added by the community, and proves
  nothing about the organization; listing is separate from verifying. A wrong
  listing is corrected only when a person reviews a request and applies it,
  never by touching an account, and every correction is publicly logged.
