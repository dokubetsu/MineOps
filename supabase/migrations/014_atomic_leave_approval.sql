CREATE OR REPLACE FUNCTION approve_leave_application(p_application_id uuid)
RETURNS void AS $$
DECLARE
  v_employee_id uuid;
  v_from_date date;
  v_to_date date;
  v_cur_date date;
BEGIN
  -- Get application details
  SELECT employee_id, from_date, to_date INTO v_employee_id, v_from_date, v_to_date
  FROM public.leave_applications
  WHERE id = p_application_id AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Leave application not found or not pending';
  END IF;

  -- Update status
  UPDATE public.leave_applications
  SET status = 'approved'
  WHERE id = p_application_id;

  -- Insert/Upsert attendance records
  v_cur_date := v_from_date;
  WHILE v_cur_date <= v_to_date LOOP
    INSERT INTO public.attendance (employee_id, att_date, status)
    VALUES (v_employee_id, v_cur_date, 'leave')
    ON CONFLICT (employee_id, att_date)
    DO UPDATE SET status = 'leave';
    
    v_cur_date := v_cur_date + 1;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
