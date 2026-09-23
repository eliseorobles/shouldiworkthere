-- Kernel verifier database (kernel-verify)
-- Separate database, separate operator target. The verifier knows who is
-- verified and never learns what was published. The publisher knows what was
-- published and never learns who published it. Nothing joins these two
-- databases: there is no shared identifier for a person.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS attestation_jobs (
  id TEXT PRIMARY KEY,
  employer_domain TEXT NOT NULL,
  employer_label TEXT NOT NULL,
  relationship TEXT NOT NULL CHECK (relationship IN ('current','former','contract')),
  claim_scope TEXT NOT NULL,
  verification_method TEXT NOT NULL,
  challenge_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','attested','expired','failed')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attestation_state ON attestation_jobs (state, expires_at);

CREATE TABLE IF NOT EXISTS issued_credentials (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL UNIQUE,
  attestation_ref TEXT NOT NULL,
  claim_scope TEXT NOT NULL,
  relationship TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  redeemed_at TEXT,
  redeemed_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_issued_expiry ON issued_credentials (expires_at);

CREATE TABLE IF NOT EXISTS issuance_quota (
  bucket TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS revocation_list (
  credential_id TEXT PRIMARY KEY,
  revoked_at TEXT NOT NULL,
  reason TEXT NOT NULL
);
