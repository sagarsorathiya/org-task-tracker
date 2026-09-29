import { existsSync } from 'fs';
import path from 'path';

const WIN_PG_VERSIONS = ['18', '17', '16', '15', '14', '13'];

function findPgToolOnWindows(tool: string): string {
  for (const ver of WIN_PG_VERSIONS) {
    const candidate = `C:\\Program Files\\PostgreSQL\\${ver}\\bin\\${tool}.exe`;
    if (existsSync(candidate)) return candidate;
  }
  return tool;
}

/**
 * Returns the path to pg_dump.
 * Respects PG_DUMP_PATH env var; otherwise auto-detects on Windows.
 */
export function getPgDumpPath(): string {
  if (process.env.PG_DUMP_PATH) return process.env.PG_DUMP_PATH;
  if (process.platform === 'win32') return findPgToolOnWindows('pg_dump');
  return 'pg_dump';
}

/**
 * Returns the path to psql.
 * Respects PSQL_PATH env var; otherwise auto-detects on Windows.
 */
export function getPsqlPath(): string {
  if (process.env.PSQL_PATH) return process.env.PSQL_PATH;
  if (process.platform === 'win32') return findPgToolOnWindows('psql');
  return 'psql';
}
