'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { api, ApiRequestError } from '@/lib/api';

function Accept() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<'idle' | 'busy' | 'invalid' | 'signin'>('idle');
  const here = `/invite/accept?token=${encodeURIComponent(token)}`;

  async function accept() {
    setState('busy');
    try {
      await api('/api/v1/invitations/accept', { body: { token } });
      router.push('/overview');
    } catch (e) {
      setState(e instanceof ApiRequestError && e.status === 401 ? 'signin' : 'invalid');
    }
  }

  return (
    <>
      <h1 className="auth-title">دعوة للانضمام إلى فريق</h1>
      {state === 'invalid' ? (
        <p className="alert alert-error" role="alert">
          الدعوة غير صالحة أو منتهية أو مرسلة لبريد آخر. اطلب من صاحب الدعوة إرسال دعوة جديدة.
        </p>
      ) : state === 'signin' ? (
        <p className="alert" role="status">
          سجّل الدخول بالبريد الذي وصلته الدعوة، ثم عد لهذه الصفحة.{' '}
          <Link href={`/sign-in?next=${encodeURIComponent(here)}`}>تسجيل الدخول</Link> ·{' '}
          <Link href="/sign-up">إنشاء حساب</Link>
        </p>
      ) : (
        <>
          <p className="auth-lead">ستنضم إلى الفريق بالدور والمتاجر التي حددها صاحب الدعوة.</p>
          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={accept}
            disabled={state === 'busy' || !token}
          >
            {state === 'busy' ? 'لحظة…' : 'قبول الدعوة'}
          </button>
        </>
      )}
    </>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense>
      <Accept />
    </Suspense>
  );
}
