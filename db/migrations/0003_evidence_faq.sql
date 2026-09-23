-- Additive indexes for the evidence compiler: cross-employer discovery reads releases by metric,
-- corroboration reads pair judgments from either side, and the FAQ reads coarse interest by quarter.
CREATE INDEX IF NOT EXISTS idx_releases_metric ON metric_releases (metric_id, period);
CREATE INDEX IF NOT EXISTS idx_pairs_right ON evidence_pairs (right_id);
CREATE INDEX IF NOT EXISTS idx_faq_interest_period ON faq_interest (company_id, period);
