-- Public 0001: reconciles the public database with the schema the code expects. Mostly additive (tables created only
-- if missing, append-only triggers), but it CHANGES EXISTING ROWS: it clears confidence bounds stored with only a lower
-- bound in metric_releases; rewrites fixture provenance in testimony_topics (model 'jev-1.13' becomes
-- 'illustrative-fixture' and prompt_version 'sample-fixture' for accounts of fictional sample employers); turns the text
-- 'NULL' in events.source_url into a real NULL; blanks every pending_submissions.claim_id; and deletes every row of
-- rate_limits. This header is a comment only: it does not change which migrations Wrangler records as applied.
CREATE TABLE IF NOT EXISTS trusted_issuers (
  id TEXT PRIMARY KEY,
  company_slug TEXT NOT NULL,
  epoch TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  verification_class TEXT NOT NULL CHECK(verification_class IN ('demo','mailbox')),
  public_key_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS spent_tokens (
  nullifier TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS evidence_analysis (
  testimony_id TEXT PRIMARY KEY REFERENCES testimony(id),
  analysis_json TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  source_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS evidence_pairs (
  left_id TEXT NOT NULL REFERENCES testimony(id),
  right_id TEXT NOT NULL REFERENCES testimony(id),
  same_event REAL NOT NULL,
  copied REAL NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  PRIMARY KEY(left_id, right_id)
);
CREATE TABLE IF NOT EXISTS faq_interest (
  company_id TEXT NOT NULL REFERENCES companies(id),
  canonical_id TEXT NOT NULL,
  period TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(company_id, canonical_id, period)
);
CREATE TABLE IF NOT EXISTS structured_responses (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  period TEXT NOT NULL,
  answers_json TEXT NOT NULL,
  source_testimony_id TEXT NOT NULL UNIQUE,
  verification_class TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS release_manifests (
  id TEXT PRIMARY KEY,
  period TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  digest TEXT NOT NULL,
  previous_digest TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS inference_health (
  period TEXT NOT NULL,
  outcome TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(period, outcome)
);
UPDATE metric_releases SET ci_low = NULL, ci_high = NULL
 WHERE ci_high IS NULL AND ci_low IS NOT NULL;
UPDATE testimony_topics SET model = 'illustrative-fixture', prompt_version = 'sample-fixture'
 WHERE testimony_id IN (SELECT t.id FROM testimony t JOIN companies c ON c.id=t.company_id WHERE c.kind='sample')
 AND model = 'jev-1.13';
UPDATE events SET source_url = NULL WHERE source_url = 'NULL';
UPDATE pending_submissions SET claim_id = '';
DELETE FROM rate_limits;
CREATE TRIGGER IF NOT EXISTS financial_no_update BEFORE UPDATE ON financial_entries BEGIN SELECT RAISE(ABORT, 'append_only'); END;
CREATE TRIGGER IF NOT EXISTS financial_no_delete BEFORE DELETE ON financial_entries BEGIN SELECT RAISE(ABORT, 'append_only'); END;
CREATE TRIGGER IF NOT EXISTS legal_no_update BEFORE UPDATE ON legal_requests BEGIN SELECT RAISE(ABORT, 'append_only'); END;
CREATE TRIGGER IF NOT EXISTS legal_no_delete BEFORE DELETE ON legal_requests BEGIN SELECT RAISE(ABORT, 'append_only'); END;
CREATE TRIGGER IF NOT EXISTS moderation_no_update BEFORE UPDATE ON moderation_actions BEGIN SELECT RAISE(ABORT, 'append_only'); END;
CREATE TRIGGER IF NOT EXISTS moderation_no_delete BEFORE DELETE ON moderation_actions BEGIN SELECT RAISE(ABORT, 'append_only'); END;
