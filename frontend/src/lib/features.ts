/**
 * Product feature catalog — org-level entitlements.
 * Keys must match organization_features.feature_key check constraint.
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

export function defaultFeatureMap(enabled = true): FeatureMap {
  return FEATURE_KEYS.reduce((acc, key) => {
    acc[key] = enabled
    return acc
  }, {} as FeatureMap)
}

export function featuresFromRows(
  rows: Array<{ feature_key: string; enabled: boolean }> | null | undefined
): FeatureMap {
  const map = defaultFeatureMap(true)
  if (!rows) return map
  for (const row of rows) {
    if ((FEATURE_KEYS as readonly string[]).includes(row.feature_key)) {
      map[row.feature_key as FeatureKey] = !!row.enabled
    }
  }
  return map
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
  return null
}
