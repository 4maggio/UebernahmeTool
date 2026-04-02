-- ============================================================
--  003_users.sql — Role-based user system
--  Replaces admin_users with general users table
-- ============================================================

-- 1) Rename admin_users → users
ALTER TABLE admin_users RENAME TO users;

-- 2) Add username column (unique, not null)
ALTER TABLE users ADD COLUMN username VARCHAR(50);

-- Backfill existing rows: derive username from email (part before @)
UPDATE users SET username = SPLIT_PART(email, '@', 1) WHERE username IS NULL;

-- Now make it NOT NULL + UNIQUE
ALTER TABLE users ALTER COLUMN username SET NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_username_unique UNIQUE (username);

-- 3) Make email optional (some users won't have one)
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

-- 4) Replace role constraint — expand to user / manager / admin
--    First drop old default, then alter
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'user';

-- Update existing role values to new scheme
UPDATE users SET role = 'admin' WHERE role IN ('superadmin', 'editor');

-- Add CHECK constraint for new roles
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('user', 'manager', 'admin'));

-- 5) Rename the trigger that was on admin_users
DROP TRIGGER IF EXISTS set_updated_at_admin_users ON users;
CREATE TRIGGER set_updated_at_users
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- 6) Extend contract_drafts: owner + soft-delete
ALTER TABLE contract_drafts
  ADD COLUMN created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN deleted_at TIMESTAMPTZ;

-- Index for filtering non-deleted drafts
CREATE INDEX IF NOT EXISTS idx_contract_drafts_active
  ON contract_drafts(deleted_at) WHERE deleted_at IS NULL;

-- Index for user's drafts
CREATE INDEX IF NOT EXISTS idx_contract_drafts_owner
  ON contract_drafts(created_by);
