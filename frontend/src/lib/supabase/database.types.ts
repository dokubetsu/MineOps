export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      attendance: {
        Row: {
          att_date: string
          created_at: string | null
          employee_id: string
          id: string
          marked_by: string | null
          organization_id: string
          photo_url: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          att_date?: string
          created_at?: string | null
          employee_id: string
          id?: string
          marked_by?: string | null
          organization_id?: string
          photo_url?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          att_date?: string
          created_at?: string | null
          employee_id?: string
          id?: string
          marked_by?: string | null
          organization_id?: string
          photo_url?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string | null
          id: string
          metadata: Json | null
          organization_id: string
          target_id: string | null
          target_type: string
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string | null
          id?: string
          metadata?: Json | null
          organization_id: string
          target_id?: string | null
          target_type: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string | null
          id?: string
          metadata?: Json | null
          organization_id?: string
          target_id?: string | null
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_books: {
        Row: {
          book_date: string
          closing_balance: number | null
          created_at: string | null
          id: string
          opening_balance: number
          organization_id: string
          site_id: string
          status: string
          updated_at: string | null
        }
        Insert: {
          book_date?: string
          closing_balance?: number | null
          created_at?: string | null
          id?: string
          opening_balance?: number
          organization_id?: string
          site_id: string
          status?: string
          updated_at?: string | null
        }
        Update: {
          book_date?: string
          closing_balance?: number | null
          created_at?: string | null
          id?: string
          opening_balance?: number
          organization_id?: string
          site_id?: string
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_books_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_books_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_entries: {
        Row: {
          active: boolean
          amount: number
          cash_book_id: string
          category: string
          client_id: string | null
          contractor_id: string | null
          created_at: string | null
          created_by: string | null
          entry_type: string
          id: string
          note: string | null
          organization_id: string
          receipt_url: string | null
          updated_at: string | null
        }
        Insert: {
          active?: boolean
          amount?: number
          cash_book_id: string
          category: string
          client_id?: string | null
          contractor_id?: string | null
          created_at?: string | null
          created_by?: string | null
          entry_type: string
          id?: string
          note?: string | null
          organization_id?: string
          receipt_url?: string | null
          updated_at?: string | null
        }
        Update: {
          active?: boolean
          amount?: number
          cash_book_id?: string
          category?: string
          client_id?: string | null
          contractor_id?: string | null
          created_at?: string | null
          created_by?: string | null
          entry_type?: string
          id?: string
          note?: string | null
          organization_id?: string
          receipt_url?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_entries_cash_book_id_fkey"
            columns: ["cash_book_id"]
            isOneToOne: false
            referencedRelation: "cash_books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_entries_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "transport_contractors"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          active: boolean
          contact: string | null
          created_at: string | null
          default_trip_rate: number | null
          id: string
          name: string
          notes: string | null
          organization_id: string
          rates_effective_from: string | null
          rates_effective_to: string | null
          site_id: string | null
          trip_rates: Record<string, number> | null
        }
        Insert: {
          active?: boolean
          contact?: string | null
          created_at?: string | null
          default_trip_rate?: number | null
          id?: string
          name: string
          notes?: string | null
          organization_id: string
          rates_effective_from?: string | null
          rates_effective_to?: string | null
          site_id?: string | null
          trip_rates?: Record<string, number> | null
        }
        Update: {
          active?: boolean
          contact?: string | null
          created_at?: string | null
          default_trip_rate?: number | null
          id?: string
          name?: string
          notes?: string | null
          organization_id?: string
          rates_effective_from?: string | null
          rates_effective_to?: string | null
          site_id?: string | null
          trip_rates?: Record<string, number> | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      drivers: {
        Row: {
          active: boolean | null
          created_at: string | null
          id: string
          license_number: string | null
          name: string
          organization_id: string
          phone: string | null
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          created_at?: string | null
          id?: string
          license_number?: string | null
          name: string
          organization_id: string
          phone?: string | null
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          created_at?: string | null
          id?: string
          license_number?: string | null
          name?: string
          organization_id?: string
          phone?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "drivers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          active: boolean | null
          created_at: string | null
          id: string
          join_date: string | null
          leave_balance: number
          name: string
          organization_id: string
          phone: string | null
          role: string
          site_id: string | null
          updated_at: string | null
          user_id: string | null
          wage_rate: number
          wage_type: string
        }
        Insert: {
          active?: boolean | null
          created_at?: string | null
          id?: string
          join_date?: string | null
          leave_balance?: number
          name: string
          organization_id?: string
          phone?: string | null
          role?: string
          site_id?: string | null
          updated_at?: string | null
          user_id?: string | null
          wage_rate?: number
          wage_type?: string
        }
        Update: {
          active?: boolean | null
          created_at?: string | null
          id?: string
          join_date?: string | null
          leave_balance?: number
          name?: string
          organization_id?: string
          phone?: string | null
          role?: string
          site_id?: string | null
          updated_at?: string | null
          user_id?: string | null
          wage_rate?: number
          wage_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "employees_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_applications: {
        Row: {
          approved_by: string | null
          attendance_snapshot: Record<string, string> | null
          created_at: string | null
          employee_id: string
          from_date: string
          id: string
          organization_id: string
          reason: string | null
          status: string
          to_date: string
          updated_at: string | null
        }
        Insert: {
          approved_by?: string | null
          attendance_snapshot?: Record<string, string> | null
          created_at?: string | null
          employee_id: string
          from_date: string
          id?: string
          organization_id?: string
          reason?: string | null
          status?: string
          to_date: string
          updated_at?: string | null
        }
        Update: {
          approved_by?: string | null
          attendance_snapshot?: Record<string, string> | null
          created_at?: string | null
          employee_id?: string
          from_date?: string
          id?: string
          organization_id?: string
          reason?: string | null
          status?: string
          to_date?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leave_applications_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_applications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      negotiated_rates: {
        Row: {
          created_at: string | null
          effective_from: string
          effective_to: string | null
          id: string
          organization_id: string
          rate_per_cubic: number
          rate_per_km: number | null
          vehicle_type: string
        }
        Insert: {
          created_at?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          organization_id: string
          rate_per_cubic?: number
          rate_per_km?: number | null
          vehicle_type: string
        }
        Update: {
          created_at?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          organization_id?: string
          rate_per_cubic?: number
          rate_per_km?: number | null
          vehicle_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "negotiated_rates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_features: {
        Row: {
          enabled: boolean
          feature_key: string
          id: string
          organization_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          enabled?: boolean
          feature_key: string
          id?: string
          organization_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          enabled?: boolean
          feature_key?: string
          id?: string
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_features_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          active: boolean
          billing_admin_only: boolean
          created_at: string | null
          id: string
          name: string
          quantity_unit: string
          settlement_admin_only: boolean
          units_per_m3: number
          updated_at: string | null
        }
        Insert: {
          active?: boolean
          billing_admin_only?: boolean
          created_at?: string | null
          id?: string
          name: string
          quantity_unit?: string
          settlement_admin_only?: boolean
          units_per_m3?: number
          updated_at?: string | null
        }
        Update: {
          active?: boolean
          billing_admin_only?: boolean
          created_at?: string | null
          id?: string
          name?: string
          quantity_unit?: string
          settlement_admin_only?: boolean
          units_per_m3?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      platform_roles: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      payroll_lines: {
        Row: {
          adjustment: number | null
          base_rate: number | null
          computed_amount: number | null
          days_absent: number | null
          days_half_day: number
          days_leave: number | null
          days_present: number | null
          employee_id: string
          final_amount: number | null
          id: string
          notes: string | null
          organization_id: string
          payroll_run_id: string
          updated_at: string | null
        }
        Insert: {
          adjustment?: number | null
          base_rate?: number | null
          computed_amount?: number | null
          days_absent?: number | null
          days_half_day?: number
          days_leave?: number | null
          days_present?: number | null
          employee_id: string
          final_amount?: number | null
          id?: string
          notes?: string | null
          organization_id?: string
          payroll_run_id: string
          updated_at?: string | null
        }
        Update: {
          adjustment?: number | null
          base_rate?: number | null
          computed_amount?: number | null
          days_absent?: number | null
          days_half_day?: number
          days_leave?: number | null
          days_present?: number | null
          employee_id?: string
          final_amount?: number | null
          id?: string
          notes?: string | null
          organization_id?: string
          payroll_run_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_lines_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_lines_payroll_run_id_fkey"
            columns: ["payroll_run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_lines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_runs: {
        Row: {
          generated_at: string | null
          generated_by: string | null
          id: string
          organization_id: string
          period_month: string
          site_id: string
          status: string
          updated_at: string | null
        }
        Insert: {
          generated_at?: string | null
          generated_by?: string | null
          id?: string
          organization_id?: string
          period_month: string
          site_id: string
          status?: string
          updated_at?: string | null
        }
        Update: {
          generated_at?: string | null
          generated_by?: string | null
          id?: string
          organization_id?: string
          period_month?: string
          site_id?: string
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_runs_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sites: {
        Row: {
          active: boolean | null
          created_at: string | null
          id: string
          location: string | null
          name: string
          organization_id: string
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          created_at?: string | null
          id?: string
          location?: string | null
          name: string
          organization_id: string
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          created_at?: string | null
          id?: string
          location?: string | null
          name?: string
          organization_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sites_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      stakeholder_site_access: {
        Row: {
          created_at: string | null
          id: string
          share_percent: number | null
          site_id: string
          stakeholder_user_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          share_percent?: number | null
          site_id: string
          stakeholder_user_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          share_percent?: number | null
          site_id?: string
          stakeholder_user_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stakeholder_site_access_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      transport_contractors: {
        Row: {
          active: boolean | null
          created_at: string | null
          id: string
          name: string
          organization_id: string
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          created_at?: string | null
          id?: string
          name: string
          organization_id: string
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          created_at?: string | null
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transport_contractors_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_photos: {
        Row: {
          created_at: string | null
          id: string
          organization_id: string
          photo_url: string
          sort_order: number
          trip_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          organization_id?: string
          photo_url: string
          sort_order?: number
          trip_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          organization_id?: string
          photo_url?: string
          sort_order?: number
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_photos_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_photos_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trips: {
        Row: {
          active: boolean
          advance_amount: number
          client_id: string | null
          contractor_id: string | null
          created_at: string | null
          created_by: string | null
          cubic_capacity: number | null
          customer_id: string | null
          distance_cost: number | null
          distance_km: number | null
          driver_id: string | null
          drop_location: string | null
          entry_time: string | null
          id: string
          load_info: string | null
          notes: string | null
          organization_id: string
          ownership_snapshot: string | null
          payment_method: string | null
          payment_reference: string | null
          payment_status: string | null
          permit_number: string | null
          photo_url: string | null
          photo_urls: string[] | null
          rate_per_cubic: number | null
          rate_per_km: number | null
          rate_source: string | null
          settled: boolean
          settled_at: string | null
          settled_by: string | null
          settlement_account: string | null
          settlement_amount: number
          settlement_method: string | null
          settlement_ref: string | null
          site_id: string
          total_shipment_cost: number | null
          trip_date: string
          trip_worth: number | null
          unload_notes: string | null
          unload_quantity: number | null
          unloaded_at: string | null
          unloaded_by: string | null
          updated_at: string | null
          vehicle_id: string | null
        }
        Insert: {
          active?: boolean
          advance_amount?: number
          client_id?: string | null
          contractor_id?: string | null
          created_at?: string | null
          created_by?: string | null
          cubic_capacity?: number | null
          customer_id?: string | null
          distance_cost?: number | null
          distance_km?: number | null
          driver_id?: string | null
          drop_location?: string | null
          entry_time?: string | null
          id?: string
          load_info?: string | null
          notes?: string | null
          organization_id?: string
          ownership_snapshot?: string | null
          payment_method?: string | null
          payment_reference?: string | null
          payment_status?: string | null
          permit_number?: string | null
          photo_url?: string | null
          photo_urls?: string[] | null
          rate_per_cubic?: number | null
          rate_per_km?: number | null
          rate_source?: string | null
          settled?: boolean
          settled_at?: string | null
          settled_by?: string | null
          settlement_account?: string | null
          settlement_amount?: number
          settlement_method?: string | null
          settlement_ref?: string | null
          site_id: string
          total_shipment_cost?: number | null
          trip_date?: string
          trip_worth?: number | null
          unload_notes?: string | null
          unload_quantity?: number | null
          unloaded_at?: string | null
          unloaded_by?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
        }
        Update: {
          active?: boolean
          advance_amount?: number
          client_id?: string | null
          contractor_id?: string | null
          created_at?: string | null
          created_by?: string | null
          cubic_capacity?: number | null
          customer_id?: string | null
          distance_cost?: number | null
          distance_km?: number | null
          driver_id?: string | null
          drop_location?: string | null
          entry_time?: string | null
          id?: string
          load_info?: string | null
          notes?: string | null
          organization_id?: string
          ownership_snapshot?: string | null
          payment_method?: string | null
          payment_reference?: string | null
          payment_status?: string | null
          permit_number?: string | null
          photo_url?: string | null
          photo_urls?: string[] | null
          rate_per_cubic?: number | null
          rate_per_km?: number | null
          rate_source?: string | null
          settled?: boolean
          settled_at?: string | null
          settled_by?: string | null
          settlement_account?: string | null
          settlement_amount?: number
          settlement_method?: string | null
          settlement_ref?: string | null
          site_id?: string
          total_shipment_cost?: number | null
          trip_date?: string
          trip_worth?: number | null
          unload_notes?: string | null
          unload_quantity?: number | null
          unloaded_at?: string | null
          unloaded_by?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trips_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "transport_contractors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
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
            foreignKeyName: "trips_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          organization_id: string
          role: string
          site_id: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          organization_id: string
          role: string
          site_id?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          organization_id?: string
          role?: string
          site_id?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicles: {
        Row: {
          active: boolean | null
          created_at: string | null
          default_contractor_id: string | null
          default_cubic_capacity: number | null
          id: string
          organization_id: string
          ownership: string
          plate_number: string
          updated_at: string | null
          vehicle_type: string
        }
        Insert: {
          active?: boolean | null
          created_at?: string | null
          default_contractor_id?: string | null
          default_cubic_capacity?: number | null
          id?: string
          organization_id: string
          ownership?: string
          plate_number: string
          updated_at?: string | null
          vehicle_type?: string
        }
        Update: {
          active?: boolean | null
          created_at?: string | null
          default_contractor_id?: string | null
          default_cubic_capacity?: number | null
          id?: string
          organization_id?: string
          ownership?: string
          plate_number?: string
          updated_at?: string | null
          vehicle_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_default_contractor_id_fkey"
            columns: ["default_contractor_id"]
            isOneToOne: false
            referencedRelation: "transport_contractors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      stakeholder_daily_summary: {
        Row: {
          book_date: string | null
          closing_balance: number | null
          opening_balance: number | null
          site_id: string | null
          total_in: number | null
          total_out: number | null
          trip_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_books_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      approve_leave_application:
        | { Args: { p_application_id: string }; Returns: undefined }
        | {
            Args: { p_application_id: string; p_force: boolean }
            Returns: undefined
          }
      unapprove_leave_application: {
        Args: { p_application_id: string }
        Returns: undefined
      }
      get_org_site_ids: { Args: never; Returns: string[] }
      get_my_assigned_sites: {
        Args: never
        Returns: { id: string; name: string; location: string | null }[]
      }
      resolve_or_create_contractor: {
        Args: { p_name: string }
        Returns: string
      }
      get_user_organization_id: { Args: never; Returns: string }
      get_user_role: { Args: never; Returns: string }
      get_user_site_ids: { Args: never; Returns: string[] }
      is_platform_owner: { Args: never; Returns: boolean }
      is_user_org_active: { Args: never; Returns: boolean }
      org_has_feature: {
        Args: { p_organization_id: string; p_feature_key: string }
        Returns: boolean
      }
      org_has_feature_for_caller: {
        Args: { p_feature_key: string }
        Returns: boolean
      }
      require_caller_org_feature: {
        Args: { p_feature_key: string }
        Returns: undefined
      }
      write_audit_event: {
        Args: {
          p_action: string
          p_target_type: string
          p_target_id: string
          p_organization_id?: string | null
          p_metadata?: Record<string, unknown> | null
        }
        Returns: undefined
      }
      seed_organization_features: {
        Args: { p_organization_id: string }
        Returns: undefined
      }
      claim_first_platform_owner: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      propagate_cash_book_balances: {
        Args: { p_site_id: string; p_start_date: string }
        Returns: undefined
      }
      provision_user_access: {
        Args: {
          p_user_id: string
          p_role: string
          p_organization_id: string
          p_site_id?: string | null
          p_share_percent?: number | null
          p_employee_link_mode?: string | null
          p_employee_id?: string | null
          p_employee_name?: string | null
          p_employee_phone?: string | null
          p_employee_wage_type?: string | null
          p_employee_wage_rate?: number | null
          p_site_ids?: string[] | null
        }
        Returns: undefined
      }
      register_tenant: {
        Args: { p_company_name: string; p_user_id: string }
        Returns: string
      }
      regenerate_payroll_run: { Args: { p_run_id: string }; Returns: undefined }
      finalize_payroll_run: { Args: { p_run_id: string }; Returns: undefined }
      recompute_payroll_run_amounts: { Args: { p_run_id: string }; Returns: undefined }
      dashboard_trip_day_rollup: {
        Args: { p_site_ids: string[]; p_trip_date: string }
        Returns: {
          site_id: string
          trip_count: number
          material: number
          advance: number
          inward: number
          unsettled: number
        }[]
      }
      document_trip_unload: {
        Args: {
          p_trip_id: string
          p_unload_notes?: string | null
          p_unload_quantity?: number | null
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

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

