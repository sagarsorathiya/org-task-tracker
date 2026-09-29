import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { query } from '@/lib/db';
import { signBackup } from '@/lib/backupSigning';
import { getSecret } from '@/lib/secrets';
import type { ApiResponse } from '@/types';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { createWriteStream } from 'fs';
import archiver from 'archiver';
import { getPgDumpPath } from '@/lib/pgTools';
import os from 'os';
import path from 'path';

export const runtime = 'nodejs';

type PgEnv = {
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
};

type ExportMode = 'db' | 'full';

// Non-secret configuration keys safe to include in backups.
// Secrets (passwords, tokens, signing keys) are intentionally excluded — they must be
// reconfigured on the target environment after restore.
const PORTABLE_ENV_KEYS = [
  'NODE_ENV',
  'PORT',
  'NEXTAUTH_URL',
  'AUTH_TRUST_HOST',
  'PG_HOST',
  'PG_PORT',
  'PG_DATABASE',
  'PG_USER',
  'PG_PASSWORD_FILE',
  'PG_SSL_CA_PATH',
  'LDAP_URL',
  'LDAP_BIND_DN',
  'LDAP_BIND_PASSWORD_FILE',
  'LDAP_SEARCH_BASE',
  'LDAP_USER_FILTER',
  'LOCAL_ADMIN_USERNAME',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_PASSWORD_FILE',
  'WAHA_BASE_URL',
  'WAHA_SESSION',
  'REMINDER_SCHEDULER_ENABLED',
  'REMINDER_CRON',
  'REMINDER_REALTIME_CRON',
  'SSO_ENABLED',
  'SSO_AUTO_LOGIN',
  'SSO_IDENTITY_HEADER',
  'SSO_ALLOWED_DOMAINS',
  'SSO_PROXY_SECRET_HEADER',
  'CORS_ORIGINS',
  'ALLOW_DB_RESTORE_IN_PRODUCTION',
];

function getPgEnv(): PgEnv {
  return {
    host: process.env.PG_HOST || 'localhost',
    port: process.env.PG_PORT || '5432',
    database: process.env.PG_DATABASE || 'organization_tracker',
    user: process.env.PG_USER || 'postgres',
    password: getSecret('PG_PASSWORD', ''),
  };
}

async function runPgDump(outputFile: string, pg: PgEnv): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const args = [
      '-h', pg.host,
      '-p', pg.port,
      '-U', pg.user,
      '-d', pg.database,
      '--format=plain',
      '--encoding=UTF8',
      '--no-owner',
      '--no-privileges',
      '--clean',
      '--if-exists',
      '--file', outputFile,
    ];

    const child = spawn(getPgDumpPath(), args, {
      env: {
        ...process.env,
        PGPASSWORD: pg.password,
      },
      windowsHide: true,
    });

    let stderr = '';
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });

    child.on('error', (err: Error) => {
      reject(err);
    });

    child.on('close', (code: number | null) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr || `pg_dump exited with code ${code}`));
      }
    });
  });
}

async function copyFileIfExists(src: string, dst: string): Promise<boolean> {
  try {
    await fs.access(src);
  } catch {
    return false;
  }
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.copyFile(src, dst);
  return true;
}

async function copyDirectoryRecursive(srcDir: string, dstDir: string): Promise<number> {
  try {
    await fs.access(srcDir);
  } catch {
    return 0;
  }

  let copied = 0;
  await fs.mkdir(dstDir, { recursive: true });
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(srcDir, entry.name);
    const dst = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      copied += await copyDirectoryRecursive(src, dst);
    } else {
      await fs.mkdir(path.dirname(dst), { recursive: true });
      await fs.copyFile(src, dst);
      copied += 1;
    }
  }

  return copied;
}

async function createArchive(sourceDir: string, outputFile: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(outputFile);
    const archive = archiver('zip', { zlib: { level: 6 } });

    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

function buildPortableEnvSnapshot() {
  const env: Record<string, string> = {};
  for (const key of PORTABLE_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    warning: 'Secrets (passwords, tokens, signing keys) are NOT included. Reconfigure them on the target server after restore.',
    env,
  };
}

async function buildFullPortableBackup(params: {
  ts: string;
  signedSql: string;
  pg: PgEnv;
  exportedBy: number | string;
}): Promise<{ fileName: string; buffer: Buffer; manifest: Record<string, unknown> }> {
  const { ts, signedSql, pg, exportedBy } = params;
  const bundleDir = path.join(os.tmpdir(), `org-tracker-portable-backup-${ts}`);
  const archivePath = path.join(os.tmpdir(), `organization-full-backup-${ts}.zip`);
  const workspaceRoot = process.cwd();

  await fs.mkdir(bundleDir, { recursive: true });

  const dbDir = path.join(bundleDir, 'database');
  const configDir = path.join(bundleDir, 'config');
  const artifactsDir = path.join(bundleDir, 'artifacts');
  const uploadsDir = path.join(bundleDir, 'uploads');

  await fs.mkdir(dbDir, { recursive: true });
  await fs.mkdir(configDir, { recursive: true });
  await fs.mkdir(artifactsDir, { recursive: true });
  await fs.mkdir(uploadsDir, { recursive: true });

  await fs.writeFile(path.join(dbDir, 'database-backup.sql'), signedSql, 'utf8');
  await fs.writeFile(path.join(configDir, 'env-secrets.snapshot.json'), JSON.stringify(buildPortableEnvSnapshot(), null, 2), 'utf8');

  const filesCopied: string[] = [];
  const rootFiles = [
    'server.js',
    'next.config.js',
    'package.json',
    'package-lock.json',
    'postcss.config.js',
    'tailwind.config.ts',
    'tsconfig.json',
    'README.md',
    '.env.example',
  ];

  for (const file of rootFiles) {
    const copied = await copyFileIfExists(
      path.join(workspaceRoot, file),
      path.join(artifactsDir, file)
    );
    if (copied) filesCopied.push(file);
  }

  const schemaCopied = await copyFileIfExists(
    path.join(workspaceRoot, 'src', 'db', 'schema.sql'),
    path.join(artifactsDir, 'src', 'db', 'schema.sql')
  );
  if (schemaCopied) filesCopied.push('src/db/schema.sql');

  const seedCopied = await copyFileIfExists(
    path.join(workspaceRoot, 'src', 'db', 'seed.sql'),
    path.join(artifactsDir, 'src', 'db', 'seed.sql')
  );
  if (seedCopied) filesCopied.push('src/db/seed.sql');

  const uploadsCopiedCount = await copyDirectoryRecursive(path.join(workspaceRoot, 'uploads'), uploadsDir);
  const nextCopiedCount = await copyDirectoryRecursive(path.join(workspaceRoot, '.next'), path.join(artifactsDir, '.next'));
  const logsCopiedCount = await copyDirectoryRecursive(path.join(workspaceRoot, 'logs'), path.join(artifactsDir, 'logs'));

  const manifest = {
    generatedAt: new Date().toISOString(),
    exportMode: 'full',
    database: {
      host: pg.host,
      port: pg.port,
      name: pg.database,
      user: pg.user,
      rolesAndPrivilegesIncluded: false,
      notes: 'Dump generated with --no-owner --no-privileges --clean --if-exists',
    },
    exportedBy,
    includes: {
      databaseSql: true,
      uploadsFilesCount: uploadsCopiedCount,
      runtimeBuildArtifactsFilesCount: nextCopiedCount,
      logsFilesCount: logsCopiedCount,
      configAndServerFiles: filesCopied,
      envAndSecretsSnapshot: true,
    },
    portabilityNotes: [
      'Restore database from database/database-backup.sql using app import endpoint or psql.',
      'Copy uploads folder into target server workspace root (uploads).',
      'Copy env-secrets.snapshot.json values into target environment securely.',
      'Copy artifacts files as needed; .next is optional if rebuilding on target server.',
    ],
  };

  await fs.writeFile(path.join(bundleDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  await createArchive(bundleDir, archivePath);

  const fileBuffer = await fs.readFile(archivePath);
  const fileName = path.basename(archivePath);

  await fs.rm(bundleDir, { recursive: true, force: true });
  await fs.rm(archivePath, { force: true });

  return { fileName, buffer: fileBuffer, manifest };
}

export async function GET(req: Request) {
  const pg = getPgEnv();
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const tmpFile = path.join(os.tmpdir(), `org-tracker-backup-${ts}.sql`);

  try {
    const session = await auth();
    if (!session?.user || session.user.role !== 'admin') {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Forbidden', errorCode: 'AUTH_FORBIDDEN' }, { status: 403 });
    }

    if (Number(session.user.id) === -1) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Database unavailable in fallback mode', errorCode: 'DB_UNAVAILABLE' }, { status: 503 });
    }

    const { searchParams } = new URL(req.url);
    const mode = (searchParams.get('mode') === 'full' ? 'full' : 'db') as ExportMode;

    await runPgDump(tmpFile, pg);

    const rawSql = await fs.readFile(tmpFile, 'utf8');
    const signedSql = signBackup(rawSql, {
      exportedAt: new Date().toISOString(),
      exportedBy: session.user.id,
      database: pg.database,
      host: pg.host,
    });

    if (mode === 'full') {
      const portable = await buildFullPortableBackup({
        ts,
        signedSql,
        pg,
        exportedBy: session.user.id,
      });

      await query(
        `INSERT INTO audit_log (actor_id, entity_type, entity_id, action, diff)
         VALUES ($1, 'config_database', 0, 'export_backup_full', $2)`,
        [session.user.id, JSON.stringify({ fileName: portable.fileName, signed: !!process.env.BACKUP_SIGNING_SECRET, mode: 'full', manifest: portable.manifest.includes })]
      );

      logger.info({ userId: session.user.id, fileName: portable.fileName }, 'Full portable backup export completed');

      return new NextResponse(new Uint8Array(portable.buffer), {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${portable.fileName}"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    const fileBuffer = Buffer.from(signedSql, 'utf8');
    const fileName = `organization-db-backup-${ts}.sql`;

    await query(
      `INSERT INTO audit_log (actor_id, entity_type, entity_id, action, diff)
       VALUES ($1, 'config_database', 0, 'export_backup', $2)`,
      [session.user.id, JSON.stringify({ fileName, signed: !!process.env.BACKUP_SIGNING_SECRET, mode: 'db' })]
    );

    logger.info({ userId: session.user.id, fileName }, 'Database export completed');

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/sql; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error({ err }, 'Database export failed');

    if (message.includes('ENOENT')) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'pg_dump is not available in PATH on server', errorCode: 'PGDUMP_NOT_FOUND' },
        { status: 500 }
      );
    }

    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Database export failed', errorCode: 'DB_EXPORT_FAILED' }, { status: 500 });
  } finally {
    try {
      await fs.unlink(tmpFile);
    } catch {
      // no-op
    }
  }
}
