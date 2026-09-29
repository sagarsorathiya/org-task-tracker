import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import type { NextRequest } from 'next/server';

function parseAllowedOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((origin) => {
      try {
        const url = new URL(origin);
        // Only accept http/https origins without path components.
        return (url.protocol === 'http:' || url.protocol === 'https:') && url.pathname === '/';
      } catch {
        return false;
      }
    });
}

function applyCorsHeaders(req: NextRequest, res: NextResponse) {
  if (!req.nextUrl.pathname.startsWith('/api/')) {
    return;
  }

  const allowedOrigins = parseAllowedOrigins(process.env.CORS_ORIGINS || '');

  if (allowedOrigins.length === 0) {
    return;
  }

  const origin = req.headers.get('origin') || '';
  if (allowedOrigins.includes(origin)) {
    res.headers.set('Access-Control-Allow-Origin', origin);
    res.headers.set('Vary', 'Origin');
    res.headers.set('Access-Control-Allow-Credentials', 'true');
    res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    if (process.env.CORS_ALLOW_PRIVATE_NETWORK === 'true') {
      res.headers.set('Access-Control-Allow-Private-Network', 'true');
    }
  }
}

function buildProtectedPath(pathname: string) {
  return (
    pathname === '/' ||
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/tasks') ||
    pathname.startsWith('/activity') ||
    pathname.startsWith('/transactions') ||
    pathname.startsWith('/notifications') ||
    pathname.startsWith('/insights') ||
    pathname.startsWith('/users') ||
    pathname.startsWith('/org') ||
    pathname.startsWith('/reminders') ||
    pathname.startsWith('/personal') ||
    pathname.startsWith('/config')
  );
}

export async function middleware(req: NextRequest) {
  const startedAt = Date.now();
  const { pathname } = req.nextUrl;
  const requestId = req.headers.get('x-request-id') || crypto.randomUUID();

  if (req.method === 'OPTIONS' && pathname.startsWith('/api/')) {
    const preflight = new NextResponse(null, { status: 204 });
    applyCorsHeaders(req, preflight);
    return preflight;
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  const isLoggedIn = !!token;
  const publicRoutes = ['/login', '/api/auth'];
  const isPublicRoute = publicRoutes.some((route) => pathname.startsWith(route));

  const requestHeaders = new Headers(req.headers);
  if (token?.id) {
    requestHeaders.set('x-user-id', String(token.id));
  }
  requestHeaders.set('x-request-id', requestId);

  let response: NextResponse;

  if (isPublicRoute) {
    if (isLoggedIn && pathname.startsWith('/login')) {
      response = NextResponse.redirect(new URL('/dashboard', req.nextUrl.origin));
    } else {
      response = NextResponse.next({ request: { headers: requestHeaders } });
    }
  } else if (buildProtectedPath(pathname)) {
    if (!isLoggedIn) {
      const loginUrl = new URL('/login', req.nextUrl.origin);
      // Only allow same-origin relative paths as callbackUrl (block // and protocol-relative)
      const rawCallback = `${pathname}${req.nextUrl.search || ''}`;
      const safeCallback = rawCallback.startsWith('/') && !rawCallback.startsWith('//')
        ? rawCallback
        : '/dashboard';
      loginUrl.searchParams.set('callbackUrl', safeCallback);
      response = NextResponse.redirect(loginUrl);
    } else {
      response = NextResponse.next({ request: { headers: requestHeaders } });
    }
  } else {
    response = NextResponse.next({ request: { headers: requestHeaders } });
  }

  applyCorsHeaders(req, response);

  const duration = Date.now() - startedAt;
  response.headers.set('x-request-duration-ms', String(duration));
  response.headers.set('x-request-id', requestId);

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|public).*)'],
};
