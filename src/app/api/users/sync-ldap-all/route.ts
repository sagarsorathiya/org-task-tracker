// ──────────────────────────────────────────────
// POST /api/users/sync-ldap-all
// Sync display_name + email from LDAP for ALL active LDAP users.
// ──────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { ldapSearch } from '@/lib/ldap';
import { logger } from '@/lib/logger';
import type { User, ApiResponse } from '@/types';

interface SyncResult {
  userId: number;
  username: string;
  status: 'synced' | 'skipped' | 'not_found' | 'error';
  synced?: string[];
  error?: string;
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role === 'user') {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    // Fetch all active LDAP users
    const usersResult = await query<User>(
      "SELECT id, username, auth_type FROM users WHERE auth_type = 'ldap' AND is_active = true ORDER BY id"
    );

    if (usersResult.rowCount === 0) {
      return NextResponse.json<ApiResponse<{ results: SyncResult[]; summary: object }>>({
        success: true,
        data: { results: [], summary: { total: 0, synced: 0, skipped: 0, not_found: 0, errors: 0 } },
      });
    }

    const results: SyncResult[] = [];

    for (const user of usersResult.rows) {
      try {
        let ldapUser;
        try {
          ldapUser = await ldapSearch(user.username);
        } catch (err) {
          logger.error({ err, userId: user.id }, 'LDAP bulk sync: ldapSearch failed');
          results.push({ userId: user.id, username: user.username, status: 'error', error: 'LDAP connection error' });
          continue;
        }

        if (!ldapUser) {
          results.push({ userId: user.id, username: user.username, status: 'not_found' });
          continue;
        }

        const updates: string[] = [];
        const values: unknown[] = [];
        let idx = 1;

        if (ldapUser.displayName !== undefined && ldapUser.displayName !== null) {
          updates.push(`display_name = $${idx++}`);
          values.push(ldapUser.displayName);
        }
        if (ldapUser.mail !== undefined && ldapUser.mail !== null) {
          updates.push(`email = $${idx++}`);
          values.push(ldapUser.mail);
        }

        if (updates.length === 0) {
          results.push({ userId: user.id, username: user.username, status: 'skipped', synced: [] });
          continue;
        }

        updates.push(`updated_at = NOW()`);
        values.push(user.id);

        await query(
          `UPDATE users SET ${updates.join(', ')} WHERE id = $${idx}`,
          values
        );

        const synced = [];
        if (ldapUser.displayName) synced.push('display_name');
        if (ldapUser.mail) synced.push('email');

        results.push({ userId: user.id, username: user.username, status: 'synced', synced });
      } catch (err) {
        logger.error({ err, userId: user.id }, 'LDAP bulk sync: unexpected error for user');
        results.push({ userId: user.id, username: user.username, status: 'error', error: 'Unexpected error' });
      }
    }

    const summary = {
      total: results.length,
      synced: results.filter((r) => r.status === 'synced').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      not_found: results.filter((r) => r.status === 'not_found').length,
      errors: results.filter((r) => r.status === 'error').length,
    };

    logger.info({ summary, actor: session.user.id }, 'LDAP bulk sync completed');

    return NextResponse.json<ApiResponse<{ results: SyncResult[]; summary: typeof summary }>>({
      success: true,
      data: { results, summary },
    });
  } catch (err) {
    logger.error({ err }, 'POST /api/users/sync-ldap-all error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
