// ──────────────────────────────────────────────
// NextAuth.js v5 Configuration
// ──────────────────────────────────────────────

import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { query } from './db';
import { ldapSearch, ldapBind } from './ldap';
import { logger } from './logger';
import crypto from 'crypto';
import { getSecret } from './secrets';
import { verifySsoTicket } from './ssoTicket';
import { getClientIpFromHeaders } from './request-ip';
import type { User } from '@/types';

const AUTH_WINDOW_SECONDS = 15 * 60;
const AUTH_MAX_REQUESTS = 10;

async function writeAuthAudit(actorId: number | null, action: string, meta?: Record<string, unknown>) {
  try {
    await query(
      `INSERT INTO audit_log (actor_id, entity_type, entity_id, action, diff)
       VALUES ($1, 'auth', 0, $2, $3)`,
      [actorId, action, meta ? JSON.stringify(meta) : null]
    );
  } catch (err) {
    logger.warn({ err, action }, 'Failed to write auth audit event');
  }
}

async function consumeAuthRateLimit(key: string): Promise<{ allowed: boolean; retryAfter?: number }> {
  try {
    await query('DELETE FROM auth_rate_limits WHERE reset_at < NOW()', []);

    const existing = await query<{ count: number; reset_at: string }>(
      'SELECT count, reset_at FROM auth_rate_limits WHERE key = $1',
      [key]
    );

    if (!existing.rowCount || !existing.rows[0]) {
      await query(
        `INSERT INTO auth_rate_limits (key, count, reset_at, updated_at)
         VALUES ($1, 1, NOW() + ($2 * INTERVAL '1 second'), NOW())
         ON CONFLICT (key) DO UPDATE SET
           count = CASE WHEN auth_rate_limits.reset_at < NOW() THEN 1 ELSE auth_rate_limits.count + 1 END,
           reset_at = CASE WHEN auth_rate_limits.reset_at < NOW() THEN NOW() + ($2 * INTERVAL '1 second') ELSE auth_rate_limits.reset_at END,
           updated_at = NOW()`,
        [key, AUTH_WINDOW_SECONDS]
      );
      return { allowed: true };
    }

    const current = existing.rows[0];
    const resetAt = new Date(current.reset_at).getTime();
    const now = Date.now();
    if (current.count >= AUTH_MAX_REQUESTS && resetAt > now) {
      return { allowed: false, retryAfter: Math.max(1, Math.ceil((resetAt - now) / 1000)) };
    }

    await query(
      'UPDATE auth_rate_limits SET count = count + 1, updated_at = NOW() WHERE key = $1',
      [key]
    );

    return { allowed: true };
  } catch (err) {
    logger.warn({ err, key }, 'Shared auth rate limit check failed; allowing request');
    return { allowed: true };
  }
}

const NEXTAUTH_SECRET = getSecret('NEXTAUTH_SECRET');
const NEXTAUTH_URL = process.env.NEXTAUTH_URL || '';
const isLocalAuthHost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(NEXTAUTH_URL);
const TRUST_AUTH_HOST = process.env.AUTH_TRUST_HOST === 'true' || isLocalAuthHost;
const ALLOW_LOCAL_ADMIN_DB_FALLBACK = process.env.LOCAL_ADMIN_FALLBACK_ENABLED === 'true';
const SSO_ENABLED = process.env.SSO_ENABLED === 'true';
const SSO_IDENTITY_HEADER = (process.env.SSO_IDENTITY_HEADER || 'x-forwarded-user').trim().toLowerCase();
const SSO_PROXY_SECRET_HEADER = (process.env.SSO_PROXY_SECRET_HEADER || 'x-sso-proxy-secret').trim().toLowerCase();
const SSO_PROXY_SHARED_SECRET = getSecret('SSO_PROXY_SHARED_SECRET', '');
const SSO_ALLOWED_DOMAINS = (process.env.SSO_ALLOWED_DOMAINS || '')
  .split(',')
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

type AuthSessionProfile = {
  id: number;
  username: string;
  role: 'admin' | 'manager' | 'user';
  company_id: number | null;
  dept_id: number | null;
  onboarding_complete: boolean;
  insights_access: boolean;
  company_head_access: boolean;
};

async function getAuthSessionProfile(userId: number): Promise<AuthSessionProfile | null> {
  const result = await query<AuthSessionProfile>(
    `SELECT
       u.id,
       u.username,
       u.role,
       u.company_id,
       u.dept_id,
       u.onboarding_complete,
       (
         EXISTS (
           SELECT 1
           FROM user_scope_assignments usa
           LEFT JOIN desig_company_head_map dchm
             ON dchm.desig_id = usa.desig_id
            AND dchm.company_id = usa.company_id
           WHERE usa.user_id = u.id
             AND usa.is_active = true
             AND (usa.active_from IS NULL OR usa.active_from <= NOW())
             AND (usa.active_to IS NULL OR usa.active_to >= NOW())
             AND (
               lower(coalesce(usa.responsibility_type, '')) = 'company_head'
               OR dchm.id IS NOT NULL
             )
         )
         OR EXISTS (
           SELECT 1
           FROM desig_company_head_map dchm
           WHERE dchm.desig_id = u.desig_id
             AND dchm.company_id = u.company_id
         )
       ) AS company_head_access,
       (
         u.role IN ('admin', 'manager')
         OR EXISTS (
           SELECT 1
           FROM user_scope_assignments usa
           LEFT JOIN desig_company_head_map dchm
             ON dchm.desig_id = usa.desig_id
            AND dchm.company_id = usa.company_id
           WHERE usa.user_id = u.id
             AND usa.is_active = true
             AND (usa.active_from IS NULL OR usa.active_from <= NOW())
             AND (usa.active_to IS NULL OR usa.active_to >= NOW())
             AND (
               lower(coalesce(usa.responsibility_type, '')) IN ('company_head', 'department_head')
               OR dchm.id IS NOT NULL
             )
         )
         OR EXISTS (
           SELECT 1
           FROM desig_company_head_map dchm
           WHERE dchm.desig_id = u.desig_id
             AND dchm.company_id = u.company_id
         )
       ) AS insights_access
     FROM users u
     WHERE u.id = $1
     LIMIT 1`,
    [userId]
  );

  if (!result.rowCount || !result.rows[0]) {
    return null;
  }
  return result.rows[0];
}

function timingSafeEquals(a: string, b: string): boolean {
  if (!a || !b) return false;
  // Hash both to fixed-length (32 bytes) so the compare doesn't leak string length via timing.
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function parseSsoIdentity(raw: string): { username: string; domain: string | null } {
  const value = (raw || '').trim();
  if (!value) return { username: '', domain: null };

  // DOMAIN\username format (IIS {LOGON_USER} uses a single backslash)
  const slashIndex = value.indexOf('\\');
  if (slashIndex !== -1) {
    const domain = value.slice(0, slashIndex);
    const username = value.slice(slashIndex + 1);
    return { username: username.trim(), domain: domain.trim().toLowerCase() || null };
  }

  // username@domain format
  if (value.includes('@')) {
    const [username, domain] = value.split('@', 2);
    return { username: (username || '').trim(), domain: (domain || '').trim().toLowerCase() || null };
  }

  return { username: value, domain: null };
}

// Validate NEXTAUTH_SECRET
if (!NEXTAUTH_SECRET || NEXTAUTH_SECRET.length < 32) {
  throw new Error('NEXTAUTH_SECRET must be at least 32 characters');
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  secret: NEXTAUTH_SECRET,
  trustHost: TRUST_AUTH_HOST,
  pages: {
    signIn: '/login',
  },
  session: {
    strategy: 'jwt',
    maxAge: 8 * 60 * 60, // 8 hours
  },
  providers: [
    Credentials({
      id: 'credentials',
      name: 'Credentials',
      credentials: {
        username: { label: 'Username', type: 'text' },
        password: { label: 'Password', type: 'password' },
        loginType: { label: 'Login Type', type: 'text' },
      },
      async authorize(credentials, req) {
        const username = credentials?.username as string;
        const password = credentials?.password as string;
        const loginType = (credentials?.loginType as string) || 'ldap';

        const clientIp = getClientIpFromHeaders(req?.headers || undefined);
        const userAgent = req?.headers?.get('user-agent') || 'unknown';
        const rateKey = `auth:${clientIp}:${(username || 'unknown').toLowerCase()}`;
        const rate = await consumeAuthRateLimit(rateKey);
        if (!rate.allowed) {
          await writeAuthAudit(null, 'login_rate_limited', { username, clientIp, userAgent });
          throw new Error(`Too many login attempts. Try again in ${rate.retryAfter || 60}s.`);
        }

        // ── Domain SSO Flow (IIS/Kerberos header-based) ─────────────
        if (loginType === 'sso') {
          if (!SSO_ENABLED) {
            throw new Error('Domain SSO is disabled');
          }

          // Always require the shared secret — skipping validation allows header spoofing in any environment.
          if (!SSO_PROXY_SHARED_SECRET) {
            await writeAuthAudit(null, 'login_failed_sso_missing_proxy_secret', { clientIp, userAgent });
            throw new Error('Domain SSO is not fully configured: SSO_PROXY_SHARED_SECRET is required');
          }

          // Preferred path: a short-lived ticket minted by the IIS auth bridge and
          // passed through as the credentials password. The header path below only
          // works behind a proxy that can populate the identity header *after*
          // authenticating — IIS URL Rewrite cannot (it expands {LOGON_USER} at
          // BeginRequest, before Windows auth runs), which is why the bridge exists.
          const ticket = ((credentials?.password as string) || '').trim();
          let identityRaw = '';

          if (ticket) {
            const verified = verifySsoTicket(ticket, SSO_PROXY_SHARED_SECRET);
            if (!verified.valid) {
              await writeAuthAudit(null, 'login_failed_sso_invalid_ticket', {
                reason: verified.reason,
                clientIp,
                userAgent,
              });
              throw new Error('SSO ticket is invalid or expired');
            }
            identityRaw = verified.identity;
          } else {
            const incomingSecret = req?.headers?.get(SSO_PROXY_SECRET_HEADER) || '';
            if (!timingSafeEquals(incomingSecret, SSO_PROXY_SHARED_SECRET)) {
              await writeAuthAudit(null, 'login_failed_sso_untrusted_proxy', { clientIp, userAgent });
              throw new Error('Untrusted SSO request');
            }
            identityRaw = req?.headers?.get(SSO_IDENTITY_HEADER) || '';
          }

          const parsed = parseSsoIdentity(identityRaw);

          if (!parsed.username) {
            await writeAuthAudit(null, 'login_failed_sso_identity_missing', {
              clientIp,
              userAgent,
              header: SSO_IDENTITY_HEADER,
            });
            throw new Error('SSO identity header missing');
          }

          if (SSO_ALLOWED_DOMAINS.length > 0) {
            if (!parsed.domain || !SSO_ALLOWED_DOMAINS.includes(parsed.domain)) {
              await writeAuthAudit(null, 'login_failed_sso_domain_disallowed', {
                username: parsed.username,
                domain: parsed.domain,
                clientIp,
                userAgent,
              });
              throw new Error('Domain is not allowed for SSO');
            }
          }

          let ssoUsername = parsed.username;
          let ssoDisplayName: string | null = parsed.username;
          let ssoEmail: string | null = null;

          try {
            const ldapUser = await ldapSearch(parsed.username);
            if (ldapUser) {
              ssoUsername = ldapUser.sAMAccountName || parsed.username;
              ssoDisplayName = ldapUser.displayName || parsed.username;
              ssoEmail = ldapUser.mail || null;
            }
          } catch (err) {
            logger.warn({ err, username: parsed.username }, 'SSO LDAP enrichment failed; continuing with header identity');
          }

          const upsertResult = await query<User>(
            `INSERT INTO users (username, display_name, email, role, auth_type, is_active, last_login_at)
             VALUES ($1, $2, $3, 'user', 'ldap', true, NOW())
             ON CONFLICT (username) DO UPDATE SET
               display_name = COALESCE($2, users.display_name),
               email = COALESCE($3, users.email),
               auth_type = 'ldap',
               last_login_at = NOW(),
               updated_at = NOW()
             RETURNING *`,
            [ssoUsername, ssoDisplayName, ssoEmail]
          );

          const user = upsertResult.rows[0];
          await writeAuthAudit(user.id, 'login_success_sso', {
            username: user.username,
            domain: parsed.domain,
            clientIp,
            userAgent,
          });

          return {
            id: String(user.id),
            username: user.username,
            role: user.role,
            companyId: user.company_id,
            deptId: user.dept_id,
            onboardingComplete: user.onboarding_complete,
          };
        }

        if (!username) {
          throw new Error('Username is required');
        }

        // ── Local Flow (DB user first, then env-var admin fallback) ─────
        if (loginType === 'local') {
          if (!password) {
            throw new Error('Password is required');
          }

          // Check for a manually-created local user in the DB (password_hash column)
          const dbLocalUser = await query<User & { password_hash: string | null }>(
            `SELECT * FROM users WHERE lower(username) = lower($1) AND auth_type = 'local' AND is_active = true AND password_hash IS NOT NULL LIMIT 1`,
            [username]
          );
          if ((dbLocalUser.rowCount || 0) > 0) {
            const dbUser = dbLocalUser.rows[0];
            const [salt, storedHash] = (dbUser.password_hash || '').split(':');
            let passwordValid = false;
            if (salt && storedHash) {
              const derived = await new Promise<Buffer>((resolve, reject) =>
                crypto.scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, key) =>
                  err ? reject(err) : resolve(key)
                )
              );
              passwordValid = crypto.timingSafeEqual(Buffer.from(storedHash, 'hex'), derived);
            }
            if (!passwordValid) {
              await writeAuthAudit(null, 'login_failed_local_invalid_credentials', { username, clientIp, userAgent });
              return null;
            }
            await query(`UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1`, [dbUser.id]);
            await writeAuthAudit(dbUser.id, 'login_success_local', { username: dbUser.username, clientIp, userAgent });
            return {
              id: String(dbUser.id),
              username: dbUser.username,
              role: dbUser.role,
              companyId: dbUser.company_id,
              deptId: dbUser.dept_id,
              onboardingComplete: dbUser.onboarding_complete,
            };
          }

          // Env-var admin fallback
          const localUser = process.env.LOCAL_ADMIN_USERNAME;
          const localPass = getSecret('LOCAL_ADMIN_PASSWORD');

          if (!localUser || !localPass) {
            throw new Error('Local admin login is not configured');
          }

          // Constant-time comparison
          const usernameMatch =
            username.length === localUser.length &&
            crypto.timingSafeEqual(Buffer.from(username), Buffer.from(localUser));
          const passwordMatch =
            password.length === localPass.length &&
            crypto.timingSafeEqual(Buffer.from(password), Buffer.from(localPass));

          if (!usernameMatch || !passwordMatch) {
            await writeAuthAudit(null, 'login_failed_local_invalid_credentials', { username, clientIp, userAgent });
            return null;
          }

          try {
            // Upsert local admin user when DB is reachable.
            const upsertResult = await query<User>(
              `INSERT INTO users (username, display_name, role, auth_type, is_active, onboarding_complete, last_login_at)
               VALUES ($1, 'Local Administrator', 'admin', 'local', true, true, NOW())
               ON CONFLICT (username) DO UPDATE SET
                 role = 'admin',
                 auth_type = 'local',
                 last_login_at = NOW(),
                 updated_at = NOW()
               RETURNING *`,
              [username]
            );

            const user = upsertResult.rows[0];
            await writeAuthAudit(user.id, 'login_success_local', { username: user.username, clientIp, userAgent });
            return {
              id: String(user.id),
              username: user.username,
              role: user.role,
              companyId: user.company_id,
              deptId: user.dept_id,
              onboardingComplete: user.onboarding_complete,
            };
          } catch (err) {
            if (!ALLOW_LOCAL_ADMIN_DB_FALLBACK) {
              await writeAuthAudit(null, 'login_failed_local_db_unavailable', { username, clientIp, userAgent });
              throw new Error('Database unavailable and local fallback login is disabled by policy');
            }

            // Local admin fallback when DB is unavailable (policy-controlled).
            logger.warn({ err, username }, 'DB unavailable during local admin login; using fallback local session');
            await writeAuthAudit(null, 'login_success_local_fallback', { username, clientIp, userAgent });
            return {
              id: '-1',
              username,
              role: 'admin',
              companyId: null,
              deptId: null,
              onboardingComplete: true,
            };
          }
        }

        // ── Demo Flow ───────────────────────────
        if (loginType === 'demo') {
          if (process.env.DEMO_LOGIN_ENABLED !== 'true') {
            throw new Error('Demo login is disabled');
          }

          const upsertResult = await query<User>(
            `INSERT INTO users (username, display_name, role, auth_type, is_active, onboarding_complete, last_login_at)
             VALUES ($1, $1, 'user', 'demo', true, false, NOW())
             ON CONFLICT (username) DO UPDATE SET
               auth_type = 'demo',
               onboarding_complete = false,
               last_login_at = NOW(),
               updated_at = NOW()
             RETURNING *`,
            [username]
          );

          const user = upsertResult.rows[0];
          await writeAuthAudit(user.id, 'login_success_demo', { username: user.username, clientIp, userAgent });
          return {
            id: String(user.id),
            username: user.username,
            role: user.role,
            companyId: user.company_id,
            deptId: user.dept_id,
            onboardingComplete: user.onboarding_complete,
          };
        }

        // ── LDAP Flow ───────────────────────────
        if (!password) {
          throw new Error('Password is required');
        }

        // 1. Search for user in AD
        const ldapUser = await ldapSearch(username);
        if (!ldapUser) {
          logger.warn({ username }, 'LDAP user not found');
          await writeAuthAudit(null, 'login_failed_ldap_user_not_found', { username, clientIp, userAgent });
          return null;
        }

        // 2. Attempt bind with user credentials
        const bindSuccess = await ldapBind(ldapUser.dn, password);
        if (!bindSuccess) {
          await writeAuthAudit(null, 'login_failed_ldap_invalid_password', { username, clientIp, userAgent });
          return null;
        }

        // 3. Upsert user in database
        const upsertResult = await query<User>(
          `INSERT INTO users (username, display_name, email, role, auth_type, is_active, last_login_at)
           VALUES ($1, $2, $3, 'user', 'ldap', true, NOW())
           ON CONFLICT (username) DO UPDATE SET
             display_name = COALESCE($2, users.display_name),
             email = COALESCE($3, users.email),
             auth_type = 'ldap',
             last_login_at = NOW(),
             updated_at = NOW()
           RETURNING *`,
          [ldapUser.sAMAccountName, ldapUser.displayName || null, ldapUser.mail || null]
        );

        const user = upsertResult.rows[0];
        logger.info({ userId: user.id, username: user.username }, 'LDAP login successful');
        await writeAuthAudit(user.id, 'login_success_ldap', { username: user.username, clientIp, userAgent });

        return {
          id: String(user.id),
          username: user.username,
          role: user.role,
          companyId: user.company_id,
          deptId: user.dept_id,
          onboardingComplete: user.onboarding_complete,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = parseInt(user.id as string, 10);
        token.username = user.username;
        token.role = user.role;
        token.companyId = user.companyId;
        token.deptId = user.deptId;
        token.onboardingComplete = user.onboardingComplete;
        token.insightsAccess = (user as any).insightsAccess;
        token.companyHeadAccess = (user as any).companyHeadAccess;
      }

      if (trigger === 'update' && token.id && Number(token.id) > 0) {
        try {
          const profile = await getAuthSessionProfile(Number(token.id));
          if (profile) {
            token.username = profile.username;
            token.role = profile.role;
            token.companyId = profile.company_id;
            token.deptId = profile.dept_id;
            token.onboardingComplete = profile.onboarding_complete;
            token.insightsAccess = profile.insights_access;
            token.companyHeadAccess = profile.company_head_access;
          }
        } catch (err) {
          logger.warn({ err, userId: token.id }, 'Failed to refresh token on session update');
        }
      }

      return token;
    },
    async session({ session, token }) {
      let resolved = {
        id: token.id,
        username: token.username,
        role: token.role,
        companyId: token.companyId,
        deptId: token.deptId,
        onboardingComplete: token.onboardingComplete,
        insightsAccess: token.insightsAccess,
        companyHeadAccess: token.companyHeadAccess,
      };

      if (token.id && Number(token.id) > 0) {
        try {
          const profile = await getAuthSessionProfile(Number(token.id));
          if (profile) {
            resolved = {
              id: profile.id,
              username: profile.username,
              role: profile.role,
              companyId: profile.company_id,
              deptId: profile.dept_id,
              onboardingComplete: profile.onboarding_complete,
              insightsAccess: profile.insights_access,
              companyHeadAccess: profile.company_head_access,
            };
          }
        } catch (err) {
          logger.warn({ err, userId: token.id }, 'Failed to refresh session from DB; using token values');
        }
      }

      session.user = resolved as any;
      return session;
    },
  },
});
