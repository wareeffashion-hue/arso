import { PERMISSIONS, ROLES } from '@arso/domain';
import { describe, expect, it } from 'vitest';
import { formatDateTime, PERMISSION_LABELS, ROLE_LABELS, roleLabel } from '../lib/labels';

describe('أسماء الأدوار والصلاحيات', () => {
  it('لكل دور ولكل صلاحية اسم عربي', () => {
    for (const r of ROLES) expect(ROLE_LABELS[r]).toMatch(/\p{Script=Arabic}/u);
    for (const p of PERMISSIONS) expect(PERMISSION_LABELS[p]).toMatch(/\p{Script=Arabic}/u);
  });

  it('دور غير معروف يظهر كما هو بدل الفراغ', () => {
    expect(roleLabel('analyst')).toBe('محلل');
    expect(roleLabel('mystery')).toBe('mystery');
  });

  it('التاريخ بأرقام غربية وبتوقيت الرياض', () => {
    const s = formatDateTime('2026-10-10T21:30:00Z');
    expect(s).toMatch(/2026/);
    expect(s).toMatch(/12:30/);
    expect(s).not.toMatch(/[٠-٩]/);
  });
});
