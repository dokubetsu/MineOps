/**
 * Shared trip / expense domain constants used by admin trips + my-work.
 */

export const VEHICLE_TYPES = ['12WH', '10WH', '6WH', 'Other'] as const
export type VehicleType = (typeof VEHICLE_TYPES)[number]

export const OWNERSHIP_TYPES = ['rented', 'leased', 'owned'] as const
export type OwnershipType = (typeof OWNERSHIP_TYPES)[number]

export const EXPENSE_CATEGORIES = [
  'Fuel/Diesel Purchase',
  'Driver Wage payment',
  'Supervisor payment',
  'Meal & Food expense',
  'Repair & Spares',
  'Other outgoing',
] as const

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]

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
