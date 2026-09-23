-- Public 0004: legacy privacy scrub.
-- UPDATEs only: no row is deleted and no structure changes. Every statement is idempotent and touches only rows written
-- by earlier software versions; rows written by the current publisher already have these shapes.

-- 1. Stored analyses made under older prompts can still hold per-account risk answers. They are never served (the
--    evidence compiler allowlists descriptive keys) and are no longer computed on published text; remove the stored copies.
UPDATE evidence_analysis
   SET analysis_json = json_remove(analysis_json, '$.private_identity', '$.contextual_identity', '$.threat', '$.doxxing',
                                   '$.personal_attack', '$.promotional', '$.manipulation')
 WHERE json_valid(analysis_json)
   AND (json_type(analysis_json, '$.private_identity') IS NOT NULL OR json_type(analysis_json, '$.contextual_identity') IS NOT NULL
     OR json_type(analysis_json, '$.threat') IS NOT NULL OR json_type(analysis_json, '$.doxxing') IS NOT NULL
     OR json_type(analysis_json, '$.personal_attack') IS NOT NULL OR json_type(analysis_json, '$.promotional') IS NOT NULL
     OR json_type(analysis_json, '$.manipulation') IS NOT NULL);

-- 2. Kernel-era verification classes embedded a claim id ('..., single use credential, claim claim_xxxxxx') that doubled
--    as a join key to issued credentials. Replace them with one fixed neutral string (worker/src/evidence.ts
--    LEGACY_CREDENTIAL_CLASS, labelled "Earlier demonstration credential — not employment-verified").
UPDATE testimony
   SET verification_class = 'Earlier demonstration credential; not employment-verified'
 WHERE verification_class GLOB '*claim claim_*' OR verification_class LIKE '%single use credential%';

-- 3. Exact publication and creation timestamps reveal publication order. Current rows carry the reporting quarter only
--    (YYYY-Qn); coarsen date-shaped legacy values the same way. withdrawn_at is not touched: the publisher uses it as a
--    marker during withdrawals.
UPDATE testimony
   SET published_at = substr(published_at, 1, 4) || '-Q' || ((CAST(substr(published_at, 6, 2) AS INTEGER) + 2) / 3)
 WHERE published_at GLOB '[12][0-9][0-9][0-9]-[01][0-9]*'
   AND CAST(substr(published_at, 6, 2) AS INTEGER) BETWEEN 1 AND 12;
UPDATE testimony
   SET created_at = substr(created_at, 1, 4) || '-Q' || ((CAST(substr(created_at, 6, 2) AS INTEGER) + 2) / 3)
 WHERE created_at GLOB '[12][0-9][0-9][0-9]-[01][0-9]*'
   AND CAST(substr(created_at, 6, 2) AS INTEGER) BETWEEN 1 AND 12;
UPDATE testimony
   SET release_batch = substr(release_batch, 1, 4) || '-Q' || ((CAST(substr(release_batch, 6, 2) AS INTEGER) + 2) / 3)
 WHERE release_batch GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]*'
   AND CAST(substr(release_batch, 6, 2) AS INTEGER) BETWEEN 1 AND 12;
