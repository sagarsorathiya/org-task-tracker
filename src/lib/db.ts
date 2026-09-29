// ──────────────────────────────────────────────
// PostgreSQL Connection Pool — Singleton
// ──────────────────────────────────────────────

import { Pool, types, type PoolConfig } from 'pg';
import { logger } from './logger';
import { readFileSync } from 'fs';
import { getSecret } from './secrets';

const shouldLogSql = process.env.LOG_SQL === 'true';

// Keep SQL DATE values (OID 1082) as YYYY-MM-DD strings.
// Parsing to JS Date applies timezone conversion and can shift calendar day.
types.setTypeParser(1082, (value: string) => value);

function getSslConfig(): PoolConfig['ssl'] {
  if (process.env.PG_SSL !== 'true') {
    return false;
  }

  const caPath = process.env.PG_SSL_CA_PATH;
  const ca = caPath ? readFileSync(caPath, 'utf8') : undefined;
  const rejectUnauthorized = process.env.NODE_ENV === 'production';

  return {
    rejectUnauthorized,
    ...(ca ? { ca } : {}),
  };
}

const poolConfig: PoolConfig = {
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT || '5432', 10),
  database: process.env.PG_DATABASE || 'organization_tracker',
  user: process.env.PG_USER || 'organization_app',
  password: getSecret('PG_PASSWORD', 'changeme'),
  ssl: getSslConfig(),
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};

// Singleton pattern for hot-reload safety in dev
const globalForPg = globalThis as unknown as { pgPool: Pool | undefined };

export const pool: Pool = globalForPg.pgPool ?? new Pool(poolConfig);

if (process.env.NODE_ENV !== 'production') {
  globalForPg.pgPool = pool;
}

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected PostgreSQL pool error');
});

/**
 * Execute a parameterized query. Convenience wrapper around pool.query.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function query<T extends Record<string, any> = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<{ rows: T[]; rowCount: number | null }> {
  const start = Date.now();
  try {
    const result = await pool.query<T>(text, params);
    const duration = Date.now() - start;
    if (shouldLogSql) {
      logger.debug({ query: text.substring(0, 80), duration, rowCount: result.rowCount }, 'SQL query executed');
    }
    return { rows: result.rows as T[], rowCount: result.rowCount };
  } catch (err) {
    logger.error({ err, query: text.substring(0, 80) }, 'SQL query failed');
    throw err;
  }
}

export default pool;
