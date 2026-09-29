// ──────────────────────────────────────────────
// Database Migration Runner
// Runs schema.sql then seed.sql on startup
// ──────────────────────────────────────────────

import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';

async function migrate() {
  const pool = new Pool({
    host: process.env.PG_HOST || 'localhost',
    port: parseInt(process.env.PG_PORT || '5432', 10),
    database: process.env.PG_DATABASE || 'organization_tracker',
    user: process.env.PG_USER || 'organization_app',
    password: process.env.PG_PASSWORD || 'changeme',
    ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });

  const client = await pool.connect();

  try {
    console.log('[migrate] Running schema.sql...');
    const schemaSQL = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
    await client.query(schemaSQL);
    console.log('[migrate] Schema applied successfully.');

    const seedMode = (process.env.DB_SEED_MODE || 'once').toLowerCase();
    if (seedMode === 'never') {
      console.log('[migrate] Seed skipped (DB_SEED_MODE=never).');
    } else {
      await client.query(`
        CREATE TABLE IF NOT EXISTS app_metadata (
          key TEXT PRIMARY KEY,
          value TEXT,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      const markerKey = 'seed.sql.v1';
      const marker = await client.query('SELECT value FROM app_metadata WHERE key = $1', [markerKey]);
      const alreadySeeded = marker.rowCount && marker.rowCount > 0;
      const counts = await client.query(
        `SELECT
           (SELECT COUNT(*)::int FROM companies) AS companies_count,
           (SELECT COUNT(*)::int FROM departments) AS departments_count,
           (SELECT COUNT(*)::int FROM designations) AS designations_count,
           (SELECT COUNT(*)::int FROM users) AS users_count,
           (SELECT COUNT(*)::int FROM tasks) AS tasks_count`
      );
      const dbHasData = counts.rows[0]
        && (counts.rows[0].companies_count > 0
          || counts.rows[0].departments_count > 0
          || counts.rows[0].designations_count > 0
          || counts.rows[0].users_count > 0
          || counts.rows[0].tasks_count > 0);

      if (seedMode === 'always' || !alreadySeeded) {
        if (seedMode !== 'always' && dbHasData) {
          await client.query(
            `INSERT INTO app_metadata (key, value, updated_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
            [markerKey, 'adopted-existing-data']
          );
          console.log('[migrate] Seed skipped (existing data detected; marker initialized).');
          return;
        }

        console.log(`[migrate] Running seed.sql (mode=${seedMode})...`);
        await client.query('BEGIN');
        try {
          const seedSQL = readFileSync(join(__dirname, 'seed.sql'), 'utf-8');
          await client.query(seedSQL);
          await client.query(
            `INSERT INTO app_metadata (key, value, updated_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
            [markerKey, new Date().toISOString()]
          );
          await client.query('COMMIT');
          console.log('[migrate] Seed data applied successfully.');
        } catch (seedErr) {
          await client.query('ROLLBACK');
          throw seedErr;
        }
      } else {
        console.log('[migrate] Seed skipped (already applied).');
      }
    }
  } catch (err) {
    console.error('[migrate] Migration failed:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

// Allow direct execution via `tsx src/db/migrate.ts`
if (require.main === module) {
  migrate()
    .then(() => {
      console.log('[migrate] Done.');
      process.exit(0);
    })
    .catch(() => {
      process.exit(1);
    });
}

export { migrate };
