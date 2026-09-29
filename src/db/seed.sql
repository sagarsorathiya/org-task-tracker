-- ──────────────────────────────────────────────
-- Organization Activity Tracker — Seed Data (Idempotent)
-- ──────────────────────────────────────────────

-- Companies
INSERT INTO companies (name, code) VALUES ('Organization Holding', 'ORG')
  ON CONFLICT (code) DO NOTHING;
INSERT INTO companies (name, code) VALUES ('Organization Operations', 'ORG-OPS')
  ON CONFLICT (code) DO NOTHING;
INSERT INTO companies (name, code) VALUES ('Organization Infrastructure', 'ORG-INF')
  ON CONFLICT (code) DO NOTHING;

-- Departments
INSERT INTO departments (name)
SELECT unnest(ARRAY[
  'Information Technology',
  'Human Resources',
  'Finance & Accounts',
  'Operations',
  'Engineering',
  'Legal & Compliance',
  'Administration',
  'Business Development',
  'Health Safety & Environment',
  'Procurement'
])
WHERE NOT EXISTS (SELECT 1 FROM departments LIMIT 1);

-- Designations
INSERT INTO designations (name)
SELECT unnest(ARRAY[
  'Managing Director',
  'Director',
  'General Manager',
  'Deputy General Manager',
  'Senior Manager',
  'Manager',
  'Deputy Manager',
  'Assistant Manager',
  'Senior Executive',
  'Executive',
  'Junior Executive',
  'Trainee'
])
WHERE NOT EXISTS (SELECT 1 FROM designations LIMIT 1);

-- Map all departments to all companies by default
INSERT INTO dept_company_map (dept_id, company_id)
SELECT d.id, c.id FROM departments d CROSS JOIN companies c
ON CONFLICT (dept_id, company_id) DO NOTHING;

-- Map all designations to all departments by default
INSERT INTO desig_dept_map (desig_id, dept_id)
SELECT dg.id, d.id FROM designations dg CROSS JOIN departments d
ON CONFLICT (desig_id, dept_id) DO NOTHING;
