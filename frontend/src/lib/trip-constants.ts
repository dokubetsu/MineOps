/**
 * Shared trip / expense domain constants used by admin trips + my-work.
 */

export const VEHICLE_TYPES = ['12WH', '10WH', '6WH', 'Other'] as const
export type VehicleType = (typeof VEHICLE_TYPES)[number]

export const OWNERSHIP_TYPES = ['rented', 'leased', 'owned'] as const
export type OwnershipType = (typeof OWNERSHIP_TYPES)[number]

/**
 * Site expense categories (cash book OUT).
 * Trip Expense (Fastag) and Fuel/Diesel require transport contractor.
 */
export const EXPENSE_CATEGORIES = [
  'Meal Expense',
  'Trip Expense (Fastag payment)',
  'Fuel / Diesel expense',
  'Advance salary',
  'Advance for trip',
] as const

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]

/** Categories that require an optional/required transport contractor field */
export const EXPENSE_CATEGORIES_WITH_CONTRACTOR: readonly string[] = [
  'Trip Expense (Fastag payment)',
  'Fuel / Diesel expense',
]

export function expenseRequiresContractor(category: string): boolean {
  return EXPENSE_CATEGORIES_WITH_CONTRACTOR.includes(category)
}

/** Cash book admin UI — outgoing types (align with field expense list + legacy) */
export const CASH_ENTRY_CATEGORIES_OUT = [
  ...EXPENSE_CATEGORIES,
  'Repair & Spares',
  'Other outgoing',
] as const

export const CASH_ENTRY_CATEGORIES_IN = [
  'Cash received from main office',
  'Other incoming',
] as const

/** Default cubic capacity for a vehicle type (matches master-data defaults). */
export function getCapacityForType(type: string): string {
  switch (type) {
    case '12WH':
      return '20'
    case '10WH':
      return '16'
    case '6WH':
      return '10'
    default:
      return '8'
  }
}

export function vehicleTypeLabel(type: string): string {
  switch (type) {
    case '12WH':
      return '12 Wheeler (12WH)'
    case '10WH':
      return '10 Wheeler (10WH)'
    case '6WH':
      return '6 Wheeler (6WH)'
    default:
      return type || 'Other'
  }
}
