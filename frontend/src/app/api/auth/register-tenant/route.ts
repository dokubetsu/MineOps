import { NextResponse } from 'next/server'

/**
 * Public tenant self-registration is disabled.
 * New organizations and first admins are created by platform_owner via:
 *   POST /api/platform/orgs
 * and the /platform console.
 */
export async function POST() {
  return NextResponse.json(
    {
      error:
        'Public organization registration is disabled. Contact your Khani platform operator to provision your organization and admin account.',
      code: 'REGISTRATION_DISABLED_PLATFORM_ONLY',
    },
    { status: 403 }
  )
}
