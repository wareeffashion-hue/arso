import { z } from 'zod';
import { ApiError } from './errors.js';

/** تحقق المدخلات: أي خطأ = 422 بالحقول المرفوضة فقط، بلا صدى للقيم */
export function parseBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body);
  if (!r.success) {
    throw new ApiError(422, 'VALIDATION_FAILED', 'بعض القيم غير صالحة', {
      fields: [...new Set(r.error.issues.map((i) => i.path.join('.') || '(body)'))],
    });
  }
  return r.data;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** معرّف غير صالح في المسار يُعامل كغير موجود (404)، لا كخطأ خادم */
export function parseId(value: string): string {
  if (!UUID.test(value)) throw new ApiError(404, 'NOT_FOUND', 'العنصر غير موجود');
  return value.toLowerCase();
}
