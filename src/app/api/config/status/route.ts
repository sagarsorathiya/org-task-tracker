// ──────────────────────────────────────────────
// GET /api/config/status — System status (admin only)
// ──────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { logger } from '@/lib/logger';
import { testLdapConnection } from '@/lib/ldap';
import type { ApiResponse } from '@/types';

type LdapStatus = { connected: boolean; error?: string };

const LDAP_CACHE_TTL_MS = 60_000;
const LDAP_CHECK_TIMEOUT_MS = 1_500;

let ldapStatusCache: { value: LdapStatus; expiresAt: number } | null = null;

async function getCachedLdapStatus(): Promise<LdapStatus> {
  const now = Date.now();
  if (ldapStatusCache && ldapStatusCache.expiresAt > now) {
    return ldapStatusCache.value;
  }

  try {
    const timeout = new Promise<LdapStatus>((resolve) => {
      setTimeout(() => resolve({ connected: false, error: 'Check timed out (cached pending)' }), LDAP_CHECK_TIMEOUT_MS);
    });

    const checked = await Promise.race([testLdapConnection(), timeout]);
    ldapStatusCache = {
      value: checked,
      expiresAt: now + LDAP_CACHE_TTL_MS,
    };
    return checked;
  } catch (err) {
    const fallback = { connected: false, error: String(err) };
    ldapStatusCache = {
      value: fallback,
      expiresAt: now + 15_000,
    };
    return fallback;
  }
}

const CONFIG_KEYS = [
  'NEXTAUTH_URL', 'NEXTAUTH_SECRET', 'PG_HOST', 'PG_DATABASE', 'PG_USER', 'PG_PASSWORD',
  'LDAP_URL', 'LDAP_BASE_DN', 'LDAP_BIND_DN', 'LDAP_BIND_PASSWORD',
  'LOCAL_ADMIN_USERNAME', 'LOCAL_ADMIN_PASSWORD',
  'SMTP_HOST', 'SMTP_PORT', 'SMTP_FROM',
  'WAHA_BASE_URL', 'WAHA_API_KEY',
  'DEMO_LOGIN_ENABLED', 'REMINDER_SCHEDULER_ENABLED', 'REMINDER_CRON',
  'SSO_ENABLED', 'SSO_AUTO_LOGIN', 'SSO_IDENTITY_HEADER', 'SSO_ALLOWED_DOMAINS', 'SSO_PROXY_SECRET_HEADER', 'SSO_PROXY_SHARED_SECRET',
];

const TABLES = [
  'companies', 'departments', 'designations', 'dept_company_map', 'desig_dept_map',
  'users', 'tasks', 'task_comments', 'task_activity', 'task_attachments',
  'subtasks', 'reminder_rules', 'reminder_logs', 'notifications', 'audit_log',
];

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== 'admin') {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const isFallbackAdmin = Number(session.user.id) === -1;

    // Config status (keys only, never values)
    const envConfig = CONFIG_KEYS.map((key) => ({
      key,
      status: process.env[key] ? 'Configured' : 'Missing',
    }));

    // Table row counts (parallelized to reduce endpoint latency)
    const tableCounts: { table: string; count: number }[] = isFallbackAdmin
      ? TABLES.map((table) => ({ table, count: -1 }))
      : await Promise.all(
          TABLES.map(async (table) => {
            try {
              const result = await query<{ count: string }>(`SELECT COUNT(*) as count FROM ${table}`);
              return { table, count: parseInt(result.rows[0]?.count || '0', 10) };
            } catch {
              return { table, count: -1 };
            }
          })
        );

    // Scheduler status
    const schedulerEnabled = process.env.REMINDER_SCHEDULER_ENABLED === 'true';

    // LDAP connectivity (cached + timeout bounded)
    const ldapStatus = await getCachedLdapStatus();

    let opsMetrics = {
      emailOutboxPending: 0,
      emailOutboxFailed: 0,
      emailOutboxDead: 0,
      reminderFailures24h: 0,
      authRateLimitedActive: 0,
    };

    if (!isFallbackAdmin) {
      try {
        const [outboxResult, reminderFailResult, rateLimitResult] = await Promise.all([
          query<{ pending: string; failed: string; dead: string }>(
            `SELECT
               COUNT(*) FILTER (WHERE status = 'pending')::text AS pending,
               COUNT(*) FILTER (WHERE status = 'failed')::text AS failed,
               COUNT(*) FILTER (WHERE status = 'dead')::text AS dead
             FROM email_outbox`
          ),
          query<{ count: string }>(
            `SELECT COUNT(*)::text AS count
             FROM reminder_logs
             WHERE status = 'failed' AND sent_at >= NOW() - INTERVAL '24 hours'`
          ),
          query<{ count: string }>(
            `SELECT COUNT(*)::text AS count
             FROM auth_rate_limits
             WHERE reset_at > NOW() AND count >= 10`
          ),
        ]);

        opsMetrics = {
          emailOutboxPending: parseInt(outboxResult.rows[0]?.pending || '0', 10),
          emailOutboxFailed: parseInt(outboxResult.rows[0]?.failed || '0', 10),
          emailOutboxDead: parseInt(outboxResult.rows[0]?.dead || '0', 10),
          reminderFailures24h: parseInt(reminderFailResult.rows[0]?.count || '0', 10),
          authRateLimitedActive: parseInt(rateLimitResult.rows[0]?.count || '0', 10),
        };
      } catch (err) {
        logger.warn({ err }, 'Failed to load ops metrics');
      }
    }

    return NextResponse.json<ApiResponse<Record<string, unknown>>>({
      success: true,
      data: {
        envConfig,
        tableCounts,
        scheduler: {
          enabled: schedulerEnabled,
          cron: process.env.REMINDER_CRON || '0 9 * * *',
          status: schedulerEnabled ? 'running' : 'disabled',
        },
        ldap: ldapStatus,
        opsMetrics,
      },
    });
  } catch (err) {
    logger.error({ err }, 'GET /api/config/status error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
