-- Migration 016: Operational updates including trip money collection/settlement and employee leave balances

-- ─── 1. Add settlement columns to trips table ──────────────────────────────
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS settled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS settlement_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS settlement_account text;

-- ─── 2. Add leave_balance column to employees table ─────────────────────────
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS leave_balance integer NOT NULL DEFAULT 15;

-- ─── 3. Update approve_leave_application to deduct leave days ────────────────
CREATE OR REPLACE FUNCTION public.approve_leave_application(p_application_id uuid)
RETURNS void AS $$
DECLARE
  v_employee_id uuid;
  v_from_date date;
  v_to_date date;
  v_cur_date date;
  v_days integer;
BEGIN
  -- Fetch leave details
  SELECT employee_id, from_date, to_date INTO v_employee_id, v_from_date, v_to_date
  FROM public.leave_applications
  WHERE id = p_application_id AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Leave application not found or not pending';
  END IF;

  -- Update leave application status to approved
  UPDATE public.leave_applications
  SET status = 'approved'
  WHERE id = p_application_id;

  -- Calculate duration in days
  v_days := v_to_date - v_from_date + 1;

  -- Deduct days from employee's leave balance
  UPDATE public.employees
  SET leave_balance = leave_balance - v_days
  WHERE id = v_employee_id;

  -- Insert/Upsert attendance records as leave for the duration
  v_cur_date := v_from_date;
  WHILE v_cur_date <= v_to_date LOOP
    INSERT INTO public.attendance (employee_id, att_date, status)
    VALUES (v_employee_id, v_cur_date, 'leave')
    ON CONFLICT (employee_id, att_date)
    DO UPDATE SET status = 'leave';
    
    v_cur_date := v_cur_date + 1;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
