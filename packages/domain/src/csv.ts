/**
 * قارئ CSV صارم (RFC 4180) لملفات الاستيراد (الملحق ب): UTF-8، فاصلة، علامات اقتباس مزدوجة.
 * لا يخمّن الفاصل ولا الترميز؛ الملف الذي لا يطابق يُرفض بسبب واضح بدل قراءة خاطئة صامتة.
 */

export const CSV_LIMITS = { maxBytes: 20 * 1024 * 1024, maxRows: 100_000 } as const;

export class CsvError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message);
    this.name = 'CsvError';
  }
}

export interface CsvTable {
  readonly header: readonly string[];
  /** كل صف مع رقم سطره في الملف (1 = العنوان) لتقرير الصفوف المرفوضة */
  readonly rows: readonly { readonly line: number; readonly cells: readonly string[] }[];
}

export function parseCsv(input: string): CsvTable {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const records: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let fieldStarted = false;

  const endField = () => {
    cells.push(field);
    field = '';
    fieldStarted = false;
  };
  const endRecord = () => {
    endField();
    // السطر الفارغ تمامًا لا يُعد صفًا
    if (!(cells.length === 1 && cells[0] === '')) records.push({ line: recordLine, cells });
    cells = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      if (fieldStarted || field !== '') {
        throw new CsvError('علامة اقتباس في منتصف حقل', line);
      }
      inQuotes = true;
      fieldStarted = true;
    } else if (ch === ',') {
      endField();
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRecord();
      line++;
      recordLine = line;
    } else {
      if (fieldStarted && !inQuotes && text[i - 1] === '"') {
        throw new CsvError('نص بعد إغلاق علامة الاقتباس', line);
      }
      field += ch;
    }
    if (records.length > CSV_LIMITS.maxRows + 1) {
      throw new CsvError(`الملف يتجاوز ${CSV_LIMITS.maxRows} صف`, line);
    }
  }
  if (inQuotes) throw new CsvError('علامة اقتباس لم تُغلق', line);
  if (field !== '' || fieldStarted || cells.length > 0) endRecord();

  const [head, ...body] = records;
  if (!head) throw new CsvError('الملف فارغ', 1);
  const header = head.cells.map((h) => h.trim().toLowerCase());
  const seen = new Set<string>();
  for (const h of header) {
    if (seen.has(h)) throw new CsvError(`عمود مكرر: ${h}`, 1);
    seen.add(h);
  }
  return { header, rows: body };
}
