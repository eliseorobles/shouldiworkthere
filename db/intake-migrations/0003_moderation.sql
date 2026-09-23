-- Intake 0003: constitutional moderation (private). Additive: new tables, indexes and nullable columns only.
-- Nothing here names a juror, a challenger or a connecting address, and no challenge reason is stored.

-- One case asks one YES/NO/UNSURE question about one rule for one subject revision.
--  subject_id: the private submission id (NULL only for a seeded fixture, which has no author).
--  public_id: the published account the case is about: set when a challenge opens it, copied from the first case by
--    an appeal, and set on a held submission's closed cases when those words are published. Keys finality.
--  passage: the text jurors see, with detected identifiers masked; emptied when the case closes.
--  close_token/applied: exactly one closer applies the outcome; housekeeping re-applies an interrupted one.
CREATE TABLE IF NOT EXISTS jury_cases (
  id TEXT PRIMARY KEY,
  stage TEXT NOT NULL CHECK (stage IN ('initial','appeal')),
  parent_id TEXT,
  origin TEXT NOT NULL CHECK (origin IN ('screening','challenge','appeal')),
  subject_id TEXT,
  subject_revision INTEGER NOT NULL DEFAULT 0,
  public_id TEXT,
  company_id TEXT NOT NULL,
  jury_class TEXT NOT NULL CHECK (jury_class IN ('sandbox','mailbox')),
  rule_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  policy_digest TEXT NOT NULL,
  passage TEXT NOT NULL,
  required INTEGER NOT NULL,
  upheld_at INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','closed','expired')),
  outcome TEXT CHECK (outcome IN ('upheld','cleared','no_quorum','moot')),
  yes INTEGER NOT NULL DEFAULT 0,
  no INTEGER NOT NULL DEFAULT 0,
  unsure INTEGER NOT NULL DEFAULT 0,
  opened_at TEXT NOT NULL,
  period TEXT NOT NULL,
  closed_period TEXT,
  close_token TEXT,
  applied INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS jury_cases_open ON jury_cases (state, jury_class);
CREATE INDEX IF NOT EXISTS jury_cases_subject ON jury_cases (subject_id, subject_revision);
CREATE INDEX IF NOT EXISTS jury_cases_item ON jury_cases (public_id, rule_id);
-- Duplicate challenges merge into the open case; a screening decision opens one case per rule and revision; one appeal per decision.
CREATE UNIQUE INDEX IF NOT EXISTS jury_cases_one_open_item ON jury_cases (public_id, rule_id) WHERE state = 'open' AND public_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS jury_cases_one_screening ON jury_cases (subject_id, subject_revision, rule_id) WHERE origin = 'screening';
CREATE UNIQUE INDEX IF NOT EXISTS jury_cases_one_appeal ON jury_cases (parent_id) WHERE parent_id IS NOT NULL;

-- One seat. id is a digest of the juror's assignment secret; nothing links it to a token, mailbox or address (the token's
-- nullifier is recorded separately in spent_proofs). seat_group, for real-employer cases only, is an HMAC (under the
-- worker secret RATE_LIMIT_SECRET; a plain digest without it) of the case and the token's employer, so no employer fills
-- more seats than the policy allows. Seats are deleted when the case closes.
CREATE TABLE IF NOT EXISTS jury_assignments (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  seat_group TEXT,
  expires_at TEXT NOT NULL,
  vote TEXT CHECK (vote IN ('YES','NO','UNSURE'))
);
CREATE INDEX IF NOT EXISTS jury_assignments_case ON jury_assignments (case_id);

-- Challenge receipts: the account, the cited rule, the pinned policy, the decision path and outcome, and a quarter.
CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  public_id TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  policy_digest TEXT NOT NULL,
  path TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('rejected','jury','withheld_for_repair','merged')),
  relevance TEXT,
  case_id TEXT,
  period TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS challenges_item ON challenges (public_id, rule_id);
CREATE INDEX IF NOT EXISTS challenges_period ON challenges (period);

-- The decision (never the risk signals) of re-checking one published account under one policy version. Reused, so
-- repeated challenges cannot re-roll the model.
CREATE TABLE IF NOT EXISTS rescreens (
  public_id TEXT NOT NULL,
  policy_digest TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  action TEXT NOT NULL,
  rules_json TEXT NOT NULL,
  provider TEXT,
  provider_fallback TEXT,
  key_source TEXT,
  model TEXT,
  prompt_version TEXT,
  period TEXT NOT NULL,
  PRIMARY KEY (public_id, policy_digest)
);

-- Aggregate counters only: repair requests per quarter; hosted challenge relevance checks and re-checks per UTC day, and
-- the minute until which the hosted relevance check is skipped after a failure (daily rows are pruned after two days).
CREATE TABLE IF NOT EXISTS moderation_counters (
  period TEXT NOT NULL,
  metric TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (period, metric)
);

-- Trustee exceptions (disabled until trustee keys are configured): accepted nonces, and active withholdings with expiry.
CREATE TABLE IF NOT EXISTS exception_nonces (
  nonce TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS exceptions (
  id TEXT PRIMARY KEY,
  public_id TEXT NOT NULL,
  submission_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('legal_order','imminent_safety')),
  expires_at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','lapsed')),
  period TEXT NOT NULL
);

-- Every stored decision also pins whether a fallback provider served it and the gateway key source.
ALTER TABLE actions ADD COLUMN provider_fallback TEXT;
ALTER TABLE actions ADD COLUMN key_source TEXT;
-- A published account withheld for repair keeps its original public fields (never its author) so an overturned
-- decision can restore it under the same public id. Erased with the rest of the row.
ALTER TABLE submissions ADD COLUMN public_meta TEXT;
-- 1 only if the author allowed anonymous jurors to read these unpublished words (masked) should screening hold them for
-- a jury. Rows without it, including every row accepted before this migration, never go to a jury while unpublished.
ALTER TABLE submissions ADD COLUMN jury_consent INTEGER NOT NULL DEFAULT 0;
