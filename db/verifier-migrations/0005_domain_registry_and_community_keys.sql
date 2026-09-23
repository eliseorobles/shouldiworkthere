-- Verifier 0005: the employer domain registry and community keys (owner decision 4, 2026-09-23). Additive only: one new
-- table and one new column; no existing row is changed or deleted, and every existing key becomes a curated key.
--
-- employer_domains: the work-email domain registered for an employer that has none of its own curated keys, either a
-- community listing (anyone may list an employer with its domain) or a domain attached to an existing listing after the
-- main worker's plausibility checks. The main worker registers it over a service binding authenticated by INTERNAL_TOKEN
-- (POST /internal/employers). A domain belongs to at most one employer and an employer has at most one registered
-- domain. Nothing here identifies a contributor: listing an employer is separate from verifying a mailbox. The quarter of
-- registration is kept, no finer time.
CREATE TABLE IF NOT EXISTS employer_domains (
 domain TEXT PRIMARY KEY,
 company_slug TEXT NOT NULL UNIQUE,
 registered_quarter TEXT NOT NULL,
 CONSTRAINT employer_domain_form CHECK (domain = lower(domain) AND length(domain) BETWEEN 3 AND 253 AND instr(domain, '.') > 0 AND instr(domain, '@') = 0 AND instr(domain, ' ') = 0)
);
-- 'curated': written by tools/provision-issuer.mjs and pinned by the release built from its registry. 'community': created
-- here on demand for a registered domain (ids end in ':community'), with conservative limits; /keys states the source.
ALTER TABLE issuer_keys ADD COLUMN source TEXT NOT NULL DEFAULT 'curated' CHECK (source IN ('curated', 'community'));
