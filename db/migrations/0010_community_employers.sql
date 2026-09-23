-- 0010: community employer listings (owner decision 4). Additive only: two new columns with defaults, one new table and
-- one index; existing rows keep every value (companies become origin 'curated', issuer keys source 'curated'). The only
-- rows written are employer_domains rows for the nine curated employers whose verification domains are already
-- provisioned in the verifier (tools/provision-issuer.mjs EMPLOYERS), inserted with INSERT OR IGNORE ... SELECT, so a row
-- is added only when that employer exists here and nothing is ever replaced.
--
-- companies.origin: 'community' for an employer a visitor listed (POST /api/employers); shown with its domain beside the
--   name and labeled as added by the community.
-- employer_domains: one row per work-mail domain verification accepts. domain is the primary key, so the same domain can
--   never be listed twice. source: 'curated' (provisioned by the operator) or 'community' (added through
--   /api/employers, either as a new listing or attached to a curated listing that had none). registered: 1 once the
--   verifier acknowledged the domain (it holds the domain registry and creates the keys); 0 while the scheduled job
--   retries. position orders an employer's domains, primary first. No person, address or time is stored.
-- trusted_issuers.source: 'community' for keys the verifier created for a community-added domain (copied from its public
--   /keys; they cannot be pinned by a release built before they existed), 'curated' for provisioned keys.
ALTER TABLE companies ADD COLUMN origin TEXT NOT NULL DEFAULT 'curated' CHECK (origin IN ('curated','community'));
ALTER TABLE trusted_issuers ADD COLUMN source TEXT NOT NULL DEFAULT 'curated' CHECK (source IN ('curated','community'));
CREATE TABLE IF NOT EXISTS employer_domains (
  domain TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('curated','community')),
  position INTEGER NOT NULL DEFAULT 0,
  registered INTEGER NOT NULL DEFAULT 0 CHECK (registered IN (0,1))
);
CREATE INDEX IF NOT EXISTS employer_domains_company ON employer_domains(company_id);
INSERT OR IGNORE INTO employer_domains(domain,company_id,source,position,registered) SELECT 'stripe.com',id,'curated',0,1 FROM companies WHERE slug='stripe' AND kind='real';
INSERT OR IGNORE INTO employer_domains(domain,company_id,source,position,registered) SELECT 'cloudflare.com',id,'curated',0,1 FROM companies WHERE slug='cloudflare' AND kind='real';
INSERT OR IGNORE INTO employer_domains(domain,company_id,source,position,registered) SELECT 'google.com',id,'curated',0,1 FROM companies WHERE slug='google' AND kind='real';
INSERT OR IGNORE INTO employer_domains(domain,company_id,source,position,registered) SELECT 'microsoft.com',id,'curated',0,1 FROM companies WHERE slug='microsoft' AND kind='real';
INSERT OR IGNORE INTO employer_domains(domain,company_id,source,position,registered) SELECT 'openai.com',id,'curated',0,1 FROM companies WHERE slug='openai' AND kind='real';
INSERT OR IGNORE INTO employer_domains(domain,company_id,source,position,registered) SELECT 'anthropic.com',id,'curated',0,1 FROM companies WHERE slug='anthropic' AND kind='real';
INSERT OR IGNORE INTO employer_domains(domain,company_id,source,position,registered) SELECT 'meta.com',id,'curated',0,1 FROM companies WHERE slug='meta' AND kind='real';
INSERT OR IGNORE INTO employer_domains(domain,company_id,source,position,registered) SELECT 'fb.com',id,'curated',1,1 FROM companies WHERE slug='meta' AND kind='real';
INSERT OR IGNORE INTO employer_domains(domain,company_id,source,position,registered) SELECT 'amazon.com',id,'curated',0,1 FROM companies WHERE slug='amazon' AND kind='real';
INSERT OR IGNORE INTO employer_domains(domain,company_id,source,position,registered) SELECT 'nvidia.com',id,'curated',0,1 FROM companies WHERE slug='nvidia' AND kind='real';
