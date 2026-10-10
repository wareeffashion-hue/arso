'use client';

import Link from 'next/link';
import { AuthForm, Field } from '@/components/AuthForm';
import { api, authErrorMessage } from '@/lib/api';

export default function SignUpPage() {
  return (
    <AuthForm
      title="أنشئ حسابك"
      lead="ابدأ بتشخيص متجرك. لا نحتاج بطاقة ائتمان."
      submitLabel="إنشاء الحساب"
      onSubmit={async (d) => {
        try {
          await api('/api/auth/sign-up/email', {
            body: {
              name: String(d.get('name') ?? '').trim(),
              email: String(d.get('email') ?? '').trim(),
              password: String(d.get('password') ?? ''),
              callbackURL: '/onboarding',
            },
          });
        } catch (e) {
          throw new Error(authErrorMessage(e));
        }
        return 'أرسلنا رابط التأكيد إلى بريدك. افتحه لتكمل إعداد حسابك.';
      }}
      footer={
        <>
          <p className="auth-consent">
            بإنشاء الحساب توافق على <Link href="/terms">شروط الاستخدام</Link> و
            <Link href="/privacy">سياسة الخصوصية</Link>.
          </p>
          لديك حساب؟ <Link href="/sign-in">سجّل الدخول</Link>
        </>
      }
    >
      <Field label="الاسم" name="name" autoComplete="name" />
      <Field label="البريد الإلكتروني" name="email" type="email" autoComplete="email" dir="ltr" />
      <Field
        label="كلمة المرور"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={10}
        hint="10 أحرف على الأقل"
        dir="ltr"
      />
    </AuthForm>
  );
}
