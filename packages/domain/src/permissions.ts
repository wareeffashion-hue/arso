/**
 * الصلاحيات الدقيقة (القسم 9). الصلاحية الفعلية لعضو على متجر =
 * صلاحيات دوره الافتراضية ∪ صلاحيات منحته، وبشرط وجود منحة سارية لذلك المتجر.
 * المالك وحده يملك كل متاجر مؤسسته بلا منحة. امتلاك مساحة وكالة لا يعني قراءة كل المتاجر.
 */

export const PERMISSIONS = [
  'metrics.read',
  'finance.read_summary',
  'costs.read',
  'costs.write',
  'pii.read',
  'creative.write',
  'experiments.write',
  'connections.manage',
  'campaigns.read',
  'actions.prepare',
  'actions.approve',
  'rules.manage',
  'members.manage',
  'exports.create',
  'services.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = [
  'owner',
  'marketing_manager',
  'analyst',
  'finance',
  'creative',
  'operations',
  'agency',
] as const;
export type Role = (typeof ROLES)[number];

/**
 * الافتراضيات حسب جدول القسم 9. ما يقول عنه الجدول «بمنحة» لا يدخل هنا، بل يُمنح صراحة.
 * `actions.approve` لا يكون افتراضيًا لأي دور غير المالك، ويحتاج MFA حديثًا (E2).
 */
const ROLE_DEFAULTS: Readonly<Record<Role, readonly Permission[]>> = {
  owner: PERMISSIONS,
  marketing_manager: [
    'metrics.read',
    'campaigns.read',
    'creative.write',
    'experiments.write',
    'actions.prepare',
    'exports.create',
  ],
  analyst: ['metrics.read', 'campaigns.read', 'experiments.write'],
  finance: ['metrics.read', 'finance.read_summary', 'costs.read', 'costs.write', 'exports.create'],
  creative: ['creative.write'],
  operations: ['metrics.read'],
  agency: [],
};

/** صلاحيات لا تُمنح لغير المالك حتى بمنحة صريحة في هذه المرحلة */
const OWNER_ONLY: ReadonlySet<Permission> = new Set(['members.manage', 'connections.manage']);

export interface MembershipContext {
  readonly role: Role;
  readonly status: 'invited' | 'active' | 'revoked';
}

export interface StoreGrant {
  readonly storeId: string;
  readonly permissions: readonly string[];
  readonly expiresAt: Date | null;
  readonly revokedAt: Date | null;
}

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

function grantIsActive(grant: StoreGrant, now: Date): boolean {
  if (grant.revokedAt && grant.revokedAt <= now) return false;
  if (grant.expiresAt && grant.expiresAt <= now) return false;
  return true;
}

/** الصلاحيات الفعلية لعضو على متجر محدد. مجموعة فارغة = لا وصول */
export function effectivePermissions(
  membership: MembershipContext,
  storeId: string,
  grants: readonly StoreGrant[],
  now: Date = new Date(),
): ReadonlySet<Permission> {
  if (membership.status !== 'active') return new Set();
  if (membership.role === 'owner') return new Set(PERMISSIONS);

  const grant = grants.find((g) => g.storeId === storeId && grantIsActive(g, now));
  if (!grant) return new Set();

  const result = new Set<Permission>(ROLE_DEFAULTS[membership.role]);
  for (const p of grant.permissions) {
    if (isPermission(p) && !OWNER_ONLY.has(p)) result.add(p);
  }
  return result;
}

/** صلاحيات على مستوى المؤسسة (إدارة الفريق والربط): المالك فقط في هذه المرحلة */
export function organizationPermissions(membership: MembershipContext): ReadonlySet<Permission> {
  if (membership.status !== 'active') return new Set();
  return membership.role === 'owner' ? new Set(PERMISSIONS) : new Set();
}

export function roleDefaults(role: Role): readonly Permission[] {
  return ROLE_DEFAULTS[role];
}
