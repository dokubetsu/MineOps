import { test, expect } from '@playwright/test'
import { NextRequest } from 'next/server'
import { clientIp } from '@/proxy'
import { createUserSchema } from '@/lib/admin-schemas'

test.describe('Security & Multi-Tenant Remediation Unit Tests', () => {
  test.describe('Client IP Extraction (Anti-Spoofing)', () => {
    test('extracts platform-verified Vercel IP first', () => {
      const req = new NextRequest('http://localhost:3000/api/platform/bootstrap', {
        headers: {
          'x-vercel-forwarded-for': '203.0.113.195, 10.0.0.1',
          'x-forwarded-for': '198.51.100.1',
        },
      })
      expect(clientIp(req)).toBe('203.0.113.195')
    })

    test('extracts Cloudflare connecting IP when present', () => {
      const req = new NextRequest('http://localhost:3000/api/platform/bootstrap', {
        headers: {
          'cf-connecting-ip': '203.0.113.88',
          'x-forwarded-for': '198.51.100.1, 10.0.0.2',
        },
      })
      expect(clientIp(req)).toBe('203.0.113.88')
    })

    test('extracts x-real-ip when platform headers missing', () => {
      const req = new NextRequest('http://localhost:3000/api/platform/bootstrap', {
        headers: {
          'x-real-ip': '198.51.100.42',
          'x-forwarded-for': '10.0.0.1',
        },
      })
      expect(clientIp(req)).toBe('198.51.100.42')
    })

    test('extracts rightmost proxy IP in X-Forwarded-For to prevent client spoofing', () => {
      const req = new NextRequest('http://localhost:3000/api/platform/bootstrap', {
        headers: {
          // Client sends spoofed '1.1.1.1', proxy appends real client IP '198.51.100.99'
          'x-forwarded-for': '1.1.1.1, 198.51.100.99',
        },
      })
      expect(clientIp(req)).toBe('198.51.100.99')
    })

    test('falls back to 127.0.0.1 when no IP headers present', () => {
      const req = new NextRequest('http://localhost:3000/api/platform/bootstrap')
      expect(clientIp(req)).toBe('127.0.0.1')
    })
  })

  test.describe('Admin Create User Input Validation Bounds', () => {
    const validBase = {
      email: 'newuser@example.com',
      password: 'StrongPassword123!',
      role: 'admin' as const,
    }

    test('accepts valid share_percent and wage_rate', () => {
      const result = createUserSchema.safeParse({
        ...validBase,
        share_percent: 50,
        employee_wage_rate: 1500,
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.share_percent).toBe(50)
        expect(result.data.employee_wage_rate).toBe(1500)
      }
    })

    test('rejects negative share_percent', () => {
      const result = createUserSchema.safeParse({
        ...validBase,
        share_percent: -10,
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        const msg = result.error.issues.map((i) => i.message).join(' ')
        expect(msg).toContain('Share percent cannot be negative')
      }
    })

    test('rejects share_percent exceeding 100%', () => {
      const result = createUserSchema.safeParse({
        ...validBase,
        share_percent: 150,
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        const msg = result.error.issues.map((i) => i.message).join(' ')
        expect(msg).toContain('Share percent cannot exceed 100%')
      }
    })

    test('rejects negative employee_wage_rate', () => {
      const result = createUserSchema.safeParse({
        ...validBase,
        employee_wage_rate: -500,
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        const msg = result.error.issues.map((i) => i.message).join(' ')
        expect(msg).toContain('Wage rate must be non-negative')
      }
    })

    test('rejects unreasonable employee_wage_rate exceeding limit', () => {
      const result = createUserSchema.safeParse({
        ...validBase,
        employee_wage_rate: 2_000_000,
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        const msg = result.error.issues.map((i) => i.message).join(' ')
        expect(msg).toContain('Wage rate exceeds upper limit')
      }
    })
  })
})
