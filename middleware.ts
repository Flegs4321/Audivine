import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public routes that don't require authentication
  const publicRoutes = ['/login'];
  const isPublicRoute = publicRoutes.includes(pathname) || pathname.startsWith('/api');

  // Check for Supabase auth session cookie
  // Supabase stores auth tokens in cookies prefixed with 'sb-' and containing 'auth-token'
  const cookies = request.cookies.getAll();
  const hasAuthCookie = cookies.some(
    (cookie) => cookie.name.startsWith('sb-') && cookie.name.includes('auth-token')
  );

  // If it's a public route, allow access
  if (isPublicRoute) {
    return NextResponse.next();
  }

  // If no auth cookie found, redirect to login
  if (!hasAuthCookie) {
    const loginUrl = new URL('/login', request.url);
    // Add the original path as a redirect parameter so we can redirect back after login
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // User is authenticated, allow access
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder files
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};

