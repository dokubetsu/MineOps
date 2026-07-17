import { Database } from './database.types'

export type Site = Database['public']['Tables']['sites']['Row']
export type TransportContractor = Database['public']['Tables']['transport_contractors']['Row']
export type Vehicle = Database['public']['Tables']['vehicles']['Row']
export type Driver = Database['public']['Tables']['drivers']['Row']
export type Employee = Database['public']['Tables']['employees']['Row']
export type Trip = Database['public']['Tables']['trips']['Row']
export type CashBook = Database['public']['Tables']['cash_books']['Row']
export type CashEntry = Database['public']['Tables']['cash_entries']['Row'] & { receipt_url?: string | null }
export type Attendance = Database['public']['Tables']['attendance']['Row']
export type PayrollRun = Database['public']['Tables']['payroll_runs']['Row']
export type PayrollLine = Database['public']['Tables']['payroll_lines']['Row']
export type UserRole = Database['public']['Tables']['user_roles']['Row']
export type StakeholderSiteAccess = Database['public']['Tables']['stakeholder_site_access']['Row']
export type Customer = Database['public']['Tables']['customers']['Row']
export type TripPhoto = Database['public']['Tables']['trip_photos']['Row']
