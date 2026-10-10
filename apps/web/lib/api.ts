/**
 * طلبات الواجهة إلى الخادم. كل شيء من نفس الأصل (/api/*) عبر وكيل Next،
 * فكوكي الجلسة first-party وHttpOnly، ولا توكنات في JavaScript.
 */
export interface ApiErrorBody {
  error?: { code?: string; message?: string };
  code?: string;
  message?: string;
}

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: 'same-origin',
  });
  const text = await res.text();
  const data = (text ? JSON.parse(text) : {}) as T & ApiErrorBody;
  if (!res.ok) {
    const code = data.error?.code ?? data.code ?? 'ERROR';
    throw new ApiRequestError(res.status, code, data.error?.message ?? 'تعذّر إتمام الطلب');
  }
  return data;
}

/** رسائل Better Auth بالعربية حسب الحالة، بدل عرض نصه الإنجليزي */
export function authErrorMessage(e: unknown): string {
  if (!(e instanceof ApiRequestError)) return 'تعذّر الاتصال. تحقق من الشبكة وأعد المحاولة';
  if (e.status === 403) return 'أكّد بريدك الإلكتروني أولًا. أرسلنا لك رابط التأكيد';
  if (e.status === 401) return 'البريد أو كلمة المرور غير صحيحة';
  if (e.status === 429) return 'محاولات كثيرة. انتظر قليلًا ثم أعد المحاولة';
  if (e.code === 'USER_ALREADY_EXISTS' || e.code?.includes('EXIST'))
    return 'هذا البريد مسجّل. سجّل الدخول بدلًا من ذلك';
  if (e.code === 'PASSWORD_TOO_SHORT') return 'كلمة المرور قصيرة: 10 أحرف على الأقل';
  return e.message;
}

/** مسار داخلي آمن لإعادة التوجيه بعد الدخول (يمنع إعادة التوجيه لموقع خارجي) */
export function safeNext(next: string | null | undefined, fallback = '/overview'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\'))
    return fallback;
  return next;
}
