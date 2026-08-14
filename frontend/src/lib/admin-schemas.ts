import { z } from 'zod'
import { passwordSchema } from './password-policy'

/** UI often sends null for unused optional fields; treat null like omitted. */
const optionalString = z.string().nullish().transform((v) => v ?? undefined)
const optionalUuid = z.string().uuid('Invalid ID format').nullish().transform((v) => v ?? null)

export const createUserSchema = z
  .object({
    email: z.string().email('Invalid email address'),
    password: passwordSchema,
    role: z.enum(['admin', 'site_manager', 'stakeholder', 'employee', 'site_employee', 'unload_clerk'], {
      error: 'Invalid role',
    }),
    site_id: optionalUuid,
    /** Loading sites for unload_clerk (one or many). */
    site_ids: z.array(z.string().uuid('Invalid site ID')).nullish().transform((v) => v ?? undefined),
    share_percent: z
      .union([z.number(), z.string()])
      .nullish()
      .transform((val) => {
        if (val == null || val === '') return 50
        const num = parseFloat(String(val))
        return isNaN(num) ? 50 : num
      })
      .pipe(
        z
          .number()
          .min(0, 'Share percent cannot be negative')
          .max(100, 'Share percent cannot exceed 100%')
      ),
    employee_link_mode: z.enum(['link', 'create', 'none']).nullish().transform((v) => v ?? 'none'),
    employee_id: optionalUuid,
    employee_name: optionalString,
    employee_phone: optionalString,
    employee_wage_type: optionalString,
    employee_wage_rate: z
      .union([z.number(), z.string()])
      .nullish()
      .transform((val) => {
        if (val == null || val === '') return 0
        const num = parseFloat(String(val))
        return isNaN(num) ? 0 : num
      })
      .pipe(
        z
          .number()
          .min(0, 'Wage rate must be non-negative')
          .max(1000000, 'Wage rate exceeds upper limit')
      ),
  })
  .superRefine((data, ctx) => {
    if (data.role === 'admin') return
    if (data.role === 'unload_clerk') {
      const multi = (data.site_ids || []).filter(Boolean)
      if (multi.length === 0 && !data.site_id) {
        ctx.addIssue({
          code: 'custom',
          message: 'Select at least one loading site for the unload clerk',
          path: ['site_ids'],
        })
      }
      return
    }
    if (!data.site_id) {
      ctx.addIssue({
        code: 'custom',
        message: 'A site is required for non-admin roles',
        path: ['site_id'],
      })
    }
  })
