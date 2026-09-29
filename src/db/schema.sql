-- ──────────────────────────────────────────────
-- Organization Activity Tracker — Database Schema
-- Run idempotently (CREATE TABLE IF NOT EXISTS)
-- ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS companies (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS departments (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS designations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dept_company_map (
  id SERIAL PRIMARY KEY,
  dept_id INTEGER REFERENCES departments(id) ON DELETE RESTRICT,
  company_id INTEGER REFERENCES companies(id) ON DELETE RESTRICT,
  UNIQUE(dept_id, company_id)
);

CREATE TABLE IF NOT EXISTS desig_dept_map (
  id SERIAL PRIMARY KEY,
  desig_id INTEGER REFERENCES designations(id) ON DELETE RESTRICT,
  dept_id INTEGER REFERENCES departments(id) ON DELETE RESTRICT,
  UNIQUE(desig_id, dept_id)
);

CREATE TABLE IF NOT EXISTS desig_company_head_map (
  id SERIAL PRIMARY KEY,
  desig_id INTEGER REFERENCES designations(id) ON DELETE RESTRICT,
  company_id INTEGER REFERENCES companies(id) ON DELETE RESTRICT,
  UNIQUE(desig_id, company_id)
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  email TEXT,
  mobile_number TEXT,
  company_id INTEGER REFERENCES companies(id),
  dept_id INTEGER REFERENCES departments(id),
  desig_id INTEGER REFERENCES designations(id),
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','manager','user')),
  auth_type TEXT NOT NULL DEFAULT 'ldap' CHECK (auth_type IN ('ldap','local','demo')),
  is_active BOOLEAN DEFAULT true,
  onboarding_complete BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS mobile_number TEXT;

CREATE TABLE IF NOT EXISTS user_scope_assignments (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  dept_id INTEGER REFERENCES departments(id) ON DELETE RESTRICT,
  desig_id INTEGER REFERENCES designations(id) ON DELETE SET NULL,
  responsibility_type TEXT,
  is_primary BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  active_from TIMESTAMPTZ,
  active_to TIMESTAMPTZ,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, company_id, dept_id, desig_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  activity_start_date DATE,
  activity_start_time TIME,
  assigned_to INTEGER REFERENCES users(id),
  assigned_to_ids INTEGER[] DEFAULT '{}'::INTEGER[],
  assigned_by INTEGER REFERENCES users(id),
  company_id INTEGER REFERENCES companies(id),
  dept_id INTEGER REFERENCES departments(id),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','in_progress','completed','cancelled')),
  priority TEXT NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low','medium','high','critical')),
  last_follow_up_date DATE,
  due_date DATE,
  due_time TIME,
  follow_up_date DATE,
  follow_up_time TIME,
  remarks_action_taken TEXT,
  is_deleted BOOLEAN DEFAULT false,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS activity_start_date DATE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS activity_start_time TIME;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS last_follow_up_date DATE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS remarks_action_taken TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_to_ids INTEGER[] DEFAULT '{}'::INTEGER[];
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_time TIME;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS follow_up_time TIME;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS information_ids INTEGER[] DEFAULT '{}'::INTEGER[];

CREATE TABLE IF NOT EXISTS task_comments (
  id SERIAL PRIMARY KEY,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS task_activity (
  id SERIAL PRIMARY KEY,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  meta JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS task_attachments (
  id SERIAL PRIMARY KEY,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  uploaded_by INTEGER REFERENCES users(id),
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subtasks (
  id SERIAL PRIMARY KEY,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  is_done BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reminder_rules (
  id SERIAL PRIMARY KEY,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  offset_days INTEGER NOT NULL,
  remind_at TIMESTAMPTZ,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp','email','both')),
  is_active BOOLEAN DEFAULT true,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE reminder_rules ADD COLUMN IF NOT EXISTS remind_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS reminder_logs (
  id SERIAL PRIMARY KEY,
  task_id INTEGER REFERENCES tasks(id),
  rule_id INTEGER REFERENCES reminder_rules(id),
  channel TEXT NOT NULL,
  recipient TEXT,
  status TEXT NOT NULL CHECK (status IN ('sent','failed','skipped','pending')),
  error_msg TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT false,
  ref_task_id INTEGER REFERENCES tasks(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  actor_id INTEGER REFERENCES users(id),
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  diff JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  reset_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api_idempotency_keys (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL,
  scope TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json JSONB,
  status_code INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE(key, scope)
);

CREATE TABLE IF NOT EXISTS email_outbox (
  id SERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  recipient_email TEXT,
  recipient_name TEXT,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  payload JSONB,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_attempt_at TIMESTAMPTZ DEFAULT NOW(),
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_company ON tasks(company_id);
CREATE INDEX IF NOT EXISTS idx_tasks_dept ON tasks(dept_id);
CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_reminder_logs_task ON reminder_logs(task_id);
CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_reset_at ON auth_rate_limits(reset_at);
CREATE INDEX IF NOT EXISTS idx_api_idempotency_scope_key ON api_idempotency_keys(scope, key);
CREATE INDEX IF NOT EXISTS idx_api_idempotency_expires_at ON api_idempotency_keys(expires_at);
CREATE INDEX IF NOT EXISTS idx_email_outbox_status_next ON email_outbox(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_user_scope_assignments_user_active
  ON user_scope_assignments(user_id, is_active, company_id, dept_id);

-- Performance indexes added to cover the most common query patterns.
-- GIN index for array-contains lookups on assigned_to_ids (hottest query path).
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to_ids
  ON tasks USING GIN(assigned_to_ids);
-- GIN index for information_ids array lookups.
CREATE INDEX IF NOT EXISTS idx_tasks_information_ids
  ON tasks USING GIN(information_ids);
-- Composite indexes for soft-delete + status/date filter combinations.
CREATE INDEX IF NOT EXISTS idx_tasks_status_deleted
  ON tasks(status, is_deleted);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date_status
  ON tasks(due_date, status, is_deleted);
CREATE INDEX IF NOT EXISTS idx_tasks_created_deleted
  ON tasks(created_at DESC, is_deleted);
CREATE INDEX IF NOT EXISTS idx_tasks_follow_up
  ON tasks(follow_up_date, status) WHERE is_deleted = false;
-- Better coverage for email outbox sweep ordering.
CREATE INDEX IF NOT EXISTS idx_email_outbox_status_next_created
  ON email_outbox(status, next_attempt_at, created_at ASC);
-- Widen reminder_logs.status constraint to include 'pending' (crash-safe dedup).
DO $$ BEGIN
  ALTER TABLE reminder_logs DROP CONSTRAINT IF EXISTS reminder_logs_status_check;
  ALTER TABLE reminder_logs ADD CONSTRAINT reminder_logs_status_check
    CHECK (status IN ('sent','failed','skipped','pending'));
EXCEPTION WHEN others THEN NULL;
END $$;

-- Reminder logs lookup by rule for scheduler deduplication.
CREATE INDEX IF NOT EXISTS idx_reminder_logs_rule_sent
  ON reminder_logs(rule_id, status, sent_at DESC);
-- Task activity ordered fetch (used in task detail view).
CREATE INDEX IF NOT EXISTS idx_task_activity_task_created
  ON task_activity(task_id, created_at DESC);
-- Supports the reminder_meta LATERAL join in the task list query.
CREATE INDEX IF NOT EXISTS idx_reminder_rules_task_active_remind
  ON reminder_rules(task_id, is_active, remind_at ASC) WHERE is_active = true;

-- Ensure only one active Department Head per company+department.
CREATE UNIQUE INDEX IF NOT EXISTS ux_user_scope_department_head_active
  ON user_scope_assignments(company_id, dept_id)
  WHERE is_active = true
    AND dept_id IS NOT NULL
    AND lower(coalesce(responsibility_type, '')) = 'department_head';

-- ─── Personal Tasks (private, owner-only, excluded from org analytics) ─────

CREATE TABLE IF NOT EXISTS personal_tasks (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  notes          TEXT,
  priority       TEXT NOT NULL DEFAULT 'medium'
                   CHECK (priority IN ('low','medium','high')),
  due_date       DATE,
  due_time       TIME,
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','done')),
  remind_at        TIMESTAMPTZ,
  remind_channel   TEXT CHECK (remind_channel IN ('email','whatsapp','both','in_app')),
  recurrence_rule  TEXT NOT NULL DEFAULT 'none'
                     CHECK (recurrence_rule IN ('none','daily','weekly','monthly')),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Idempotent column additions for existing deployments
ALTER TABLE personal_tasks
  ADD COLUMN IF NOT EXISTS recurrence_rule TEXT NOT NULL DEFAULT 'none'
    CHECK (recurrence_rule IN ('none','daily','weekly','monthly'));

CREATE TABLE IF NOT EXISTS personal_task_subtasks (
  id          SERIAL PRIMARY KEY,
  task_id     INTEGER NOT NULL REFERENCES personal_tasks(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  is_done     BOOLEAN DEFAULT false,
  sort_order  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_personal_tasks_user
  ON personal_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_personal_tasks_remind
  ON personal_tasks(remind_at)
  WHERE remind_at IS NOT NULL AND status = 'pending';
CREATE INDEX IF NOT EXISTS idx_personal_subtasks_task
  ON personal_task_subtasks(task_id);

CREATE TABLE IF NOT EXISTS personal_task_reminders (
  id         SERIAL PRIMARY KEY,
  task_id    INTEGER NOT NULL REFERENCES personal_tasks(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  remind_at  TIMESTAMPTZ NOT NULL,
  channel    TEXT NOT NULL CHECK (channel IN ('email','whatsapp','both','in_app')),
  is_fired   BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_personal_reminders_task
  ON personal_task_reminders(task_id);
CREATE INDEX IF NOT EXISTS idx_personal_reminders_pending
  ON personal_task_reminders(remind_at)
  WHERE is_fired = false;

CREATE TABLE IF NOT EXISTS personal_task_activity (
  id         SERIAL PRIMARY KEY,
  task_id    INTEGER NOT NULL REFERENCES personal_tasks(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action     TEXT NOT NULL,
  meta       JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_personal_activity_task
  ON personal_task_activity(task_id);

CREATE TABLE IF NOT EXISTS personal_task_comments (
  id         SERIAL PRIMARY KEY,
  task_id    INTEGER NOT NULL REFERENCES personal_tasks(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_personal_comments_task
  ON personal_task_comments(task_id);

-- ──────────────────────────────────────────────
-- Outlook Desktop Add-in Integration
-- ──────────────────────────────────────────────

-- Password hash for manually-created local users (scrypt format: salt:hash)
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Per-user add-in Bearer token (SHA-256 hash stored, plaintext returned once)
-- Legacy: single-token columns kept for backward compatibility
ALTER TABLE users ADD COLUMN IF NOT EXISTS addin_token_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS addin_token_created_at TIMESTAMPTZ;

-- Multi-device add-in tokens — one row per device per user
CREATE TABLE IF NOT EXISTS addin_tokens (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT    NOT NULL UNIQUE,
  device_label  TEXT    NOT NULL DEFAULT 'My Device',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_addin_tokens_user_id   ON addin_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_addin_tokens_token_hash ON addin_tokens(token_hash);

-- Tracks which Outlook events have been pushed to prevent duplicate imports
CREATE TABLE IF NOT EXISTS calendar_event_imports (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  outlook_item_id  TEXT NOT NULL,
  task_id          INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  event_subject    TEXT,
  event_start      TIMESTAMPTZ,
  imported_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, outlook_item_id)
);

CREATE INDEX IF NOT EXISTS idx_calendar_imports_user
  ON calendar_event_imports(user_id);
CREATE INDEX IF NOT EXISTS idx_calendar_imports_task
  ON calendar_event_imports(task_id);

-- Deactivate one-shot reminder rules (remind_at IS NOT NULL) that have already been
-- successfully sent. These rules fire once at a specific datetime and must not re-fire
-- after the 23-hour dedup window expires. Safe to run on every startup (idempotent).
UPDATE reminder_rules
SET is_active = false
WHERE remind_at IS NOT NULL
  AND remind_at < NOW()
  AND is_active = true
  AND EXISTS (
    SELECT 1 FROM reminder_logs
    WHERE rule_id = reminder_rules.id
      AND status = 'sent'
  );

-- ─── Transaction Reminder (payment / subscription-agreement expiry tracker) ───

CREATE TABLE IF NOT EXISTS transaction_reminders (
  id                SERIAL PRIMARY KEY,
  type              TEXT NOT NULL DEFAULT 'payment' CHECK (type IN ('subscription','payment')),
  party_name        TEXT NOT NULL,
  vendor_code       TEXT,
  place             TEXT,
  agreement         TEXT,
  execution_date    DATE,
  bill_date         DATE,
  reminder_date     DATE NOT NULL,
  reminder_time     TIME NOT NULL DEFAULT '09:00:00',
  recurrence        TEXT NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none','weekly','monthly','yearly')),
  reminder_emails   TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  company_id        INTEGER REFERENCES companies(id),
  dept_id           INTEGER REFERENCES departments(id),
  created_by        INTEGER REFERENCES users(id),
  is_deleted        BOOLEAN NOT NULL DEFAULT false,
  deleted_at        TIMESTAMPTZ,
  is_reminder_sent  BOOLEAN NOT NULL DEFAULT false,
  reminder_sent_at  TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transaction_reminder_attachments (
  id                  SERIAL PRIMARY KEY,
  transaction_id      INTEGER REFERENCES transaction_reminders(id) ON DELETE CASCADE,
  uploaded_by         INTEGER REFERENCES users(id),
  original_name       TEXT NOT NULL,
  stored_name         TEXT NOT NULL,
  mime_type           TEXT NOT NULL,
  size_bytes          INTEGER,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Idempotent column addition for deployments where the table already existed
-- before the Type (Subscription / Payment) field was introduced.
ALTER TABLE transaction_reminders ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'payment';
DO $$ BEGIN
  ALTER TABLE transaction_reminders DROP CONSTRAINT IF EXISTS transaction_reminders_type_check;
  ALTER TABLE transaction_reminders ADD CONSTRAINT transaction_reminders_type_check
    CHECK (type IN ('subscription','payment'));
EXCEPTION WHEN others THEN NULL;
END $$;

-- Idempotent column addition for deployments where the table already existed
-- before the Recurrence (Weekly / Monthly / Yearly) field was introduced.
ALTER TABLE transaction_reminders ADD COLUMN IF NOT EXISTS recurrence TEXT NOT NULL DEFAULT 'none';
DO $$ BEGIN
  ALTER TABLE transaction_reminders DROP CONSTRAINT IF EXISTS transaction_reminders_recurrence_check;
  ALTER TABLE transaction_reminders ADD CONSTRAINT transaction_reminders_recurrence_check
    CHECK (recurrence IN ('none','weekly','monthly','yearly'));
EXCEPTION WHEN others THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_txn_reminders_company ON transaction_reminders(company_id);
CREATE INDEX IF NOT EXISTS idx_txn_reminders_dept ON transaction_reminders(dept_id);
CREATE INDEX IF NOT EXISTS idx_txn_reminders_created_deleted ON transaction_reminders(created_at DESC, is_deleted);
CREATE INDEX IF NOT EXISTS idx_txn_reminders_pending_sweep
  ON transaction_reminders(reminder_date, reminder_time)
  WHERE is_reminder_sent = false AND is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_txn_reminder_attachments_txn
  ON transaction_reminder_attachments(transaction_id);
