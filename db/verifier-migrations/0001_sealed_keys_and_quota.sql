-- Verifier 0001: standalone schema for the mailbox verifier (replaces the locally applied db/schema-verify.sql and db/verifier-v2.sql).
-- Issuer private keys are sealed with AES-256-GCM under the ISSUER_MASTER_KEY secret; only ciphertext is stored here.
CREATE TABLE IF NOT EXISTS issuer_keys (
 id TEXT PRIMARY KEY,
 company_slug TEXT NOT NULL,
 epoch TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 verification_class TEXT NOT NULL CHECK(verification_class IN ('demo','mailbox')),
 domains_json TEXT NOT NULL,
 public_key_json TEXT NOT NULL,
 sealed_private_key TEXT NOT NULL
);
-- One-time codes. mailbox_hash is a keyed hash of company, issuance quarter and canonical mailbox.
CREATE TABLE IF NOT EXISTS mailbox_challenges (
 id TEXT PRIMARY KEY,
 key_id TEXT NOT NULL,
 mailbox_hash TEXT NOT NULL,
 code_hash TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0,
 used INTEGER NOT NULL DEFAULT 0,
 blinded_hash TEXT
);
CREATE INDEX IF NOT EXISTS mailbox_challenges_recent ON mailbox_challenges(mailbox_hash, expires_at);
-- One credential per (mailbox, employer, issuance quarter), whichever key signs it. Rows expire at the end of the quarter.
-- blinded_hash lets an identical blinded message be re-signed after a lost response without issuing a second credential.
CREATE TABLE IF NOT EXISTS issuance_quota_v3 (
 mailbox_hash TEXT PRIMARY KEY,
 blinded_hash TEXT NOT NULL,
 expires_at TEXT NOT NULL
);
-- Legacy tables may or may not exist. They are created empty if absent so the scrubs below are valid everywhere.
-- Legacy challenges and quota rows used a per-key mailbox hash that the new quota cannot read; they are deleted
-- rather than retained until their long key expiry. The legacy redemption join key is cleared.
CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY, key_id TEXT NOT NULL, mailbox_hash TEXT NOT NULL, code_hash TEXT NOT NULL, expires_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS issuance_quota_v2 (mailbox_hash TEXT NOT NULL, key_id TEXT NOT NULL, expires_at TEXT NOT NULL, PRIMARY KEY(mailbox_hash,key_id));
CREATE TABLE IF NOT EXISTS issued_credentials (id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL UNIQUE, attestation_ref TEXT NOT NULL, claim_scope TEXT NOT NULL, relationship TEXT NOT NULL, issued_at TEXT NOT NULL, expires_at TEXT NOT NULL, redeemed_at TEXT, redeemed_by TEXT);
DELETE FROM challenges;
DELETE FROM issuance_quota_v2;
UPDATE issued_credentials SET redeemed_by = NULL;
