/**
 * Shared password rules for platform bootstrap, org admin create, and tenant create-user.
 * Demo seed passwords (e2e) are set outside these APIs and are unaffected.
 */
import { z } from 'zod'

export const PASSWORD_MIN_LENGTH = 12

/** Letter, number, and at least one special character. */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .regex(/[A-Za-z]/, 'Password must include at least one letter')
  .regex(/[0-9]/, 'Password must include at least one number')
  .regex(
    /[^A-Za-z0-9]/,
    'Password must include at least one special character (e.g. ! @ # $ %)'
  )

export function passwordPolicyHint(): string {
  return `At least ${PASSWORD_MIN_LENGTH} characters, with a letter, a number, and a special character`
}
