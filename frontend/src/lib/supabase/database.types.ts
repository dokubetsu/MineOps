export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      sites: {
        Row: {
          id: string
          name: string
          location: string
          active: boolean
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          name: string
          location: string
          active?: boolean
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          location?: string
          active?: boolean
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      transport_contractors: {
        Row: {
          id: string
          name: string
          active: boolean
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          name: string
          active?: boolean
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          active?: boolean
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      vehicles: {
        Row: {
          id: string
          plate_number: string
          vehicle_type: '12WH' | '10WH' | '6WH' | 'Other'
          ownership: 'rented' | 'owned'
          default_contractor_id: string | null
          active: boolean
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          plate_number: string
          vehicle_type: '12WH' | '10WH' | '6WH' | 'Other'
          ownership: 'rented' | 'owned'
          default_contractor_id?: string | null
          active?: boolean
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          plate_number?: string
          vehicle_type?: '12WH' | '10WH' | '6WH' | 'Other'
          ownership?: 'rented' | 'owned'
          default_contractor_id?: string | null
          active?: boolean
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_default_contractor_id_fkey"
            columns: ["default_contractor_id"]
            isOneToOne: false
            referencedRelation: "transport_contractors"
            referencedColumns: ["id"]
          }
        ]
      }
      drivers: {
        Row: {
          id: string
          name: string
          license_number: string | null
          phone: string | null
          active: boolean
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          name: string
          license_number?: string | null
          phone?: string | null
          active?: boolean
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          license_number?: string | null
          phone?: string | null
          active?: boolean
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      employees: {
        Row: {
          id: string
          name: string
          role: string
          phone: string | null
          wage_type: 'daily' | 'monthly'
          wage_rate: number
          site_id: string | null
          active: boolean
          join_date: string | null
          created_at: string | null
          updated_at: string | null
          leave_balance: number
        }
        Insert: {
          id?: string
          name: string
          role: string
          phone?: string | null
          wage_type: 'daily' | 'monthly'
          wage_rate: number
          site_id?: string | null
          active?: boolean
          join_date?: string | null
          created_at?: string | null
          updated_at?: string | null
          leave_balance?: number
        }
        Update: {
          id?: string
          name?: string
          role?: string
          phone?: string | null
          wage_type?: 'daily' | 'monthly'
          wage_rate?: number
          site_id?: string | null
          active?: boolean
          join_date?: string | null
          created_at?: string | null
          updated_at?: string | null
          leave_balance?: number
        }
        Relationships: [
          {
            foreignKeyName: "employees_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          }
        ]
      }
      trips: {
        Row: {
          id: string
          site_id: string
          vehicle_id: string | null
          driver_id: string | null
          contractor_id: string | null
          trip_date: string
          entry_time: string | null
          load_info: string | null
          dd_number: string | null
          permit_number: string | null
          photo_url: string | null
          ownership_snapshot: string | null
          notes: string | null
          created_by: string | null
          created_at: string | null
          updated_at: string | null
          active: boolean
          settled: boolean
          settlement_amount: number
          settlement_account: string | null
        }
        Insert: {
          id?: string
          site_id: string
          vehicle_id?: string | null
          driver_id?: string | null
          contractor_id?: string | null
          trip_date: string
          entry_time?: string | null
          load_info?: string | null
          dd_number?: string | null
          permit_number?: string | null
          photo_url?: string | null
          ownership_snapshot?: string | null
          notes?: string | null
          created_by?: string | null
          created_at?: string | null
          updated_at?: string | null
          active?: boolean
          settled?: boolean
          settlement_amount?: number
          settlement_account?: string | null
        }
        Update: {
          id?: string
          site_id?: string
          vehicle_id?: string | null
          driver_id?: string | null
          contractor_id?: string | null
          trip_date?: string
          entry_time?: string | null
          load_info?: string | null
          dd_number?: string | null
          permit_number?: string | null
          photo_url?: string | null
          ownership_snapshot?: string | null
          notes?: string | null
          created_by?: string | null
          created_at?: string | null
          updated_at?: string | null
          active?: boolean
          settled?: boolean
          settlement_amount?: number
          settlement_account?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trips_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "transport_contractors"
            referencedColumns: ["id"]
          }
        ]
      }
      cash_books: {
        Row: {
          id: string
          site_id: string
          book_date: string
          opening_balance: number
          closing_balance: number
          status: 'draft' | 'locked'
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          site_id: string
          book_date: string
          opening_balance?: number
          closing_balance?: number
          status?: 'draft' | 'locked'
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          site_id?: string
          book_date?: string
          opening_balance?: number
          closing_balance?: number
          status?: 'draft' | 'locked'
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_books_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          }
        ]
      }
      cash_entries: {
        Row: {
          id: string
          cash_book_id: string
          entry_type: 'in' | 'out'
          category: string
          amount: number
          note: string | null
          created_by: string | null
          created_at: string | null
          updated_at: string | null
          active: boolean
          receipt_url: string | null
        }
        Insert: {
          id?: string
          cash_book_id: string
          entry_type: 'in' | 'out'
          category: string
          amount: number
          note?: string | null
          created_by?: string | null
          created_at?: string | null
          updated_at?: string | null
          active?: boolean
          receipt_url?: string | null
        }
        Update: {
          id?: string
          cash_book_id?: string
          entry_type?: 'in' | 'out'
          category?: string
          amount?: number
          note?: string | null
          created_by?: string | null
          created_at?: string | null
          updated_at?: string | null
          active?: boolean
          receipt_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_entries_cash_book_id_fkey"
            columns: ["cash_book_id"]
            isOneToOne: false
            referencedRelation: "cash_books"
            referencedColumns: ["id"]
          }
        ]
      }
      attendance: {
        Row: {
          id: string
          employee_id: string
          att_date: string
          status: 'present' | 'absent' | 'half-day' | 'leave'
          marked_by: string | null
          created_at: string | null
          updated_at: string | null
          photo_url: string | null
        }
        Insert: {
          id?: string
          employee_id: string
          att_date: string
          status: 'present' | 'absent' | 'half-day' | 'leave'
          marked_by?: string | null
          created_at?: string | null
          updated_at?: string | null
          photo_url?: string | null
        }
        Update: {
          id?: string
          employee_id?: string
          att_date?: string
          status?: 'present' | 'absent' | 'half-day' | 'leave'
          marked_by?: string | null
          created_at?: string | null
          updated_at?: string | null
          photo_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          }
        ]
      }
      leave_applications: {
        Row: {
          id: string
          employee_id: string
          from_date: string
          to_date: string
          reason: string | null
          status: 'pending' | 'approved' | 'rejected'
          approved_by: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          employee_id: string
          from_date: string
          to_date: string
          reason?: string | null
          status?: 'pending' | 'approved' | 'rejected'
          approved_by?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          employee_id?: string
          from_date?: string
          to_date?: string
          reason?: string | null
          status?: 'pending' | 'approved' | 'rejected'
          approved_by?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leave_applications_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          }
        ]
      }
      payroll_runs: {
        Row: {
          id: string
          site_id: string
          period_month: string
          status: 'draft' | 'finalized'
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          site_id: string
          period_month: string
          status?: 'draft' | 'finalized'
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          site_id?: string
          period_month?: string
          status?: 'draft' | 'finalized'
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_runs_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          }
        ]
      }
      payroll_lines: {
        Row: {
          id: string
          payroll_run_id: string
          employee_id: string
          days_present: number
          days_leave: number
          days_absent: number
          base_rate: number
          computed_amount: number
          adjustment: number
          final_amount: number
          notes: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          payroll_run_id: string
          employee_id: string
          days_present?: number
          days_leave?: number
          days_absent?: number
          base_rate: number
          computed_amount: number
          adjustment?: number
          final_amount: number
          notes?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          payroll_run_id?: string
          employee_id?: string
          days_present?: number
          days_leave?: number
          days_absent?: number
          base_rate?: number
          computed_amount?: number
          adjustment?: number
          final_amount?: number
          notes?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_lines_payroll_run_id_fkey"
            columns: ["payroll_run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_lines_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          }
        ]
      }
      user_roles: {
        Row: {
          id: string
          user_id: string
          role: 'admin' | 'site_manager' | 'stakeholder'
          site_id: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          role: 'admin' | 'site_manager' | 'stakeholder'
          site_id?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          role?: 'admin' | 'site_manager' | 'stakeholder'
          site_id?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          }
        ]
      }
      stakeholder_site_access: {
        Row: {
          id: string
          stakeholder_user_id: string
          site_id: string
          share_percent: number
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          stakeholder_user_id: string
          site_id: string
          share_percent?: number
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          stakeholder_user_id?: string
          site_id?: string
          share_percent?: number
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stakeholder_site_access_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          }
        ]
      }
    }
    Views: {
      stakeholder_daily_summary: {
        Row: {
          site_id: string | null
          book_date: string | null
          total_in: number | null
          total_out: number | null
          trip_count: number | null
        }
        Insert: {
          site_id?: string | null
          book_date?: string | null
          total_in?: number | null
          total_out?: number | null
          trip_count?: number | null
        }
        Update: {
          site_id?: string | null
          book_date?: string | null
          total_in?: number | null
          total_out?: number | null
          trip_count?: number | null
        }
        Relationships: []
      }
    }

    Functions: {
      approve_leave_application: {
        Args: {
          p_application_id: string
        }
        Returns: undefined
      }
      get_user_role: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      get_user_site_ids: {
        Args: Record<PropertyKey, never>
        Returns: string[]
      }
      regenerate_payroll_run: {
        Args: {
          p_run_id: string
        }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
