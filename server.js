// ──────────────────────────────────────────────
// Custom Next.js Server — server.js
// Wraps Next.js + runs DB migration + scheduler
// ──────────────────────────────────────────────

const { createServer } = require('http');
const next = require('next');
const path = require('path');
const fs = require('fs');
const pino = require('pino');

function readSecret(name, fallback = '') {
  const filePath = process.env[`${name}_FILE`];
  if (filePath) {
    try {
      return fs.readFileSync(filePath, 'utf8').trim();
    } catch {
      return fallback;
    }
  }

  return process.env[name] || fallback;
}

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  redact: {
    paths: ['password', 'LDAP_BIND_PASSWORD', 'NEXTAUTH_SECRET', 'headers.authorization'],
    censor: '[REDACTED]',
  },
});

const isNpmDevCommand = process.env.npm_lifecycle_event === 'dev';
const isNpmStartCommand = process.env.npm_lifecycle_event === 'start';

if (isNpmDevCommand) {
  process.env.NODE_ENV = 'development';
}
if (!process.env.NODE_ENV && isNpmStartCommand) {
  process.env.NODE_ENV = 'production';
}

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOST || 'localhost';
const port = parseInt(process.env.PORT || '4000', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

async function runMigrations() {
  try {
    logger.info('Running database migrations');
    const { Pool } = require('pg');
    const { readFileSync } = require('fs');

    const caPath = process.env.PG_SSL_CA_PATH;
    const sslConfig = process.env.PG_SSL === 'true'
      ? {
          rejectUnauthorized: process.env.NODE_ENV === 'production',
          ...(caPath ? { ca: fs.readFileSync(caPath, 'utf8') } : {}),
        }
      : false;

    const pool = new Pool({
      host: process.env.PG_HOST || 'localhost',
      port: parseInt(process.env.PG_PORT || '5432', 10),
      database: process.env.PG_DATABASE || 'organization_tracker',
      user: process.env.PG_USER || 'organization_app',
      password: readSecret('PG_PASSWORD', 'changeme'),
      ssl: sslConfig,
    });

    const client = await pool.connect();
    try {
      const schemaPath = path.join(__dirname, 'src', 'db', 'schema.sql');
      const seedPath = path.join(__dirname, 'src', 'db', 'seed.sql');
      
      const schemaSQL = readFileSync(schemaPath, 'utf-8');
      await client.query(schemaSQL);
      logger.info('Schema applied');

      const seedMode = (process.env.DB_SEED_MODE || 'once').toLowerCase();
      if (seedMode === 'never') {
        logger.info('Seed skipped (DB_SEED_MODE=never)');
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
            logger.info('Seed skipped (existing data detected; marker initialized)');
            return;
          }

          await client.query('BEGIN');
          try {
            const seedSQL = readFileSync(seedPath, 'utf-8');
            await client.query(seedSQL);
            await client.query(
              `INSERT INTO app_metadata (key, value, updated_at)
               VALUES ($1, $2, NOW())
               ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
              [markerKey, new Date().toISOString()]
            );
            await client.query('COMMIT');
            logger.info({ mode: seedMode }, 'Seed data applied');
          } catch (seedErr) {
            await client.query('ROLLBACK');
            throw seedErr;
          }
        } else {
          logger.info('Seed skipped (already applied)');
        }
      }
    } finally {
      client.release();
      await pool.end();
    }
  } catch (err) {
    logger.error({ err }, 'Migration failed, continuing without migration');
  }
}

app.prepare().then(async () => {
  // Run migrations
  await runMigrations();

  // Init scheduler (dynamic import to let Next.js compile TS modules)
  try {
    if (process.env.REMINDER_SCHEDULER_ENABLED === 'true') {
      // The scheduler will be initialized via the app's module system
      logger.info('Reminder scheduler enabled');
    }
  } catch (err) {
    logger.error({ err }, 'Scheduler init error');
  }

  createServer(async (req, res) => {
    const startedAt = Date.now();
    try {
      await handle(req, res);

      logger.info({
        method: req.method,
        path: req.url,
        status: res.statusCode,
        duration: Date.now() - startedAt,
        userId: req.headers['x-user-id'] || null,
      }, 'HTTP request');
    } catch (err) {
      logger.error({ err }, 'Request error');
      res.statusCode = 500;
      res.end('Internal Server Error');

      logger.info({
        method: req.method,
        path: req.url,
        status: 500,
        duration: Date.now() - startedAt,
        userId: req.headers['x-user-id'] || null,
      }, 'HTTP request');
    }
  }).listen(port, () => {
    logger.info({ url: `http://${hostname}:${port}`, env: dev ? 'development' : 'production' }, 'Organization Activity Tracker ready');
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down');
  process.exit(0);
});
