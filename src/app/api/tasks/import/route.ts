import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { logger } from '@/lib/logger';
import { MAX_FILE_SIZE_BYTES } from '@/constants';
import type { ApiResponse } from '@/types';

type ImportErrorItem = {
  row: number;
  reason: string;
  title?: string;
};

type ImportSummary = {
  inserted: number;
  updated: number;
  skipped: number;
  errors: ImportErrorItem[];
};

function canImport(role?: string): boolean {
  return role === 'admin';
}

function normalizeHeader(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function parseCsv(content: string): Record<string, string>[] {
  const records: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    const next = content[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === ',' && !inQuotes) {
      row.push(field.trim());
      field = '';
      continue;
    }

    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(field.trim());
      field = '';
      if (row.some((v) => v.length > 0)) records.push(row);
      row = [];
      continue;
    }

    field += ch;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.trim());
    if (row.some((v) => v.length > 0)) records.push(row);
  }

  if (!records.length) return [];

  const headers = records[0].map((h) => normalizeHeader(h));
  return records.slice(1).map((cols) => {
    const out: Record<string, string> = {};
    headers.forEach((h, idx) => {
      out[h] = (cols[idx] || '').trim();
    });
    return out;
  });
}

function parseIntOrNull(value: string | undefined): number | null {
  if (!value || !value.trim()) return null;
  const n = parseInt(value.trim(), 10);
  return Number.isNaN(n) ? null : n;
}

function parseDateOrNull(value: string | undefined): string | null {
  if (!value || !value.trim()) return null;
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function parseTimeOrNull(value: string | undefined): string | null {
  if (!value || !value.trim()) return null;
  const v = value.trim();
  if (/^\d{2}:\d{2}$/.test(v)) return `${v}:00`;
  if (/^\d{2}:\d{2}:\d{2}$/.test(v)) return v;
  return null;
}

function parseIdArray(value: string | undefined): number[] {
  if (!value || !value.trim()) return [];
  return Array.from(new Set(
    value
      .split(/[;,]/)
      .map((v) => parseInt(v.trim(), 10))
      .filter((v) => !Number.isNaN(v) && v > 0)
  ));
}

function normalizeStatus(value: string | undefined): 'open' | 'in_progress' | 'completed' | 'cancelled' {
  const raw = (value || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (raw === 'in-progress') return 'in_progress';
  if (raw === 'done') return 'completed';
  if (raw === 'close' || raw === 'closed') return 'cancelled';
  if (raw === 'open' || raw === 'in_progress' || raw === 'completed' || raw === 'cancelled') return raw;
  return 'open';
}

function normalizePriority(value: string | undefined): 'low' | 'medium' | 'high' | 'critical' {
  const raw = (value || '').trim().toLowerCase();
  if (raw === 'urgent') return 'critical';
  if (raw === 'low' || raw === 'medium' || raw === 'high' || raw === 'critical') return raw;
  return 'medium';
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Unauthorized' }, { status: 401 });
    if (!canImport(session.user.role)) return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Forbidden' }, { status: 403 });

    if (Number(session.user.id) === -1) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Database unavailable in fallback mode' }, { status: 503 });
    }

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'File is required' }, { status: 400 });
    }

    const filename = file.name.toLowerCase();
    if (!filename.endsWith('.csv') && !filename.endsWith('.xlsx') && !filename.endsWith('.xls')) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Only CSV and XLSX files are supported' }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Import file exceeds 30MB limit' }, { status: 400 });
    }

    const fileBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(fileBuffer);

    let rows: Record<string, string>[] = [];

    if (filename.endsWith('.csv')) {
      rows = parseCsv(buffer.toString('utf8'));
    } else if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(fileBuffer as any);
      const worksheet = workbook.worksheets[0];
      if (!worksheet) {
        return NextResponse.json<ApiResponse<null>>({ success: false, error: 'No worksheet found' }, { status: 400 });
      }

      const headerRow = worksheet.getRow(1);
      const headers = (headerRow.values as unknown[]).slice(1).map((h) => normalizeHeader(h));
      rows = [];

      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const values = (row.values as unknown[]).slice(1);
        const hasAny = values.some((v) => v !== null && v !== undefined && String(v).trim() !== '');
        if (!hasAny) return;
        const item: Record<string, string> = {};
        headers.forEach((h, idx) => {
          item[h] = values[idx] !== undefined && values[idx] !== null ? String(values[idx]) : '';
        });
        rows.push(item);
      });
    }

    let inserted = 0;
    let updated = 0;
    const skipped = 0;
    const errors: ImportErrorItem[] = [];

    const existingById = new Set<number>();
    const idsToCheck = rows
      .map((r) => parseIntOrNull(r.id))
      .filter((id): id is number => !!id && id > 0);
    if (idsToCheck.length > 0) {
      const exists = await query<{ id: number }>('SELECT id FROM tasks WHERE id = ANY($1::int[])', [Array.from(new Set(idsToCheck))]);
      exists.rows.forEach((r) => existingById.add(r.id));
    }

    await query('BEGIN');
    try {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNumber = i + 2;

        const id = parseIntOrNull(row.id || row.task_id || row.taskid);
        const title = (row.title || row.task || row.task_title || `Imported Task Row ${rowNumber}`).trim();
        const description = (row.description || '').trim() || null;
        const activityStartDate = parseDateOrNull(row.activity_start_date || row.date || row.start_date || row.activity_email_start_date);
        const assignedTo = parseIntOrNull(row.assigned_to);
        const assignedToIds = parseIdArray(row.assigned_to_ids || row.assignee_ids || row.assigned_users);
        const assignedBy = parseIntOrNull(row.assigned_by) || Number(session.user.id);
        const companyId = parseIntOrNull(row.company_id);
        const deptId = parseIntOrNull(row.dept_id || row.department_id);
        const status = normalizeStatus(row.status);
        const priority = normalizePriority(row.priority);
        const lastFollowUpDate = parseDateOrNull(row.last_follow_up_date || row.last_status_update);
        const dueDate = parseDateOrNull(row.due_date || row.target_date || row.target_completion || row.target_completion_date);
        const dueTime = parseTimeOrNull(row.due_time || row.target_time);
        const followUpDate = parseDateOrNull(row.follow_up_date || row.next_reminder || row.next_followup || row.next_follow_up_date);
        const remarksActionTaken = (row.remarks_action_taken || row.remarks || '').trim() || null;
        const isDeleted = String(row.is_deleted || '').trim().toLowerCase() === 'true';
        const deletedAt = row.deleted_at ? new Date(row.deleted_at) : null;
        const createdAt = row.created_at ? new Date(row.created_at) : null;
        const updatedAt = row.updated_at ? new Date(row.updated_at) : null;

        try {
          if (id && id > 0) {
            await query(
              `INSERT INTO tasks (
                 id, title, description, activity_start_date, assigned_to, assigned_to_ids, assigned_by,
                 company_id, dept_id, status, priority, last_follow_up_date, due_date, due_time,
                 follow_up_date, remarks_action_taken, is_deleted, deleted_at, created_at, updated_at
               )
               VALUES (
                 $1, $2, $3, $4, $5, $6, $7,
                 $8, $9, $10, $11, $12, $13, $14,
                 $15, $16, $17, $18, COALESCE($19, NOW()), COALESCE($20, NOW())
               )
               ON CONFLICT (id) DO UPDATE SET
                 title = EXCLUDED.title,
                 description = EXCLUDED.description,
                 activity_start_date = EXCLUDED.activity_start_date,
                 assigned_to = EXCLUDED.assigned_to,
                 assigned_to_ids = EXCLUDED.assigned_to_ids,
                 assigned_by = EXCLUDED.assigned_by,
                 company_id = EXCLUDED.company_id,
                 dept_id = EXCLUDED.dept_id,
                 status = EXCLUDED.status,
                 priority = EXCLUDED.priority,
                 last_follow_up_date = EXCLUDED.last_follow_up_date,
                 due_date = EXCLUDED.due_date,
                 due_time = EXCLUDED.due_time,
                 follow_up_date = EXCLUDED.follow_up_date,
                 remarks_action_taken = EXCLUDED.remarks_action_taken,
                 is_deleted = EXCLUDED.is_deleted,
                 deleted_at = EXCLUDED.deleted_at,
                 created_at = EXCLUDED.created_at,
                 updated_at = EXCLUDED.updated_at`,
              [
                id, title, description, activityStartDate, assignedTo, assignedToIds, assignedBy,
                companyId, deptId, status, priority, lastFollowUpDate, dueDate, dueTime,
                followUpDate, remarksActionTaken, isDeleted, deletedAt, createdAt, updatedAt,
              ]
            );

            if (existingById.has(id)) {
              updated += 1;
            } else {
              inserted += 1;
              existingById.add(id);
            }
          } else {
            await query(
              `INSERT INTO tasks (
                 title, description, activity_start_date, assigned_to, assigned_to_ids, assigned_by,
                 company_id, dept_id, status, priority, last_follow_up_date, due_date, due_time,
                 follow_up_date, remarks_action_taken, is_deleted, deleted_at, created_at, updated_at
               )
               VALUES (
                 $1, $2, $3, $4, $5, $6,
                 $7, $8, $9, $10, $11, $12, $13,
                 $14, $15, $16, $17, COALESCE($18, NOW()), COALESCE($19, NOW())
               )`,
              [
                title, description, activityStartDate, assignedTo, assignedToIds, assignedBy,
                companyId, deptId, status, priority, lastFollowUpDate, dueDate, dueTime,
                followUpDate, remarksActionTaken, isDeleted, deletedAt, createdAt, updatedAt,
              ]
            );
            inserted += 1;
          }
        } catch (err) {
          errors.push({ row: rowNumber, reason: 'Database upsert failed', title });
          logger.error({ err, rowNumber, title }, 'Import failed at row');
          throw err;
        }
      }

      await query("SELECT setval(pg_get_serial_sequence('tasks', 'id'), COALESCE((SELECT MAX(id) FROM tasks), 1), true)");
      await query('COMMIT');
    } catch (err) {
      await query('ROLLBACK');
      return NextResponse.json<ApiResponse<ImportSummary>>(
        {
          success: false,
          error: 'Import failed and was rolled back. No rows were skipped silently.',
          data: {
            inserted: 0,
            updated: 0,
            skipped: 0,
            errors: errors.slice(0, 25),
          },
        },
        { status: 400 }
      );
    }

    const summary: ImportSummary = {
      inserted,
      updated,
      skipped,
      errors: errors.slice(0, 25),
    };

    return NextResponse.json<ApiResponse<ImportSummary>>({ success: true, data: summary });
  } catch (err) {
    logger.error({ err }, 'POST /api/tasks/import error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
