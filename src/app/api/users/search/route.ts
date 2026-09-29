import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { ldapSearchUsers } from '@/lib/ldap';
import { logger } from '@/lib/logger';
import type { ApiResponse } from '@/types';

type SearchUserResult = {
  id: number;
  username: string;
  display_name: string | null;
  email: string | null;
  source: 'local' | 'ldap';
};

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    if (Number(session.user.id) === -1) {
      return NextResponse.json<ApiResponse<SearchUserResult[]>>({ success: true, data: [] });
    }

    const { searchParams } = new URL(req.url);
    const q = (searchParams.get('q') || '').trim();
    const limit = Math.max(1, Math.min(25, parseInt(searchParams.get('limit') || '10', 10)));

    // When `ids` is provided, resolve those specific user IDs (used by TaskForm in edit mode).
    const idsParam = searchParams.get('ids') || '';
    if (idsParam) {
      const ids = idsParam.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n) && n > 0);
      if (ids.length === 0) {
        return NextResponse.json<ApiResponse<SearchUserResult[]>>({ success: true, data: [] });
      }
      const result = await query<SearchUserResult>(
        `SELECT id, username, display_name, email, 'local'::text as source
         FROM users
         WHERE id = ANY($1::int[]) AND is_active = true
         ORDER BY COALESCE(display_name, username)`,
        [ids]
      );
      return NextResponse.json<ApiResponse<SearchUserResult[]>>({ success: true, data: result.rows });
    }

    if (!q) {
      return NextResponse.json<ApiResponse<SearchUserResult[]>>({ success: true, data: [] });
    }

    const localResult = await query<SearchUserResult>(
      `SELECT u.id, u.username, u.display_name, u.email, 'local'::text as source
       FROM users u
       WHERE u.is_active = true
         AND u.username NOT LIKE '%$'
         AND (u.username ILIKE $1 OR u.display_name ILIKE $1 OR u.email ILIKE $1)
       ORDER BY
         CASE
           WHEN lower(u.username) = $2 OR lower(coalesce(u.display_name, '')) = $2 OR lower(coalesce(u.email, '')) = $2 THEN 0
           WHEN lower(u.username) LIKE $3 OR lower(coalesce(u.display_name, '')) LIKE $3 OR lower(coalesce(u.email, '')) LIKE $3 THEN 1
           ELSE 2
         END,
         u.display_name NULLS LAST,
         u.username
       LIMIT $4`,
      [`%${q}%`, q.toLowerCase(), `${q.toLowerCase()}%`, limit]
    );

    const merged = new Map<number, SearchUserResult>();
    for (const u of localResult.rows) {
      merged.set(u.id, { ...u, source: 'local' });
    }

    try {
      const ldapUsers = await ldapSearchUsers(q, limit);
      for (const ldapUser of ldapUsers) {
        const upsert = await query<SearchUserResult>(
          `INSERT INTO users (username, display_name, email, role, auth_type, is_active, created_at, updated_at)
           VALUES ($1, $2, $3, 'user', 'ldap', true, NOW(), NOW())
           ON CONFLICT (username)
           DO UPDATE SET
             display_name = COALESCE(EXCLUDED.display_name, users.display_name),
             email = COALESCE(EXCLUDED.email, users.email),
             auth_type = 'ldap',
             is_active = true,
             updated_at = NOW()
           RETURNING id, username, display_name, email, 'ldap'::text as source`,
          [ldapUser.sAMAccountName, ldapUser.displayName || null, ldapUser.mail || null]
        );

        const user = upsert.rows[0];
        if (user) {
          merged.set(user.id, { ...user, source: 'ldap' });
        }
      }
    } catch (err) {
      logger.warn({ err }, 'LDAP user search unavailable, returning local users only');
    }

    const normalizedQ = q.toLowerCase();
    const sorted = Array.from(merged.values()).sort((a, b) => {
      const rank = (u: SearchUserResult) => {
        const username = (u.username || '').toLowerCase();
        const displayName = (u.display_name || '').toLowerCase();
        const email = (u.email || '').toLowerCase();

        if (username === normalizedQ || displayName === normalizedQ || email === normalizedQ) return 0;
        if (username.startsWith(normalizedQ) || displayName.startsWith(normalizedQ) || email.startsWith(normalizedQ)) return 1;
        return 2;
      };

      const byRank = rank(a) - rank(b);
      if (byRank !== 0) return byRank;
      return (a.display_name || a.username).localeCompare(b.display_name || b.username);
    });

    return NextResponse.json<ApiResponse<SearchUserResult[]>>({ success: true, data: sorted.slice(0, limit) });
  } catch (err) {
    logger.error({ err }, 'GET /api/users/search error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
