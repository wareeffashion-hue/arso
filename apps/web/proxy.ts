import { NextResponse, type NextRequest } from 'next/server';

/**
 * توجيه سريع لمن لا يملك كوكي جلسة إلى صفحة الدخول. هذا لتجربة الاستخدام فقط:
 * التحقق الحقيقي من الجلسة والصلاحية يحدث في الخادم مع كل طلب بيانات.
 */
const SESSION_COOKIES = ['arso.session_token', '__Secure-arso.session_token'];

export function proxy(req: NextRequest) {
  const hasSession = SESSION_COOKIES.some((c) => req.cookies.has(c));
  if (hasSession) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = '/sign-in';
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    '/overview/:path*',
    '/data-health/:path*',
    '/imports/:path*',
    '/opportunities/:path*',
    '/tasks/:path*',
    '/settings/:path*',
    '/onboarding',
  ],
};
