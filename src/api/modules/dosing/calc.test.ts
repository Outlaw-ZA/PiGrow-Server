import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DosingCalcError, computeDosingMl } from './calc.js'

const row = (
  overrides: Partial<{
    nutrientId: string
    doseMlPerL: number
    appliesToPeriod: 'DAY' | 'NIGHT'
  }> = {},
) => ({
  appliesToPeriod: overrides.appliesToPeriod ?? ('DAY' as const),
  doseMlPerL: overrides.doseMlPerL ?? 2,
  nutrientId: overrides.nutrientId ?? 'nut-1',
})

describe('computeDosingMl', () => {
  it('returns per-nutrient ml and sum for a single DAY row', () => {
    const result = computeDosingMl([row({ doseMlPerL: 2 })], 'DAY', 5)
    assert.deepEqual(result.mlByNutrientId, { 'nut-1': 10 })
    assert.equal(result.totalMl, 10)
    assert.deepEqual(result.warnings, [])
  })

  it('rounds to two decimals without floating-point noise', () => {
    const result = computeDosingMl([row({ doseMlPerL: 0.33 })], 'DAY', 15.5)
    assert.equal(result.mlByNutrientId['nut-1'], 5.12)
    assert.equal(result.totalMl, 5.12)
  })

  it('aggregates multiple nutrients into the sum', () => {
    const result = computeDosingMl(
      [row({ doseMlPerL: 2, nutrientId: 'a' }), row({ doseMlPerL: 1.5, nutrientId: 'b' })],
      'DAY',
      4,
    )
    assert.deepEqual(result.mlByNutrientId, { a: 8, b: 6 })
    assert.equal(result.totalMl, 14)
  })

  it('emits NO_NUTRIENTS_CONFIGURED for an empty input', () => {
    const result = computeDosingMl([], 'DAY', 10)
    assert.deepEqual(result.mlByNutrientId, {})
    assert.equal(result.totalMl, 0)
    assert.ok(result.warnings.includes('NO_NUTRIENTS_CONFIGURED'))
  })

  it('filters by the requested period and emits NO_NIGHT_NUTRIENTS when filtering produces empty', () => {
    const result = computeDosingMl([row({ appliesToPeriod: 'DAY' })], 'NIGHT', 5)
    assert.deepEqual(result.mlByNutrientId, {})
    assert.ok(result.warnings.includes('NO_NIGHT_NUTRIENTS'))
    assert.ok(!result.warnings.includes('NO_DAY_NUTRIENTS'))
  })

  it('filters by the requested period and emits NO_DAY_NUTRIENTS when filtering produces empty', () => {
    const result = computeDosingMl([row({ appliesToPeriod: 'NIGHT' })], 'DAY', 5)
    assert.deepEqual(result.mlByNutrientId, {})
    assert.ok(result.warnings.includes('NO_DAY_NUTRIENTS'))
    assert.ok(!result.warnings.includes('NO_NIGHT_NUTRIENTS'))
  })

  it('does not double-count nutrients that exist in both periods (period-filtered input only)', () => {
    const result = computeDosingMl(
      [row({ doseMlPerL: 2, nutrientId: 'a' }), row({ doseMlPerL: 3, nutrientId: 'a' })],
      'DAY',
      1,
    )
    assert.equal(result.mlByNutrientId.a, 3) // Last write wins
  })

  it('throws a typed error for negative reservoir liters', () => {
    assert.throws(() => computeDosingMl([], 'DAY', -1), DosingCalcError)
  })

  it('returns empty results for zero reservoir liters without warning', () => {
    const result = computeDosingMl([row({ doseMlPerL: 2 })], 'DAY', 0)
    assert.deepEqual(result.mlByNutrientId, { 'nut-1': 0 })
    assert.equal(result.totalMl, 0)
    assert.deepEqual(result.warnings, [])
  })
})
