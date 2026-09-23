-- 0011: the public listing correction log (owner decision 4 and the terms' "Correcting a listing"). Additive only: one
-- new append-only table; no existing row is read or changed.
--
-- One row per correction of an employer listing, applied by worker/src/community.ts correctListing (POST
-- /api/directory/correct, with ADMIN_TOKEN, after a person reviewed the request) or by the scheduled job when it mirrors
-- a takedown made at the verifier (reason 'verifier_withdrawn'):
--   action: 'detach' (a community-added domain and its signing keys removed), 'withdraw' (a community listing removed,
--     only while nothing about it is published or waiting) or 'rename' (a community listing's name fixed);
--   reason: why, from a fixed list;
--   period: the quarter; target_digest: SHA-256 (base64url) of "siwt-listing-v1:" and the listing's slug, never the slug
--   or the name, which may be what was wrong.
-- No person, requester, text or precise time is stored. A correction never changes, withholds or removes an account.
CREATE TABLE IF NOT EXISTS listing_corrections (
  id TEXT PRIMARY KEY,
  period TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('detach','withdraw','rename')),
  reason TEXT NOT NULL CHECK (reason IN ('wrong_organization','wrong_domain','duplicate','content_rules','legal_order','verifier_withdrawn')),
  target_digest TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS listing_corrections_period ON listing_corrections(period);
CREATE TRIGGER IF NOT EXISTS listing_corrections_no_update BEFORE UPDATE ON listing_corrections BEGIN SELECT RAISE(ABORT, 'append_only'); END;
CREATE TRIGGER IF NOT EXISTS listing_corrections_no_delete BEFORE DELETE ON listing_corrections BEGIN SELECT RAISE(ABORT, 'append_only'); END;
