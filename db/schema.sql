-- Kernel public evidence database (kernel-public)
-- Invariant: nothing here identifies a contributor, and nothing here links a
-- published item to a credential redemption. There is no user table.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('sample','real')),
  sector TEXT,
  hq TEXT,
  headcount_band TEXT,
  founded TEXT,
  sample_disclosure TEXT,
  coverage_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cohorts (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  label TEXT NOT NULL,
  dimension TEXT NOT NULL CHECK (dimension IN ('function','seniority','region','tenure','employment_status','all')),
  parent_id TEXT REFERENCES cohorts(id),
  headcount_band TEXT,
  public INTEGER NOT NULL DEFAULT 1,
  UNIQUE (company_id, dimension, label)
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  slug TEXT NOT NULL,
  label TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('reorg','layoff','leadership','policy','compensation','other')),
  occurred_on TEXT,
  disclosure TEXT NOT NULL,
  source_url TEXT,
  UNIQUE (company_id, slug)
);

CREATE TABLE IF NOT EXISTS metric_definitions (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  question TEXT NOT NULL,
  response_type TEXT NOT NULL CHECK (response_type IN ('percent_agree','scale_5','distribution','number')),
  unit TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('higher_is_better','lower_is_better','neutral')),
  method_note TEXT NOT NULL,
  verification_method TEXT NOT NULL,
  exclusions TEXT,
  sort_order INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS metric_releases (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  metric_id TEXT NOT NULL REFERENCES metric_definitions(id),
  cohort_id TEXT REFERENCES cohorts(id),
  period TEXT NOT NULL,
  value REAL NOT NULL,
  n INTEGER NOT NULL,
  ci_low REAL,
  ci_high REAL,
  event_id TEXT REFERENCES events(id),
  release_batch TEXT NOT NULL,
  published_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (company_id, metric_id, cohort_id, period)
);
CREATE INDEX IF NOT EXISTS idx_releases_company ON metric_releases (company_id, metric_id, period);
CREATE INDEX IF NOT EXISTS idx_releases_cohort ON metric_releases (cohort_id);

CREATE TABLE IF NOT EXISTS testimony (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  cohort_id TEXT REFERENCES cohorts(id),
  layer TEXT NOT NULL CHECK (layer IN ('experience','claim','opinion')),
  body TEXT NOT NULL,
  period TEXT,
  event_id TEXT REFERENCES events(id),
  verification_class TEXT NOT NULL,
  release_batch TEXT NOT NULL,
  published_at TEXT NOT NULL,
  withdrawn_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_testimony_company ON testimony (company_id, published_at DESC);

CREATE TABLE IF NOT EXISTS testimony_topics (
  testimony_id TEXT NOT NULL REFERENCES testimony(id),
  topic TEXT NOT NULL,
  stance TEXT NOT NULL CHECK (stance IN ('positive','negative','mixed','neutral')),
  salience REAL NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  inferred_at TEXT NOT NULL,
  PRIMARY KEY (testimony_id, topic)
);

CREATE TABLE IF NOT EXISTS corroborations (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  cluster_key TEXT NOT NULL,
  summary TEXT NOT NULL,
  reporter_count INTEGER NOT NULL,
  first_report TEXT NOT NULL,
  last_report TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (company_id, cluster_key)
);

CREATE TABLE IF NOT EXISTS question_trails (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  canonical_question TEXT NOT NULL,
  intent_hint TEXT,
  ask_count INTEGER NOT NULL DEFAULT 0,
  first_asked TEXT NOT NULL,
  last_asked TEXT NOT NULL,
  approved INTEGER NOT NULL DEFAULT 0,
  UNIQUE (company_id, canonical_question)
);

-- Intake. Payloads are scrubbed and author-approved before they reach here.
-- withdrawal_capability_hash is a hash of a random token the author keeps; the
-- server cannot invert it and stores no identity next to it.
CREATE TABLE IF NOT EXISTS pending_submissions (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  cohort_id TEXT REFERENCES cohorts(id),
  layer TEXT NOT NULL CHECK (layer IN ('experience','claim','opinion')),
  payload_json TEXT NOT NULL,
  structured_json TEXT,
  claim_id TEXT NOT NULL,
  withdrawal_capability_hash TEXT NOT NULL,
  privacy_report_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued','held','released','published','rejected','withdrawn')),
  release_after TEXT NOT NULL,
  release_batch TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  withdrawn_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_submissions (status, release_after);

CREATE TABLE IF NOT EXISTS moderation_actions (
  id TEXT PRIMARY KEY,
  submission_id TEXT,
  action TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  rule_applied TEXT NOT NULL,
  automated INTEGER NOT NULL,
  model TEXT,
  prompt_version TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS financial_entries (
  id TEXT PRIMARY KEY,
  period TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('cost','donation','runway')),
  category TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS legal_requests (
  id TEXT PRIMARY KEY,
  received_on TEXT NOT NULL,
  kind TEXT NOT NULL,
  jurisdiction TEXT NOT NULL,
  scope_summary TEXT NOT NULL,
  responded TEXT NOT NULL,
  data_disclosed TEXT,
  privileges_asserted TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS moderation_stats (
  id TEXT PRIMARY KEY,
  period TEXT NOT NULL,
  metric TEXT NOT NULL,
  value REAL NOT NULL,
  UNIQUE (period, metric)
);

CREATE TABLE IF NOT EXISTS covenant_versions (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL UNIQUE,
  effective_on TEXT NOT NULL,
  principles_json TEXT NOT NULL,
  change_note TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS distribution_bands (
  release_id TEXT NOT NULL REFERENCES metric_releases(id),
  band TEXT NOT NULL,
  share REAL NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (release_id, band)
);
