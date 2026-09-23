CREATE TABLE IF NOT EXISTS challenges (
 id TEXT PRIMARY KEY,
 key_id TEXT NOT NULL,
 mailbox_hash TEXT NOT NULL,
 code_hash TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0,
 used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS issuance_quota_v2 (
 mailbox_hash TEXT NOT NULL,
 key_id TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 PRIMARY KEY(mailbox_hash,key_id)
);
UPDATE issued_credentials SET redeemed_by = NULL;
