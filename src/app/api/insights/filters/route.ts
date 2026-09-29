import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getUserScopeAssignments } from '@/lib/authorization';
import { query } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { ApiResponse } from '@/types';

type FilterCompany = { id: number; name: string; code: string };
type FilterDepartment = { id: number; name: string };
type DeptCompanyMapRow = { dept_id: number; company_id: number };

interface InsightsFiltersPayload {
  companies: FilterCompany[];
  departments: FilterDepartment[];
  deptCompanyMap: DeptCompanyMapRow[];
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (Number(session.user.id) === -1) {
      return NextResponse.json<ApiResponse<InsightsFiltersPayload>>({
        success: true,
        data: { companies: [], departments: [], deptCompanyMap: [] },
      });
    }

    if (session.user.role === 'admin') {
      const [companiesRes, departmentsRes, mapRes] = await Promise.all([
        query<FilterCompany>('SELECT id, name, code FROM companies WHERE active = true ORDER BY code, name'),
        query<FilterDepartment>('SELECT id, name FROM departments WHERE active = true ORDER BY name'),
        query<DeptCompanyMapRow>('SELECT dept_id, company_id FROM dept_company_map ORDER BY company_id, dept_id'),
      ]);

      return NextResponse.json<ApiResponse<InsightsFiltersPayload>>({
        success: true,
        data: {
          companies: companiesRes.rows,
          departments: departmentsRes.rows,
          deptCompanyMap: mapRes.rows,
        },
      });
    }

    const assignments = await getUserScopeAssignments(session.user);
    if (assignments.length === 0) {
      return NextResponse.json<ApiResponse<InsightsFiltersPayload>>({
        success: true,
        data: { companies: [], departments: [], deptCompanyMap: [] },
      });
    }

    const companyIds = Array.from(new Set(assignments.map((a) => a.company_id)));
    const deptIdsDirect = Array.from(new Set(assignments.map((a) => a.dept_id).filter((v): v is number => v != null)));
    const companyWideIds = Array.from(new Set(assignments.filter((a) => a.dept_id == null).map((a) => a.company_id)));

    const companiesRes = await query<FilterCompany>(
      'SELECT id, name, code FROM companies WHERE id = ANY($1::int[]) ORDER BY code, name',
      [companyIds]
    );

    let mapRows: DeptCompanyMapRow[] = [];
    if (companyWideIds.length > 0) {
      const mapRes = await query<DeptCompanyMapRow>(
        'SELECT dept_id, company_id FROM dept_company_map WHERE company_id = ANY($1::int[])',
        [companyWideIds]
      );
      mapRows = mapRes.rows;
    }

    const deptIdsFromCompanyWide = Array.from(new Set(mapRows.map((m) => m.dept_id)));
    const deptIds = Array.from(new Set([...deptIdsDirect, ...deptIdsFromCompanyWide]));

    const departmentsRes = deptIds.length > 0
      ? await query<FilterDepartment>('SELECT id, name FROM departments WHERE id = ANY($1::int[]) ORDER BY name', [deptIds])
      : { rows: [] as FilterDepartment[], rowCount: 0 };

    const scopedMap = mapRows.filter((m) => deptIds.includes(m.dept_id) && companyIds.includes(m.company_id));

    return NextResponse.json<ApiResponse<InsightsFiltersPayload>>({
      success: true,
      data: {
        companies: companiesRes.rows,
        departments: departmentsRes.rows,
        deptCompanyMap: scopedMap,
      },
    });
  } catch (err) {
    logger.error({ err }, 'GET /api/insights/filters error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
