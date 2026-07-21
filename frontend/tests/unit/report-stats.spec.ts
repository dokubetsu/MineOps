import { test, expect } from '@playwright/test'
import {
  businessPackByType,
  countTripsByType,
  dailyTripSheetRows,
  dailyTripTypeCounts,
  isNoPermit,
} from '../../src/lib/report-stats'

test.describe('report-stats (paper Excel replacement)', () => {
  const sample = [
    {
      trip_date: '2026-06-01',
      permit_number: 'P1',
      trip_worth: 1000,
      vehicles: { plate_number: 'TN01', vehicle_type: '12WH' },
      transport_contractors: { name: 'KVS' },
    },
    {
      trip_date: '2026-06-01',
      permit_number: '',
      trip_worth: 1000,
      vehicles: { plate_number: 'TN02', vehicle_type: '12WH' },
      transport_contractors: { name: 'KVS' },
    },
    {
      trip_date: '2026-06-02',
      permit_number: 'X',
      trip_worth: 800,
      vehicles: { plate_number: 'TN03', vehicle_type: '10WH' },
      transport_contractors: { name: 'VTS' },
    },
  ]

  test('counts 12WH / 10WH / NO.P', () => {
    const c = countTripsByType(sample)
    expect(c['12WH']).toBe(2)
    expect(c['10WH']).toBe(1)
    expect(c.noPermit).toBe(1)
    expect(c.total).toBe(3)
  })

  test('isNoPermit', () => {
    expect(isNoPermit({ permit_number: '' })).toBe(true)
    expect(isNoPermit({ permit_number: '  ' })).toBe(true)
    expect(isNoPermit({ permit_number: 'AB' })).toBe(false)
  })

  test('daily matrix', () => {
    const d = dailyTripTypeCounts(sample)
    expect(d).toHaveLength(2)
    expect(d[0].date).toBe('2026-06-01')
    expect(d[0]['12WH']).toBe(2)
    expect(d[0].noPermit).toBe(1)
  })

  test('business pack uses actual trip costs only (no invented defaults)', () => {
    const rows = businessPackByType(sample, { '12WH': 9999, '10WH': 9999, '6WH': 9999, Other: 9999 })
    const twelve = rows.find((r) => r.vehicleType === '12WH')!
    expect(twelve.count).toBe(2)
    expect(twelve.ratePerTrip).toBe(1000)
    expect(twelve.value).toBe(2000)
    const ten = rows.find((r) => r.vehicleType === '10WH')!
    expect(ten.count).toBe(1)
    expect(ten.value).toBe(800)
  })

  test('business pack does not invent revenue for zero-worth trips', () => {
    const zeroWorth = [
      {
        trip_date: '2026-06-01',
        trip_worth: null,
        total_shipment_cost: null,
        vehicles: { vehicle_type: '12WH' },
      },
    ]
    const rows = businessPackByType(zeroWorth as any, { '12WH': 1000 })
    const twelve = rows.find((r) => r.vehicleType === '12WH')!
    expect(twelve.count).toBe(1)
    expect(twelve.ratePerTrip).toBe(0)
    expect(twelve.value).toBe(0)
  })

  test('daily trip sheet serial', () => {
    const sheet = dailyTripSheetRows(sample)
    expect(sheet[0].sl).toBe(1)
    expect(sheet.some((r) => r.permit === 'NO.P')).toBe(true)
  })
})
