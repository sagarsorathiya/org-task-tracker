import crypto from 'crypto';
import { query } from './db';

export type IdempotencyResult =
  | { kind: 'fresh' }
  | { kind: 'replay'; statusCode: number; response: unknown }
  | { kind: 'conflict' };

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(',')}}`;
}

export function hashRequestBody(body: unknown): string {
  return crypto.createHash('sha256').update(stableStringify(body)).digest('hex');
}

export async function beginIdempotentRequest(options: {
  key: string;
  scope: string;
  requestHash: string;
  ttlSeconds?: number;
}): Promise<IdempotencyResult> {
  const { key, scope, requestHash, ttlSeconds = 60 * 60 } = options;

  await query(
    'DELETE FROM api_idempotency_keys WHERE expires_at < NOW()',
    []
  );

  const existing = await query<{
    request_hash: string;
    response_json: unknown;
    status_code: number | null;
  }>(
    `SELECT request_hash, response_json, status_code
     FROM api_idempotency_keys
     WHERE key = $1 AND scope = $2 AND expires_at > NOW()`,
    [key, scope]
  );

  if (existing.rowCount && existing.rows[0]) {
    const row = existing.rows[0];
    if (row.request_hash !== requestHash) {
      return { kind: 'conflict' };
    }

    if (row.status_code && row.response_json !== null) {
      return { kind: 'replay', statusCode: row.status_code, response: row.response_json };
    }

    return { kind: 'fresh' };
  }

  await query(
    `INSERT INTO api_idempotency_keys (key, scope, request_hash, expires_at)
     VALUES ($1, $2, $3, NOW() + ($4 * INTERVAL '1 second'))
     ON CONFLICT (key, scope) DO NOTHING`,
    [key, scope, requestHash, ttlSeconds]
  );

  return { kind: 'fresh' };
}

export async function finalizeIdempotentRequest(options: {
  key: string;
  scope: string;
  response: unknown;
  statusCode: number;
}): Promise<void> {
  const { key, scope, response, statusCode } = options;
  await query(
    `UPDATE api_idempotency_keys
     SET response_json = $1, status_code = $2
     WHERE key = $3 AND scope = $4`,
    [response, statusCode, key, scope]
  );
}
