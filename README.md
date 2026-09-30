# Organization Activity Tracker

Internal task and activity management portal for the Organization (~200 domain users).

## Tech Stack

- **Framework**: Next.js 14 (App Router, TypeScript)
- **UI**: React 18 + Tailwind CSS v3 + shadcn/ui
- **Database**: PostgreSQL 15 (raw SQL via `pg`)
- **Auth**: NextAuth.js v5 with LDAP (ldapjs) + Local Admin
- **Data Fetching**: Server Components + SWR
- **Notifications**: react-hot-toast
- **Email**: nodemailer (SMTP)
- **WhatsApp**: WAHA HTTP API
- **Scheduler**: node-schedule
- **Logging**: pino
- **Global UI State**: React Context + useReducer

## Prerequisites

- **Node.js** 20 LTS
- **PostgreSQL** 15+
- **Active Directory** LDAP server (for AD login)
- **npm** package manager

## Quick Start

### 1. Clone and Install

```bash
git clone <repository-url>
cd organization-activity-tracker
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env.local
```

Edit `.env.local` with your actual values:
- PostgreSQL credentials
- LDAP server details
- NEXTAUTH_SECRET (min 32 chars)
- SMTP settings (optional)
- WAHA settings (optional)

### 3. Create Database

```sql
CREATE DATABASE organization_tracker;
CREATE USER organization_app WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE organization_tracker TO organization_app;
```

### 4. Run Migrations

```bash
npm run migrate
```

Or let the custom server run migrations on startup automatically.

### 5. Start Development Server

```bash
npm run dev
```

The server will:
1. Run database migrations (schema + seed)
2. Start Next.js on http://localhost:4000
3. Initialize the reminder scheduler (if enabled)

### 6. Login

- **Local Admin**: Use the credentials from `LOCAL_ADMIN_USERNAME` / `LOCAL_ADMIN_PASSWORD`
- **LDAP**: Use your Active Directory domain username and password
- **Demo**: Enable `DEMO_LOGIN_ENABLED=true` for passwordless testing

## Production Build

```bash
npm run build
npm start
```

## Project Structure

```
src/
├── app/              # Next.js App Router pages & API routes
│   ├── (auth)/       # Login page
│   ├── (app)/        # Authenticated pages (dashboard, tasks, users, org, etc.)
│   └── api/          # REST API endpoints
├── components/       # React components (ui, layout, shared, auth, users, org, tasks)
├── context/          # Global UI state (React Context + useReducer)
├── lib/              # Server-side services (db, auth, ldap, mail, whatsapp)
├── db/               # SQL schema, seed data, migration runner
├── hooks/            # SWR client-side data hooks
├── types/            # TypeScript interfaces
└── constants/        # Enums and configuration constants
```

## Key Features

- **Multi-auth**: LDAP (Active Directory), Local Admin, Demo mode
- **Onboarding**: Cascading company → department → designation setup
- **Task Management**: CRUD, soft-delete/restore, single or multi-assignment, comments, subtasks
- **Task Date Wiring**: Tasks table shows Task Date (`activity_start_date` + optional `activity_start_time`), with dedicated Last Status Update, Next Reminder, and Target Date columns
- **Task Status Consistency**: List and detail views use consistent status derivation from explicit status + target date/time (no activity-timestamp override)
- **Assignee Experience**: Default "Me" in new task, LDAP-backed assignee search, multi-select assignees
- **Task Filters UX**: Debounced search (350ms), active filter chips with dismiss buttons, quick filters for Assign to me and Department
- **Tasks Table UX**: Fixed compact density, dropdown column visibility toggle, quick-complete button per row, optimistic delete with revert on error
- **Quick Complete**: Inline completion dialog — requires a comment body; posts comment with `status: completed` and refreshes list
- **Department Resolution**: Task table/detail uses task department first, then assigned user's department fallback when task-level mapping is empty
- **File Attachments**: Document/image/email uploads with MIME+extension validation and UUID storage
- **Alerts (Unified Tab)**: Reminders + in-app notifications in one workspace
- **Reminders**: Configurable rules with email/WhatsApp delivery + delivery logs
- **Create-Task Reminder Enforcement**: New task creation requires Reminder Date & Time, and reminder cannot be set later than target date/time
- **Notifications**: Read/unread event feed with mark-one / mark-all actions; unread notifications use info/blue badge styling
- **Dashboard**: KPI cards with SWR shared cache and loading skeletons; sidebar shows live overdue task count badge
- **Insights**: Analytics dashboard — 6-card KPI summary, status board with progress bars, SVG sparkline trend charts (completions + overdue), team workload bars with high-priority overlay, department completion rate bars, trend period selector (7d/30d/90d), refresh button, animate-pulse skeleton loading, sorted task schedule with overdue highlighting
- **Data Portability**: Task CSV export and CSV/XLSX import with tabbed Data Tools UI and import summary details
- **Activity Logging**: Full audit trail per task; connector line correctly hidden on the last activity item
- **Auth Audit Logging**: Login and logout audit events with normalized client IPv4 address, username, and user-agent metadata
- **Role-based Access**: Admin, Manager, User roles
- **Structured Components**: Dedicated auth/users/org feature components
- **Dark/Light Theme**: Amber accent, slate dark palette
- **Responsive**: Collapsible sidebar, mobile-friendly

## Functional Areas

- **Dashboard** (`/dashboard`): KPI cards (SWR-cached, skeleton loading) and upcoming follow-up list; sidebar shows live overdue task count badge.
- **Tasks** (`/tasks`): Debounced search with active filter chips, create/edit/delete/restore, optimistic delete, quick-complete dialog, tabbed data tools (Import/Export), and detail workspace tabs (Overview, Subtasks, Comments, Attachments, Reminders, Activity).
- **Alerts** (`/reminders`): Unified reminders log + notifications feed; unread notifications use info/blue badge styling.
- **Insights** (`/insights`): Full analytics dashboard — KPI summary row, status distribution board, SVG sparkline charts for completion and overdue trends, team workload with high-priority overlays, department breakdown with completion rates, configurable trend window (7/30/90 days), and a sorted task schedule with overdue highlighting.
- **Org & Users** (`/org`, `/users`): Master data and user administration.
- **Config** (`/config`): Environment and operational status views, plus admin audit log review.

## API Highlights

- **Tasks**: `/api/tasks`, `/api/tasks/[id]`, `/api/tasks/[id]/restore`, `/api/tasks/[id]/comments`, `/api/tasks/[id]/activity`, `/api/tasks/[id]/subtasks`, `/api/tasks/[id]/attachments`, `/api/tasks/[id]/reminders`
- **Task import/export**: `/api/tasks/export`, `/api/tasks/import`
- **Dashboard/alerts**: `/api/dashboard/stats`, `/api/dashboard/upcoming`, `/api/reminders/logs`, `/api/notifications`
- **Insights**: `/api/workload`, `/api/analytics/trends`, `/api/views/kanban`, `/api/views/calendar`
- **Organization**: `/api/org/companies`, `/api/org/departments`, `/api/org/designations`, `/api/org/mappings`
- **Users**: `/api/users`, `/api/users/[id]`
- **Configuration and audit**: `/api/config/status`, `/api/config/audit-logs`, `/api/auth/logout-audit`

## Notification Delivery Matrix

Current behavior (as implemented in APIs and scheduler):

| Event | Source | When It Triggers | Email/WhatsApp | In-App Notification | Recipients |
|---|---|---|---|---|---|
| Task assigned on create | Task create API (`POST /api/tasks`) | Immediately after task creation | Email sent to assignees (if SMTP configured) with full task details | Yes (`task_assigned`) | All assignees in `assigned_to_ids` (or `assigned_to`) except the actor |
| Task assignment changed on update | Task update API (`PUT /api/tasks/[id]`) | Immediately after assignment change | Email sent to newly-added assignees (if SMTP configured) with concise event body | Yes (`task_assigned`) | Newly added assignees only, excluding the actor |
| New comment or comment-driven status update | Task comments API (`POST /api/tasks/[id]/comments`) | Immediately after comment save | Email sent (if SMTP configured) with specific subject (completed/reopened/cancelled/status/comment) and comment body | Yes (`task_commented`) | Task assignees, excluding commenter |
| Task status update via task update | Task update API (`PUT /api/tasks/[id]`) | On explicit status change | Email sent (if SMTP configured) with specific status subject and optional remark comment | No additional in-app beyond existing activity/feed paths | Task creator + assignees, excluding actor |
| Attachment/subtask added | Attachment/Subtask APIs | Immediately after add | Email sent (if SMTP configured) with specific event subject and item detail | Existing task activity + UI refresh | Task creator + assignees, excluding actor |
| Task becomes overdue | Scheduler sweep (`src/lib/scheduler.ts`) | First overdue detection | Email sent (if SMTP configured) | No dedicated in-app row beyond activity/log context | Task creator + assignees |
| Reminder rule due | Scheduler (`src/lib/scheduler.ts`) | Startup sweep + minutely cron sweep (`REMINDER_CRON`, default `*/1 * * * *`) when `NOW() >= remind_at`, or due-date minus offset rule | Yes, based on reminder `channel` (`email`, `whatsapp`, `both`) | Yes (`reminder_sent`) if at least one channel succeeds | Task creator + assignees |
| Upcoming -> In Progress transition | Scheduler (`src/lib/scheduler.ts`) | First detection after start datetime | Email is queued to outbox and delivered with retry/DLQ flow | Yes (`task_status_changed`) | Task creator + assignees |
| 24h before target reminder | Scheduler (`src/lib/scheduler.ts`) | Within the last 24h before target datetime | Email sent immediately and logged in `reminder_logs` | Yes (`reminder_sent`) | Task creator + assignees |

Notes:
- Tasks whose duration (`activity_start` to target `due`) is less than or equal to 24 hours are excluded from scheduler reminder/transition emails.
- Reminder recipients are resolved from both creator (`assigned_by`) and assignees (`assigned_to_ids` fallback `assigned_to`) with per-recipient dedupe checks.
- Reminder WhatsApp uses user `mobile_number` values from the users table.
- Scheduler transitions (in-progress/overdue) queue outbound emails through `email_outbox`; outbox processing uses row claiming (`FOR UPDATE SKIP LOCKED`), retry backoff, and duration-based suppression guard.
- Duplicate reminder sends are prevented per rule per day via `reminder_logs` check.

## Task Visibility And Permission Matrix

Current behavior (as implemented):

Scope model update:
- Non-admin visibility is now assignment-driven via `user_scope_assignments` (with legacy fallback to `users.company_id/dept_id` when no assignment rows exist).
- A single user can hold multiple active scope rows across multiple companies/departments.
- `dept_id = NULL` in an assignment row means company-wide visibility for that company.
- Admin users are global controllers: `company_id`, `dept_id`, `desig_id` are enforced as `NULL` and admin scope-assignment rows are cleared on update.

Role vs Responsibility (no overlap by design):
- `users.role` is a system access control flag (`admin`, `manager`, `user`) and is not used as a business title.
- `user_scope_assignments.responsibility_type` is a business responsibility marker (for example `department_head`, `ceo`, `executive_director`).
- Responsibility values that collide with system roles (`admin`, `manager`, `user`) are rejected by API validation.

Responsibility policy (task actions):
- View scope remains assignment-driven.
- Task write actions are now restricted by actor relationship/policy: **task owner (creator)**, **assignee**, **department_head**, **company_head**, or **admin**.
- This restriction is enforced for task update, comment add, attachment add/remove, and subtask add/update/delete.

| Capability | Admin | Manager | User |
|---|---|---|---|
| List tasks (`GET /api/tasks`) | Can view all non-deleted tasks; can also filter deleted tasks | Can view all non-deleted tasks | Assignment-scoped tasks across one or more company/department mappings |
| View task detail (`GET /api/tasks/[id]`) | Allowed | Allowed | Allowed only when task matches one of user's active scope assignments |
| Create task (`POST /api/tasks`) | Allowed | Allowed | Allowed when requested scope matches one of user's active assignments (or primary assignment fallback) |
| Edit task (`PUT /api/tasks/[id]`) | Allowed | Allowed | Allowed only for owner, assignee, department_head, or company_head within scope |
| Soft-delete task (`DELETE /api/tasks/[id]`) | Allowed | Allowed | Allowed when task matches one of user's active scope assignments |
| Restore task (`POST /api/tasks/[id]/restore`) | Allowed | Allowed | Allowed when task matches one of user's active scope assignments |
| Add comment (`POST /api/tasks/[id]/comments`) | Allowed | Allowed | Allowed only for owner, assignee, department_head, or company_head within scope |
| Add/remove attachment (`POST/DELETE /api/tasks/[id]/attachments`) | Allowed | Allowed | Allowed only for owner, assignee, department_head, or company_head within scope |
| Add/update/delete subtask (`POST/PUT/DELETE /api/tasks/[id]/subtasks`) | Allowed | Allowed | Allowed only for owner, assignee, department_head, or company_head within scope |
| View notifications (`GET /api/notifications`) | Own notifications only | Own notifications only | Own notifications only |
| Mark notifications read (`POST /api/notifications`) | Own notifications only | Own notifications only | Own notifications only |

Important implementation detail:
- Comment/attachment/download APIs use the same assignment-aware scope checks.

## Security

- All API routes validate session via NextAuth
- Role-based access control (admin, manager, user)
- Parameterized SQL queries (no string concatenation)
- File uploads validated with MIME+extension checks (documents/images/email formats), max 30MB per file
- Constant-time password comparison for local admin
- Auth route rate limiting in middleware (10 requests / 15 minutes per IP)
- Conditional API CORS headers when `CORS_ORIGINS` is configured
- Security headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy)
- Additional hardening: CSP baseline policy and HSTS header enabled
- Centralized HTTP request logging includes method, path, status, duration, and userId
- Sensitive fields auto-redacted in logs
- Mutating task APIs support idempotency with `Idempotency-Key` header
- Correlation IDs are propagated through `x-request-id`
- Authentication rate limiting uses shared PostgreSQL-backed counters (multi-instance safe)
- Authentication audit logging captures login and logout events with client metadata (username, IP, user-agent)
- Client IP values in auth audits are normalized to IPv4-friendly values (for example `::1` -> `127.0.0.1`, `::ffff:x.x.x.x` -> `x.x.x.x`)
- Backup restore requires two-step approval token and signed-backup verification (unless unsigned import override is explicitly enabled)
- Email notifications use an outbox with retries and DLQ (`email_outbox`) for reliability

## Notes

- Middleware protects app routes (`/dashboard`, `/tasks`, `/users`, `/org`, `/reminders`, `/insights`, `/config`) and redirects unauthenticated users to `/login`.
- The custom server runs DB migrations at startup and boots Next.js; scheduler enablement is controlled by `REMINDER_SCHEDULER_ENABLED`, and sweeps run at startup plus configurable cron intervals.
- Fallback local-admin mode is supported for development when DB is unavailable; selected APIs return safe empty responses instead of hard failures.
- Config status endpoint is optimized for faster load by parallelizing DB table metrics and using a short-lived LDAP health cache with timeout bounds.
- Task add/edit flow no longer captures Remarks / Action Taken in UI, and task detail overview no longer displays it.
- Insights page loads data immediately on mount for the full scope (no company/department selection required to see data); filters narrow scope after initial load.
- TaskForm caches org data (companies/departments/mappings) in a ref after first fetch — subsequent opens reuse the cache and skip the network call.
- KpiCards and Sidebar share a single SWR key (`/api/dashboard/stats`) so only one request is issued regardless of how many components mount.
- Sidebar overdue badge is derived from the same SWR response as KpiCards — no additional API call.
- Task list and detail date fields are wired as: **Task Date** (`activity_start_date` + optional `activity_start_time`), **Last Status Update** (latest comment fallback), **Next Reminder** (earliest active `reminder_rules.remind_at`, fallback `follow_up_date + follow_up_time`), **Target Date** (`due_date` + optional `due_time`).
- New-task reminder entered in create form is auto-seeded into `reminder_rules` and validated to be `<=` target datetime; detail API also auto-heals missing reminder_rules from task follow-up datetime for legacy rows.

## Environment Variables

See `.env.example` for the complete list. Key variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXTAUTH_SECRET` | ✅ | Min 32 char random string |
| `AUTH_TRUST_HOST` | Optional | Set `true` when running behind a proxy/load balancer; localhost URLs are auto-trusted |
| `PG_*` | ✅ | PostgreSQL connection |
| `PG_PASSWORD_FILE` | Optional | File path for DB password secret (preferred in production) |
| `PG_SSL_CA_PATH` | Optional | CA certificate path for PostgreSQL TLS verification |
| `LDAP_*` | For AD login | LDAP server config |
| `LDAP_BIND_PASSWORD_FILE` | Optional | File path for LDAP bind password secret |
| `LOCAL_ADMIN_*` | ✅ | Fallback admin credentials |
| `SMTP_*` | For email | SMTP server config |
| `SMTP_PASSWORD_FILE` | Optional | File path for SMTP password secret |
| `WAHA_*` | For WhatsApp | WAHA API config |
| `SSO_ENABLED` | Optional | Enable domain SSO login path (IIS Windows Auth header-based) |
| `SSO_AUTO_LOGIN` | Optional | Attempt silent SSO login automatically on `/login` |
| `SSO_IDENTITY_HEADER` | Optional | Header carrying domain identity (default `x-forwarded-user`) |
| `SSO_ALLOWED_DOMAINS` | Optional | Comma-separated domain allowlist for SSO identities |
| `SSO_PROXY_SECRET_HEADER` | Optional | Header name for trusted-proxy secret validation |
| `SSO_PROXY_SHARED_SECRET` | Recommended with SSO | Shared secret to verify requests originate from trusted proxy |
| `BACKUP_SIGNING_SECRET` | Recommended | HMAC secret used to sign exported SQL backups |
| `DB_RESTORE_APPROVAL_SECRET` | Recommended | Secret used for short-lived DB restore approval tokens |
| `ALLOW_DB_RESTORE_IN_PRODUCTION` | Optional | Must be `true` to allow restore in production |
| `ALLOW_UNSIGNED_DB_IMPORT` | Optional | Allow importing unsigned backups (default blocked when signing secret exists) |

## Backup And Server Migration

Admin backup endpoints support two modes:

- `GET /api/config/database/export` (default `mode=db`): Signed SQL database-only backup.
- `GET /api/config/database/export?mode=full`: Portable full-backup bundle for server migration.

`mode=full` includes:

- Signed SQL dump (`database/database-backup.sql`).
- Uploaded files from `uploads/`.
- Runtime/config artifacts (for example `server.js`, `next.config.js`, `package.json`, `.next`, `README.md`).
- Environment + resolved secret snapshot (`config/env-secrets.snapshot.json`).
- `manifest.json` with included file counts and restore guidance.

Important notes:

- DB roles/privileges/ownership are intentionally not included in SQL dump (export uses `--no-owner --no-privileges`).
- Restore API (`POST /api/config/database/import`) accepts `.sql` backups only.
- Full bundle restore is operational: import SQL via API, then copy `uploads` and artifact/config files to the target server.
- Full bundle contains secrets; store and transfer it as a restricted encrypted artifact.

## License

Released under the [MIT License](LICENSE).
