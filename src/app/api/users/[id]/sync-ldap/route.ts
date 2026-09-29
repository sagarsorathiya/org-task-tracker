// ──────────────────────────────────────────────
// POST /api/users/[id]/sync-ldap
// Fetch latest email + display_name from LDAP and update the user record.
// Does NOT touch company / dept / desig / role.
// ──────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { ldapSearch } from '@/lib/ldap';
import { logger } from '@/lib/logger';
import type { User, ApiResponse } from '@/types';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role === 'user') {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const userId = parseInt(params.id, 10);
    if (isNaN(userId)) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Invalid user id' }, { status: 400 });
    }

    // Load user to get username
    const userResult = await query<User>('SELECT id, username, auth_type FROM users WHERE id = $1', [userId]);
    if (userResult.rowCount === 0) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'User not found' }, { status: 404 });
    }

    const user = userResult.rows[0];

    if (user.auth_type !== 'ldap') {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'User is not an LDAP account — sync is only available for LDAP users.' },
        { status: 400 }
      );
    }

    // Query LDAP
    let ldapUser;
    try {
      ldapUser = await ldapSearch(user.username);
    } catch (err) {
      logger.error({ err, userId }, 'LDAP sync: ldapSearch failed');
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'Unable to connect to LDAP. Check server connectivity.' },
        { status: 502 }
      );
    }

    if (!ldapUser) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: `User "${user.username}" was not found in LDAP.` },
        { status: 404 }
      );
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
      return NextResponse.json<ApiResponse<{ synced: string[] }>>({
        success: true,
        data: { synced: [] },
      });
    }

    updates.push(`updated_at = NOW()`);
    values.push(userId);

    const updated = await query<User>(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    const synced = [];
    if (ldapUser.displayName) synced.push('display_name');
    if (ldapUser.mail) synced.push('email');

    logger.info({ userId, synced, actor: session.user.id }, 'LDAP sync completed');

    return NextResponse.json<ApiResponse<{ user: User; synced: string[] }>>({
      success: true,
      data: { user: updated.rows[0], synced },
    });
  } catch (err) {
    logger.error({ err }, 'POST /api/users/[id]/sync-ldap error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
