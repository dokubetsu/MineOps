import { z } from 'zod'

/**
 * Shared password rules for platform bootstrap, org admin create, and tenant create-user.
 * Demo seed passwords (e2e) are set outside these APIs and are unaffected.
 */
export const PASSWORD_MIN_LENGTH = 10

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .regex(/[A-Za-z]/, 'Password must include at least one letter')
  .regex(/[0-9]/, 'Password must include at least one number')

export function passwordPolicyHint(): string {
  return `At least ${PASSWORD_MIN_LENGTH} characters, including a letter and a number`
}
