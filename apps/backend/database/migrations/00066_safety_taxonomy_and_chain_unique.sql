-- #638 / #637 — Expand report reason taxonomy to versioned safety codes;
-- unique on-chain review references for sync integrity.

-- Expand reports.reason to the full safety taxonomy
ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_reason_check;

ALTER TABLE reports
  ADD CONSTRAINT reports_reason_check
  CHECK (reason IN (
    'harassment',
    'discrimination',
    'fraud',
    'unsafe_property',
    'privacy_violation',
    'retaliatory_review',
    'spam',
    'inappropriate',
    'misleading',
    'other'
  ));

-- Stamp decision-time policy version on reports without rewriting history
ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS policy_code TEXT,
  ADD COLUMN IF NOT EXISTS policy_version TEXT;

COMMENT ON COLUMN reports.policy_version IS
  'Safety policy version stamped at report/decision time; never rewritten on policy bumps.';

-- One DB review per on-chain ID when linked
CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_on_chain_id_unique
  ON reviews(on_chain_id)
  WHERE on_chain_id IS NOT NULL;
