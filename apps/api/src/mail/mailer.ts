export interface Email {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(email: Email): Promise<void>;
}

export const MAILER = Symbol('MAILER');

/** Resend عبر HTTPS. لا يُسجّل محتوى الرسالة لأنه قد يحمل روابط تحقق. */
export class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(email: Email): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: this.from,
        to: [email.to],
        subject: email.subject,
        text: email.text,
      }),
    });
    if (!res.ok) throw new Error(`فشل إرسال البريد: HTTP ${res.status}`);
  }
}

/** للتطوير والاختبار: يحتفظ بالرسائل في الذاكرة ولا يرسل شيئًا */
export class MemoryMailer implements Mailer {
  readonly sent: Email[] = [];
  async send(email: Email): Promise<void> {
    this.sent.push(email);
  }
  lastTo(to: string): Email | undefined {
    return [...this.sent].reverse().find((e) => e.to === to);
  }
}

/** للتطوير المحلي فقط: يطبع الرسالة في الطرفية لتفتح رابط التحقق يدويًا. الإنتاج يرفض الإقلاع بدون Resend */
export class ConsoleMailer implements Mailer {
  async send(email: Email): Promise<void> {
    console.log(`[mail:dev] to=${email.to} subject=${email.subject}\n${email.text}\n`);
  }
}
