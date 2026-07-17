/**
 * Product feature catalog — org-level entitlements.
 * Keys must match organization_features.feature_key check constraint.
 *
 * Phase B: fail-closed — missing rows / load failure ⇒ feature OFF.
 */

export const FEATURE_KEYS = [
  'trips',
  'cash_book',
  'attendance',
  'leave',
  'payroll',
  'reports',
  'stakeholder',
  'users',
  'master_data',
  'manage_employees',
] as const

export type FeatureKey = (typeof FEATURE_KEYS)[number]

export interface FeatureDefinition {
  key: FeatureKey
  label: string
  description: string
}

export const FEATURE_CATALOG: FeatureDefinition[] = [
  { key: 'trips', label: 'Trips', description: 'Trip logging and vehicle movements' },
  { key: 'cash_book', label: 'Cash Book', description: 'Daily cash in/out and receipts' },
  { key: 'attendance', label: 'Attendance', description: 'Daily muster roll' },
  { key: 'leave', label: 'Leave', description: 'Leave applications and approvals' },
  { key: 'payroll', label: 'Payroll', description: 'Wage runs and finalization' },
  { key: 'reports', label: 'Reports', description: 'Operational and workforce reports' },
  { key: 'stakeholder', label: 'Stakeholder portal', description: 'Revenue share dashboard' },
  { key: 'users', label: 'User Access', description: 'Invite and manage tenant users' },
  { key: 'master_data', label: 'Master Data', description: 'Sites, vehicles, contractors, rates' },
  { key: 'manage_employees', label: 'Employees', description: 'Employee master and wages' },
]

export type FeatureMap = Record<FeatureKey, boolean>

/** Default map: all false when fail-closed; all true only for platform shell / seeds. */
export function defaultFeatureMap(enabled = false): FeatureMap {
  return FEATURE_KEYS.reduce((acc, key) => {
    acc[key] = enabled
    return acc
  }, {} as FeatureMap)
}

/**
 * Build map from DB rows.
 * Phase B fail-closed: start all OFF, then enable only explicit enabled=true rows.
 * Missing keys stay OFF.
 */
export function featuresFromRows(
  rows: Array<{ feature_key: string; enabled: boolean }> | null | undefined
): FeatureMap {
  const map = defaultFeatureMap(false)
  if (!rows || rows.length === 0) return map
  for (const row of rows) {
    if ((FEATURE_KEYS as readonly string[]).includes(row.feature_key)) {
      map[row.feature_key as FeatureKey] = row.enabled === true
    }
  }
  return map
}

/** True only when explicitly enabled. */
export function isFeatureEnabled(map: FeatureMap, key: FeatureKey): boolean {
  return map[key] === true
}

/** Map dashboard path prefix → required feature (if any). */
export function featureForPath(pathname: string): FeatureKey | null {
  if (pathname.startsWith('/dashboard/trips')) return 'trips'
  if (pathname.startsWith('/dashboard/cash-book')) return 'cash_book'
  if (pathname.startsWith('/dashboard/attendance')) return 'attendance'
  if (pathname.startsWith('/dashboard/leave')) return 'leave'
  if (pathname.startsWith('/dashboard/payroll')) return 'payroll'
  if (pathname.startsWith('/dashboard/reports')) return 'reports'
  if (pathname.startsWith('/dashboard/stakeholder')) return 'stakeholder'
  if (pathname.startsWith('/dashboard/users')) return 'users'
  if (pathname.startsWith('/dashboard/settings')) return 'master_data'
  if (pathname.startsWith('/dashboard/manage-employees')) return 'manage_employees'
  // my-work is a shell; section gating is client-side
  return null
}
