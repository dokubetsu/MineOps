import { test, expect } from '@playwright/test'
import {
  canSeeTripBilling,
  canSettleTrips,
  canDocumentUnload,
  tripOpsFromOrgRow,
  rateUnitLabel,
  defaultCommercialCapacity,
  commercialQtyToM3,
  computeCommercialTripWorth,
  DEFAULT_TRIP_OPS_POLICY,
} from '../../src/lib/trip-ops-policy'

test.describe('Trip ops policies', () => {
  test('defaults keep open billing/settlement for demo orgs', () => {
    expect(DEFAULT_TRIP_OPS_POLICY.billingAdminOnly).toBe(false)
    expect(canSeeTripBilling('site_manager', DEFAULT_TRIP_OPS_POLICY)).toBe(true)
    expect(canSettleTrips('site_employee', DEFAULT_TRIP_OPS_POLICY)).toBe(true)
  })

  test('admin-only billing hides from managers', () => {
    const policy = tripOpsFromOrgRow({
      billing_admin_only: true,
      settlement_admin_only: true,
      quantity_unit: 'unit',
      units_per_m3: 1.5,
    })
    expect(canSeeTripBilling('admin', policy)).toBe(true)
    expect(canSeeTripBilling('site_manager', policy)).toBe(false)
    expect(canSettleTrips('unload_clerk', policy)).toBe(false)
    expect(canSettleTrips('admin', policy)).toBe(true)
    expect(rateUnitLabel(policy)).toBe('₹/unit')
  })

  test('units_per_m3 converts defaults and worth when rate is per m³', () => {
    const policy = tripOpsFromOrgRow({
      quantity_unit: 'unit',
      units_per_m3: 2,
    })
    expect(defaultCommercialCapacity('12WH', policy, () => '20')).toBe('40')
    expect(commercialQtyToM3(40, policy)).toBe(20)
    expect(
      computeCommercialTripWorth({
        commercialQty: 40,
        ratePerCommercialOrM3: 100,
        policy,
        rateIsPerM3: true,
      })
    ).toBe(2000) // (100/2)*40
    expect(
      computeCommercialTripWorth({
        commercialQty: 40,
        ratePerCommercialOrM3: 50,
        policy,
        rateIsPerM3: false,
      })
    ).toBe(2000) // 50₹/unit * 40
  })

  test('unload clerk can document unload', () => {
    expect(canDocumentUnload('unload_clerk')).toBe(true)
    expect(canDocumentUnload('admin')).toBe(true)
    expect(canDocumentUnload('site_manager')).toBe(false)
  })
})
