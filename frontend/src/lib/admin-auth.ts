import type { SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

/**
 * Block tenant admin APIs when the caller's organization is deactivated.
 * Service-role clients cannot rely on is_user_org_active() (no JWT uid context),
 * so we check organizations.active by id.
 */
export async function assertOrganizationActive(
  supabase: SupabaseClient,
  organizationId: string
): Promise<NextResponse | null> {
  const { data, error } = await supabase
    .from('organizations')
    .select('active')
    .eq('id', organizationId)
    .maybeSingle()

  if (error) {
    return NextResponse.json(
      { error: `Failed to verify organization: ${error.message}` },
      { status: 500 }
    )
  }

  if (!data || data.active !== true) {
    return NextResponse.json(
      {
        error: 'Organization is deactivated. Contact the platform owner.',
        code: 'ORG_INACTIVE',
      },
      { status: 403 }
    )
  }

  return null
}
