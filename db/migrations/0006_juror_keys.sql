-- Public 0006: issuer keys state their purpose. Additive: existing keys become 'contribution' by default and no row is
-- changed otherwise. Juror keys ('juror', ids `${slug}:${epoch}:juror:${class}`) sign anonymous juror tokens only; the
-- protocol refuses a key whose purpose disagrees with its id, and never accepts a juror key for a contribution.
ALTER TABLE trusted_issuers ADD COLUMN purpose TEXT NOT NULL DEFAULT 'contribution' CHECK (purpose IN ('contribution','juror'));
