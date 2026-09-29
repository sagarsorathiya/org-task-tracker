import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { query } from '@/lib/db';
import { verifySignedBackup } from '@/lib/backupSigning';
import { verifyRestoreApprovalToken } from '@/lib/restoreApproval';
import { getSecret } from '@/lib/secrets';
import type { ApiResponse } from '@/types';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { getPsqlPath } from '@/lib/pgTools';
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

function getPgEnv(): PgEnv {
  return {
    host: process.env.PG_HOST || 'localhost',
    port: process.env.PG_PORT || '5432',
    database: process.env.PG_DATABASE || 'organization_tracker',
    user: process.env.PG_USER || 'postgres',
    password: getSecret('PG_PASSWORD', ''),
  };
}

async function runPsql(inputFile: string, pg: PgEnv): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const args = [
      '-h', pg.host,
      '-p', pg.port,
      '-U', pg.user,
      '-d', pg.database,
      '-v', 'ON_ERROR_STOP=1',
      '--single-transaction',
      '-f', inputFile,
    ];

    const child = spawn(getPsqlPath(), args, {
      env: {
        ...process.env,
        PGPASSWORD: pg.password,
      },
      windowsHide: true,
    });

    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('error', (err) => {
      reject(err);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr || `psql exited with code ${code}`));
      }
    });
  });
}

export async function POST(req: Request) {
  const pg = getPgEnv();
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const tmpFile = path.join(os.tmpdir(), `org-tracker-restore-${ts}.sql`);

  try {
    const session = await auth();
    if (!session?.user || session.user.role !== 'admin') {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Forbidden', errorCode: 'AUTH_FORBIDDEN' }, { status: 403 });
    }

    if (Number(session.user.id) === -1) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Database unavailable in fallback mode', errorCode: 'DB_UNAVAILABLE' }, { status: 503 });
    }

    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DB_RESTORE_IN_PRODUCTION !== 'true') {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'Database restore is locked in production by policy', errorCode: 'RESTORE_POLICY_BLOCKED' },
        { status: 403 }
      );
    }

    const formData = await req.formData();
    const file = formData.get('file');
    const approvalToken = String(formData.get('approvalToken') || '');
    const reason = String(formData.get('reason') || '').trim();

    if (!(file instanceof File)) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'SQL backup file is required', errorCode: 'FILE_REQUIRED' }, { status: 400 });
    }

    if (!approvalToken) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Approval token is required', errorCode: 'APPROVAL_TOKEN_REQUIRED' }, { status: 400 });
    }

    if (reason.length < 5) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Restore reason is required (min 5 chars)', errorCode: 'RESTORE_REASON_REQUIRED' }, { status: 400 });
    }

    const approval = verifyRestoreApprovalToken(approvalToken, Number(session.user.id));
    if (!approval.valid) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: approval.reason || 'Invalid approval token', errorCode: 'APPROVAL_TOKEN_INVALID' }, { status: 403 });
    }

    if (!file.name.toLowerCase().endsWith('.sql')) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Only .sql backup files are supported', errorCode: 'FILE_TYPE_INVALID' }, { status: 400 });
    }

    const content = Buffer.from(await file.arrayBuffer());
    const sqlText = content.toString('utf8');
    const verification = verifySignedBackup(sqlText);
    if (!verification.valid) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: verification.reason || 'Backup signature verification failed', errorCode: 'BACKUP_SIGNATURE_INVALID' },
        { status: 400 }
      );
    }

    const cleanedSql = sqlText.startsWith('-- ORG_BACKUP_META ') ? sqlText.split(/\r?\n/).slice(2).join('\n') : sqlText;
    await fs.writeFile(tmpFile, cleanedSql, 'utf8');

    await runPsql(tmpFile, pg);

    await query(
      `INSERT INTO audit_log (actor_id, entity_type, entity_id, action, diff)
       VALUES ($1, 'config_database', 0, 'import_backup', $2)`,
      [session.user.id, JSON.stringify({ fileName: file.name, reason, signed: verification.valid })]
    );

    logger.info({ userId: session.user.id, fileName: file.name }, 'Database import completed');
    return NextResponse.json<ApiResponse<{ fileName: string }>>({
      success: true,
      data: { fileName: file.name },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error({ err }, 'Database import failed');

    if (message.includes('ENOENT')) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'psql is not available in PATH on server', errorCode: 'PSQL_NOT_FOUND' },
        { status: 500 }
      );
    }

    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Database import failed. Ensure backup is valid.', errorCode: 'DB_IMPORT_FAILED' }, { status: 500 });
  } finally {
    try {
      await fs.unlink(tmpFile);
    } catch {
      // no-op
    }
  }
}
