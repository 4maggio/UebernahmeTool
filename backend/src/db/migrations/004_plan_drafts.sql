-- ============================================================
--  004_plan_drafts.sql — 5-Jahres-Plan Speichersystem
-- ============================================================

CREATE TABLE IF NOT EXISTS plan_drafts (
    id          SERIAL PRIMARY KEY,
    plan_id     VARCHAR(50) UNIQUE NOT NULL,
    name        VARCHAR(200) NOT NULL DEFAULT '5-Jahres-Plan',
    data        JSONB NOT NULL DEFAULT '{}',
    created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_plan_drafts_owner   ON plan_drafts(created_by);
CREATE INDEX IF NOT EXISTS idx_plan_drafts_active  ON plan_drafts(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_plan_drafts_updated ON plan_drafts(updated_at);
