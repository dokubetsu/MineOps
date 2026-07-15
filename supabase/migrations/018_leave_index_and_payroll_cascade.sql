-- Migration 018: Add missing leave_applications index and fix payroll_lines cascade deletion

-- 1. Add missing index for employee_id on leave_applications to optimize RLS queries
CREATE INDEX IF NOT EXISTS idx_leave_applications_employee_id ON public.leave_applications(employee_id);

-- 2. Modify payroll_lines foreign key to RESTRICT instead of CASCADE
-- This prevents hard-deletion of employees who have finalized payroll lines
ALTER TABLE public.payroll_lines DROP CONSTRAINT IF EXISTS payroll_lines_employee_id_fkey;

ALTER TABLE public.payroll_lines
  ADD CONSTRAINT payroll_lines_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE RESTRICT;
