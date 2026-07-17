import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Missing Supabase environment variables')
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/**
 * Verify Bearer token and that the caller is a platform_owner.
 * Returns service-role client + user, or a NextResponse error.
 */
export async function requirePlatformOwner(
  req: NextRequest
): Promise<
  | { ok: true; supabase: SupabaseClient; user: User }
  | { ok: false; response: NextResponse }
> {
  try {
    const supabase = serviceClient()
    const authHeader = req.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
    }
    const token = authHeader.slice(7)
    const { data: callerData, error: callerError } = await supabase.auth.getUser(token)
    if (callerError || !callerData.user) {
      return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
    }

    const { data: platformRole, error: roleError } = await supabase
      .from('platform_roles')
      .select('role')
      .eq('user_id', callerData.user.id)
      .eq('role', 'platform_owner')
      .maybeSingle()

    if (roleError) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: `Failed to verify platform role: ${roleError.message}` },
          { status: 500 }
        ),
      }
    }
    if (!platformRole) {
      return {
        ok: false,
        response: NextResponse.json({ error: 'Forbidden: platform owner only' }, { status: 403 }),
      }
    }

    return { ok: true, supabase, user: callerData.user }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Server configuration error'
    return { ok: false, response: NextResponse.json({ error: message }, { status: 500 }) }
  }
}
