-- #633 / #634 / #637 / #638
-- Review moderation status, appeals, policy stamps, host-response audit,
-- and on-chain review sync / repair queue.
-- Policy version bumps never rewrite historical decisions (stamped columns).

-- ── Moderation status (port from root database/migrations/002) ───────────────
ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS moderation_status VARCHAR(20) DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS moderation_reason TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reviews_moderation_status_check'
  ) THEN
    ALTER TABLE reviews
      ADD CONSTRAINT reviews_moderation_status_check
      CHECK (moderation_status IN (
        'pending', 'approved', 'rejected', 'hidden', 'appealed', 'appeal_denied'
      ));
  END IF;
END $$;

-- Expand check to include new states if an older narrower check exists
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_moderation_status_check;
ALTER TABLE reviews
  ADD CONSTRAINT reviews_moderation_status_check
  CHECK (moderation_status IN (
    'pending', 'approved', 'rejected', 'hidden', 'appealed', 'appeal_denied'
  ));

CREATE INDEX IF NOT EXISTS idx_reviews_moderation_status
  ON reviews(moderation_status)
  WHERE moderation_status IS DISTINCT FROM 'approved';

-- Backfill from legacy is_approved
UPDATE reviews
SET moderation_status = 'approved'
WHERE moderation_status IS NULL AND COALESCE(is_approved, true) = true;

UPDATE reviews
SET moderation_status = 'rejected'
WHERE moderation_status IS NULL AND is_approved = false;

UPDATE reviews
SET moderation_status = 'pending'
WHERE moderation_status IS NULL;

-- ── Immutable original content + policy stamps (#633 / #638) ────────────────
ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS original_comment TEXT,
  ADD COLUMN IF NOT EXISTS policy_code TEXT,
  ADD COLUMN IF NOT EXISTS policy_version TEXT,
  ADD COLUMN IF NOT EXISTS public_status_explanation TEXT,
  ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS moderated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS appeal_status VARCHAR(20) DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS appeal_reason TEXT,
  ADD COLUMN IF NOT EXISTS appeal_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS appeal_deadline_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS appeal_resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS appeal_resolution_note TEXT,
  ADD COLUMN IF NOT EXISTS visible_in_aggregates BOOLEAN NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reviews_appeal_status_check'
  ) THEN
    ALTER TABLE reviews
      ADD CONSTRAINT reviews_appeal_status_check
      CHECK (appeal_status IN ('none', 'pending', 'approved', 'denied', 'expired'));
  END IF;
END $$;

-- Snapshot original comment once for existing rows (immutable thereafter in app)
UPDATE reviews
SET original_comment = comment
WHERE original_comment IS NULL AND comment IS NOT NULL;

-- Aggregates only count eligible visible reviews
UPDATE reviews
SET visible_in_aggregates = false
WHERE moderation_status IN ('rejected', 'hidden', 'appeal_denied');

UPDATE reviews
SET visible_in_aggregates = true
WHERE moderation_status IN ('approved', 'pending', 'appealed')
   OR moderation_status IS NULL;

CREATE INDEX IF NOT EXISTS idx_reviews_visible_aggregates
  ON reviews(property_id, visible_in_aggregates)
  WHERE visible_in_aggregates = true;

CREATE INDEX IF NOT EXISTS idx_reviews_appeal_pending
  ON reviews(appeal_status, appeal_deadline_at)
  WHERE appeal_status = 'pending';

-- ── Host response lifecycle (#634) ──────────────────────────────────────────
ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS host_response_status VARCHAR(20) DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS host_response_policy_code TEXT,
  ADD COLUMN IF NOT EXISTS host_response_edited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS host_response_edit_deadline_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reviews_host_response_status_check'
  ) THEN
    ALTER TABLE reviews
      ADD CONSTRAINT reviews_host_response_status_check
      CHECK (host_response_status IN (
        'none', 'visible', 'edited', 'hidden', 'removed'
      ));
  END IF;
END $$;

UPDATE reviews
SET host_response_status = 'visible'
WHERE host_response IS NOT NULL
  AND (host_response_status IS NULL OR host_response_status = 'none');

CREATE TABLE IF NOT EXISTS host_response_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id UUID NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  host_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  action VARCHAR(20) NOT NULL CHECK (action IN ('created', 'edited', 'hidden', 'removed', 'restored')),
  policy_code TEXT,
  policy_version TEXT,
  moderator_id UUID REFERENCES users(id) ON DELETE SET NULL,
  moderator_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_host_response_history_review
  ON host_response_history(review_id, created_at DESC);

-- ── On-chain review sync / repair queue (#637) ──────────────────────────────
ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS on_chain_tx_hash TEXT,
  ADD COLUMN IF NOT EXISTS chain_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS chain_sync_status VARCHAR(20) DEFAULT 'unlinked';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reviews_chain_sync_status_check'
  ) THEN
    ALTER TABLE reviews
      ADD CONSTRAINT reviews_chain_sync_status_check
      CHECK (chain_sync_status IN (
        'unlinked', 'linked', 'mismatch', 'missing_on_chain', 'duplicate'
      ));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS review_sync_repair_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id UUID REFERENCES reviews(id) ON DELETE SET NULL,
  on_chain_id BIGINT,
  issue_type VARCHAR(40) NOT NULL CHECK (issue_type IN (
    'missing', 'duplicate', 'conflict', 'orphan_chain', 'rating_mismatch', 'comment_mismatch'
  )),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'resolved', 'ignored')),
  alerted_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_review_sync_repair_open
  ON review_sync_repair_queue(status, created_at)
  WHERE status IN ('open', 'in_progress');

CREATE UNIQUE INDEX IF NOT EXISTS idx_review_sync_repair_dedupe
  ON review_sync_repair_queue(COALESCE(review_id, '00000000-0000-0000-0000-000000000000'::uuid), issue_type, COALESCE(on_chain_id, -1))
  WHERE status IN ('open', 'in_progress');

-- Allow sync_log to record review entity syncs when the table exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'sync_log'
  ) THEN
    BEGIN
      ALTER TABLE sync_log DROP CONSTRAINT IF EXISTS sync_log_entity_type_check;
      ALTER TABLE sync_log
        ADD CONSTRAINT sync_log_entity_type_check
        CHECK (entity_type IN ('property', 'booking', 'review'));
    EXCEPTION WHEN others THEN
      -- Older schemas without the check constraint are fine
      NULL;
    END;
  END IF;
END $$;

COMMENT ON COLUMN reviews.policy_version IS
  'Safety policy version stamped at decision time; never rewritten on policy bumps.';
COMMENT ON COLUMN reviews.original_comment IS
  'Immutable snapshot of the review body at submission; moderation hides, does not rewrite.';
COMMENT ON COLUMN reviews.on_chain_id IS
  'Immutable chain reference. Off-chain moderation never mutates this value.';
