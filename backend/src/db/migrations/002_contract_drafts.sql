-- ============================================================
--  002_contract_drafts.sql — Contract Draft Storage
-- ============================================================

CREATE TABLE IF NOT EXISTS contract_drafts (
    id            SERIAL PRIMARY KEY,
    draft_id      VARCHAR(50) UNIQUE NOT NULL,
    data          JSONB NOT NULL DEFAULT '{}',
    current_step  INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contract_drafts_draft_id ON contract_drafts(draft_id);
CREATE INDEX IF NOT EXISTS idx_contract_drafts_updated  ON contract_drafts(updated_at);

-- Auto-cleanup: drafts older than 90 days can be purged via cron
-- DELETE FROM contract_drafts WHERE updated_at < NOW() - INTERVAL '90 days';
