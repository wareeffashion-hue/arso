'use client';

import { useRouter } from 'next/navigation';
import { AuthForm, Field } from '@/components/AuthForm';
import { api, ApiRequestError } from '@/lib/api';

export default function OnboardingPage() {
  const router = useRouter();
  return (
    <AuthForm
      title="لنجهز مؤسستك"
      lead="المؤسسة تجمع متاجرك وفريقك واشتراكك. يمكنك إضافة المتاجر بعد ذلك."
      submitLabel="متابعة"
      onSubmit={async (d) => {
        try {
          await api('/api/v1/organizations', {
            body: { name: String(d.get('name') ?? '').trim() },
          });
        } catch (e) {
          if (e instanceof ApiRequestError && e.status === 401) {
            router.push('/sign-in?next=/onboarding');
            return;
          }
          throw new Error(
            e instanceof ApiRequestError && e.status === 422
              ? 'الاسم بين حرفين و100 حرف'
              : 'تعذّر إنشاء المؤسسة',
          );
        }
        router.push('/overview');
      }}
    >
      <Field label="اسم المؤسسة أو النشاط" name="name" autoComplete="organization" minLength={2} />
    </AuthForm>
  );
}
