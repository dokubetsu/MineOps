import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

/**
 * POST /api/admin/period-ops
 * Admin-only month-end operations for a site + date range:
 * - close: audit log only (period marked closed)
 * - reopen: audit log only
 * - purge: soft-delete trips/cash entries; delete attendance in range; log counts
 *
 * Purge requires confirm_phrase === "DELETE" (exact).
 * Does not delete payroll_runs / finalized payroll history (safety).
 */

const bodySchema = z.object({
  action: z.enum(['close', 'reopen', 'purge']),
  site_id: z.string().uuid(),
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().max(500).optional(),
  confirm_phrase: z.string().optional(),
})

export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: callerData, error: callerError } = await supabase.auth.getUser(
    authHeader.slice(7)
  )
  if (callerError || !callerData.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: roleData } = await supabase
    .from('user_roles')
    .select('role, organization_id')
    .eq('user_id', callerData.user.id)
    .eq('role', 'admin')

  if (!roleData?.length) {
    return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 })
  }
  const organizationId = roleData[0].organization_id as string

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'Invalid body' },
      { status: 400 }
    )
  }

  const { action, site_id, from_date, to_date, notes, confirm_phrase } = parsed.data
  if (from_date > to_date) {
    return NextResponse.json({ error: 'from_date must be ≤ to_date' }, { status: 400 })
  }

  if (action === 'purge' && confirm_phrase !== 'DELETE') {
    return NextResponse.json(
      { error: 'Purge requires confirm_phrase exactly "DELETE"' },
      { status: 400 }
    )
  }

  // Site must belong to caller's org
  const { data: site, error: siteErr } = await supabase
    .from('sites')
    .select('id, organization_id, name')
    .eq('id', site_id)
    .maybeSingle()

  if (siteErr || !site || site.organization_id !== organizationId) {
    return NextResponse.json({ error: 'Site not found in your organization' }, { status: 404 })
  }

  // Block purge if finalized payroll exists overlapping the month(s) for this site
  if (action === 'purge') {
    const { data: finalized } = await supabase
      .from('payroll_runs')
      .select('id, period_month, status')
      .eq('site_id', site_id)
      .eq('status', 'finalized')
      .limit(50)

    const fromYm = from_date.slice(0, 7)
    const toYm = to_date.slice(0, 7)
    const conflict = (finalized || []).some((r) => {
      const ym = String(r.period_month || '').slice(0, 7)
      return ym >= fromYm && ym <= toYm
    })
    if (conflict) {
      return NextResponse.json(
        {
          error:
            'Cannot purge: a finalized payroll run exists for this site in the selected period. Keep history or delete draft-only months.',
        },
        { status: 409 }
      )
    }
  }

  const counts: Record<string, number> = {
    trips: 0,
    cash_entries: 0,
    attendance: 0,
    leave_applications: 0,
  }

  if (action === 'purge') {
    // Soft-delete trips
    const { data: tripsUp, error: tripsErr } = await supabase
      .from('trips')
      .update({ active: false })
      .eq('site_id', site_id)
      .eq('organization_id', organizationId)
      .gte('trip_date', from_date)
      .lte('trip_date', to_date)
      .eq('active', true)
      .select('id')

    if (tripsErr) {
      return NextResponse.json({ error: `Trips: ${tripsErr.message}` }, { status: 500 })
    }
    counts.trips = tripsUp?.length ?? 0

    // Soft-delete cash entries for books in range
    const { data: books } = await supabase
      .from('cash_books')
      .select('id')
      .eq('site_id', site_id)
      .gte('book_date', from_date)
      .lte('book_date', to_date)

    const bookIds = (books || []).map((b) => b.id)
    if (bookIds.length > 0) {
      const { data: entriesUp, error: entErr } = await supabase
        .from('cash_entries')
        .update({ active: false })
        .in('cash_book_id', bookIds)
        .eq('active', true)
        .select('id')
      if (entErr) {
        return NextResponse.json({ error: `Cash entries: ${entErr.message}` }, { status: 500 })
      }
      counts.cash_entries = entriesUp?.length ?? 0
    }

    // Delete attendance for employees on this site
    const { data: emps } = await supabase
      .from('employees')
      .select('id')
      .eq('site_id', site_id)
      .eq('organization_id', organizationId)

    const empIds = (emps || []).map((e) => e.id)
    if (empIds.length > 0) {
      const { data: attDel, error: attErr } = await supabase
        .from('attendance')
        .delete()
        .in('employee_id', empIds)
        .gte('att_date', from_date)
        .lte('att_date', to_date)
        .select('id')
      if (attErr) {
        return NextResponse.json({ error: `Attendance: ${attErr.message}` }, { status: 500 })
      }
      counts.attendance = attDel?.length ?? 0

      // Leave applications overlapping range for these employees
      const { data: leaves, error: leaveErr } = await supabase
        .from('leave_applications')
        .delete()
        .in('employee_id', empIds)
        .lte('from_date', to_date)
        .gte('to_date', from_date)
        .select('id')
      if (leaveErr) {
        // Non-fatal if leave table policies block — still log
        counts.leave_applications = 0
        console.warn('[period-ops] leave purge:', leaveErr.message)
      } else {
        counts.leave_applications = leaves?.length ?? 0
      }
    }
  }

  const { error: logErr } = await supabase.from('period_ops_log').insert({
    organization_id: organizationId,
    site_id,
    from_date,
    to_date,
    action,
    counts,
    notes: notes || null,
    created_by: callerData.user.id,
  })

  if (logErr) {
    // Table may not exist yet if migration not applied
    console.warn('[period-ops] log insert:', logErr.message)
    if (action !== 'purge') {
      return NextResponse.json(
        {
          error: `Could not record operation (apply migration 055?): ${logErr.message}`,
        },
        { status: 500 }
      )
    }
  }

  return NextResponse.json({
    ok: true,
    action,
    site_id,
    site_name: site.name,
    from_date,
    to_date,
    counts,
  })
}
