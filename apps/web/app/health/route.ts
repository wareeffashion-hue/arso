/** فحص صحة الواجهة لـ Railway: حية فقط، ولا تلمس الخادم أو القاعدة */
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ status: 'ok' });
}
