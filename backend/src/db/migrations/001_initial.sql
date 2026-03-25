-- ============================================================
--  001_initial.sql  –  Vollständiges Datenbankschema
--  Datenbank: unternehmensbewertung
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ──────────────────────────────────
--  Admin users
-- ──────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_users (
  id            SERIAL PRIMARY KEY,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          VARCHAR(50) NOT NULL DEFAULT 'editor',   -- 'superadmin' | 'editor'
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ──────────────────────────────────
--  Knowledge base
-- ──────────────────────────────────
CREATE TABLE IF NOT EXISTS knowledge_entries (
  id                     SERIAL PRIMARY KEY,
  category               VARCHAR(100) NOT NULL,          -- rechtsformen | bewertungsmethoden | deal_struktur | due_diligence | steuer | recht | finanzierung | integration | branchenprofile | checklisten
  subcategory            VARCHAR(100),
  slug                   VARCHAR(200) UNIQUE NOT NULL,
  title_de               TEXT NOT NULL,
  title_en               TEXT NOT NULL,
  content_de             TEXT NOT NULL,                  -- Markdown
  content_en             TEXT NOT NULL,                  -- Markdown
  summary_de             VARCHAR(400),
  summary_en             VARCHAR(400),
  source_type            VARCHAR(30) NOT NULL DEFAULT 'manual', -- manual | scraped | ai_generated
  source_url             TEXT,
  source_law_paragraph   VARCHAR(100),                   -- z.B. "§ 16 EStG"
  valid_from             DATE,
  last_verified          DATE,
  version                INTEGER NOT NULL DEFAULT 1,
  tags                   TEXT[] DEFAULT '{}',
  applies_to_rechtsformen TEXT[] DEFAULT '{}',           -- ['GbR','GmbH',...]
  is_active              BOOLEAN NOT NULL DEFAULT TRUE,
  created_by             INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  updated_by             INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_category ON knowledge_entries(category);
CREATE INDEX IF NOT EXISTS idx_knowledge_active    ON knowledge_entries(is_active);
CREATE INDEX IF NOT EXISTS idx_knowledge_tags      ON knowledge_entries USING GIN(tags);

-- Pending AI-generated update proposals (require admin approval before going live)
CREATE TABLE IF NOT EXISTS knowledge_pending (
  id                  SERIAL PRIMARY KEY,
  knowledge_entry_id  INTEGER REFERENCES knowledge_entries(id) ON DELETE CASCADE,
  proposed_content_de TEXT,
  proposed_content_en TEXT,
  proposed_summary_de VARCHAR(400),
  proposed_summary_en VARCHAR(400),
  source_url          TEXT,
  source_law_paragraph VARCHAR(100),
  diff_summary        TEXT,
  scraper_run_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by         INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  reviewed_at         TIMESTAMPTZ,
  status              VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ──────────────────────────────────
--  Checklists (versioned, per type)
-- ──────────────────────────────────
CREATE TABLE IF NOT EXISTS checklists (
  id          SERIAL PRIMARY KEY,
  type        VARCHAR(100) NOT NULL,   -- kaeuferpruefung | verkaufsvorb | steuerberater | due_diligence_financial | due_diligence_legal | due_diligence_ops | post_closing
  lang        CHAR(2) NOT NULL DEFAULT 'de',
  version     INTEGER NOT NULL DEFAULT 1,
  items       JSONB NOT NULL,          -- [{id, text, category, required, helpText}]
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(type, lang)
);

CREATE INDEX IF NOT EXISTS idx_checklist_type ON checklists(type, lang);

-- ──────────────────────────────────
--  Branchenmultiplikatoren
-- ──────────────────────────────────
CREATE TABLE IF NOT EXISTS industry_multipliers (
  id              SERIAL PRIMARY KEY,
  industry_key    VARCHAR(100) UNIQUE NOT NULL,  -- 'ecommerce' | 'agrar_handel' | 'saas' | ...
  label_de        VARCHAR(200) NOT NULL,
  label_en        VARCHAR(200) NOT NULL,
  ebitda_min      NUMERIC(5,2),
  ebitda_max      NUMERIC(5,2),
  ebitda_median   NUMERIC(5,2),
  revenue_min     NUMERIC(5,2),
  revenue_max     NUMERIC(5,2),
  revenue_median  NUMERIC(5,2),
  notes_de        TEXT,
  notes_en        TEXT,
  source          TEXT,
  last_updated    DATE NOT NULL DEFAULT CURRENT_DATE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ──────────────────────────────────
--  Analysis sessions (anonymisiert)
-- ──────────────────────────────────
CREATE TABLE IF NOT EXISTS analysis_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_data    JSONB NOT NULL,    -- alle Eingaben (kein Pflichtfeld für Namen)
  result          JSONB,             -- Bewertungsergebnis
  lang            CHAR(2) NOT NULL DEFAULT 'de',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '90 days')
);

CREATE INDEX IF NOT EXISTS idx_sessions_created ON analysis_sessions(created_at);

-- ──────────────────────────────────
--  Scraper run log
-- ──────────────────────────────────
CREATE TABLE IF NOT EXISTS scraper_runs (
  id              SERIAL PRIMARY KEY,
  scraper_name    VARCHAR(100) NOT NULL,
  status          VARCHAR(20) NOT NULL,   -- success | error | no_change
  pages_scraped   INTEGER DEFAULT 0,
  changes_found   INTEGER DEFAULT 0,
  error_message   TEXT,
  duration_ms     INTEGER,
  run_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ──────────────────────────────────
--  Updated_at triggers
-- ──────────────────────────────────
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER set_updated_at_admin_users
  BEFORE UPDATE ON admin_users
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at_knowledge
  BEFORE UPDATE ON knowledge_entries
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
