'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { AuthForm, Field } from '@/components/AuthForm';
import { api, authErrorMessage, safeNext } from '@/lib/api';

function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  return (
    <AuthForm
      title="تسجيل الدخول"
      submitLabel="دخول"
      onSubmit={async (d) => {
        try {
          await api('/api/auth/sign-in/email', {
            body: {
              email: String(d.get('email') ?? '').trim(),
              password: String(d.get('password') ?? ''),
            },
          });
        } catch (e) {
          throw new Error(authErrorMessage(e));
        }
        router.push(next);
      }}
      footer={
        <>
          جديد في أرسو؟ <Link href={`/sign-up`}>أنشئ حسابًا</Link>
        </>
      }
    >
      <Field label="البريد الإلكتروني" name="email" type="email" autoComplete="email" dir="ltr" />
      <Field
        label="كلمة المرور"
        name="password"
        type="password"
        autoComplete="current-password"
        dir="ltr"
      />
    </AuthForm>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
