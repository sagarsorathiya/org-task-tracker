import { NextResponse } from 'next/server';
import type { ApiResponse } from '@/types';

// Must be evaluated per-request: without this Next prerenders the route at build
// time and bakes in the build machine's env values, so production's SSO flags never apply.
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json<ApiResponse<{
    demoEnabled: boolean;
    ssoEnabled: boolean;
    ssoAutoLogin: boolean;
  }>>({
    success: true,
    data: {
      demoEnabled: process.env.DEMO_LOGIN_ENABLED === 'true',
      ssoEnabled: !!process.env.SSO_ENABLED && process.env.SSO_ENABLED !== 'false',
      ssoAutoLogin: !!process.env.SSO_AUTO_LOGIN && process.env.SSO_AUTO_LOGIN !== 'false',
    },
  });
}
