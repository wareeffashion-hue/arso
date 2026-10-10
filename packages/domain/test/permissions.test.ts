import { describe, expect, it } from 'vitest';
import {
  effectivePermissions,
  organizationPermissions,
  PERMISSIONS,
  type StoreGrant,
} from '../src/index.js';

const now = new Date('2026-10-10T12:00:00Z');
const grant = (over: Partial<StoreGrant> = {}): StoreGrant => ({
  storeId: 'store-1',
  permissions: [],
  expiresAt: null,
  revokedAt: null,
  ...over,
});

describe('الصلاحيات (القسم 9)', () => {
  it('المالك يملك كل الصلاحيات على كل متاجر مؤسسته', () => {
    const p = effectivePermissions({ role: 'owner', status: 'active' }, 'any', [], now);
    expect(p.size).toBe(PERMISSIONS.length);
  });

  it('غير المالك بلا منحة للمتجر لا يملك شيئًا', () => {
    const p = effectivePermissions(
      { role: 'marketing_manager', status: 'active' },
      'store-2',
      [grant()],
      now,
    );
    expect(p.size).toBe(0);
  });

  it('الوكالة بلا صلاحيات صريحة لا تقرأ حتى المقاييس', () => {
    const p = effectivePermissions({ role: 'agency', status: 'active' }, 'store-1', [grant()], now);
    expect(p.size).toBe(0);
  });

  it('AC02: المنتج الإبداعي لا يملك المالية ولا التكاليف افتراضيًا', () => {
    const p = effectivePermissions(
      { role: 'creative', status: 'active' },
      'store-1',
      [grant()],
      now,
    );
    expect(p.has('creative.write')).toBe(true);
    expect(p.has('costs.read')).toBe(false);
    expect(p.has('finance.read_summary')).toBe(false);
    expect(p.has('metrics.read')).toBe(false);
  });

  it('مدير التسويق لا يرى التكلفة التفصيلية تلقائيًا، لكن يمكن منحه ملخص المساهمة', () => {
    const base = effectivePermissions(
      { role: 'marketing_manager', status: 'active' },
      'store-1',
      [grant()],
      now,
    );
    expect(base.has('costs.read')).toBe(false);
    expect(base.has('finance.read_summary')).toBe(false);
    const granted = effectivePermissions(
      { role: 'marketing_manager', status: 'active' },
      'store-1',
      [grant({ permissions: ['finance.read_summary'] })],
      now,
    );
    expect(granted.has('finance.read_summary')).toBe(true);
  });

  it('لا تُمنح صلاحيات المالك لغيره حتى بمنحة صريحة', () => {
    const p = effectivePermissions(
      { role: 'analyst', status: 'active' },
      'store-1',
      [grant({ permissions: ['members.manage', 'connections.manage'] })],
      now,
    );
    expect(p.has('members.manage')).toBe(false);
    expect(p.has('connections.manage')).toBe(false);
  });

  it('المنحة المسحوبة أو المنتهية لا تعطي وصولًا (السحب فوري)', () => {
    const revoked = grant({ revokedAt: new Date('2026-10-10T11:59:59Z') });
    const expired = grant({ expiresAt: new Date('2026-10-01T00:00:00Z') });
    for (const g of [revoked, expired]) {
      expect(
        effectivePermissions({ role: 'finance', status: 'active' }, 'store-1', [g], now).size,
      ).toBe(0);
    }
  });

  it('العضوية المسحوبة أو المدعوة لا تملك شيئًا', () => {
    for (const status of ['revoked', 'invited'] as const) {
      expect(effectivePermissions({ role: 'owner', status }, 'store-1', [], now).size).toBe(0);
      expect(organizationPermissions({ role: 'owner', status }).size).toBe(0);
    }
  });

  it('صلاحية غير معروفة في المنحة تُتجاهل', () => {
    const p = effectivePermissions(
      { role: 'operations', status: 'active' },
      'store-1',
      [grant({ permissions: ['god.mode'] })],
      now,
    );
    expect([...p]).toEqual(['metrics.read']);
  });
});
