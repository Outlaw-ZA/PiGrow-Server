import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DosingCalcError, computeDosingMl } from './calc.js'

const row = (
  overrides: Partial<{
    nutrientId: string
    doseMlPerL: number
  }> = {},
) => ({
  doseMlPerL: overrides.doseMlPerL ?? 2,
  nutrientId: overrides.nutrientId ?? 'nut-1',
})

describe('computeDosingMl', () => {
  it('returns per-nutrient ml and sum for shared phase rows', () => {
    const result = computeDosingMl([row({ doseMlPerL: 2 })], 5)
    assert.deepEqual(result.mlByNutrientId, { 'nut-1': 10 })
    assert.equal(result.totalMl, 10)
    assert.deepEqual(result.warnings, [])
  })

  it('rounds to two decimals without floating-point noise', () => {
    const result = computeDosingMl([row({ doseMlPerL: 0.33 })], 15.5)
    assert.equal(result.mlByNutrientId['nut-1'], 5.12)
    assert.equal(result.totalMl, 5.12)
  })

  it('aggregates all phase nutrients into the sum', () => {
    const result = computeDosingMl(
      [row({ doseMlPerL: 2, nutrientId: 'a' }), row({ doseMlPerL: 1.5, nutrientId: 'b' })],
      4,
    )
    assert.deepEqual(result.mlByNutrientId, { a: 8, b: 6 })
    assert.equal(result.totalMl, 14)
  })

  it('emits NO_NUTRIENTS_CONFIGURED for an empty input', () => {
    const result = computeDosingMl([], 10)
    assert.deepEqual(result.mlByNutrientId, {})
    assert.equal(result.totalMl, 0)
    assert.deepEqual(result.warnings, ['NO_NUTRIENTS_CONFIGURED'])
  })

  it('throws a typed error for negative reservoir liters', () => {
    assert.throws(() => computeDosingMl([], -1), DosingCalcError)
  })

  it('returns zero doses for zero reservoir liters without warning', () => {
    const result = computeDosingMl([row({ doseMlPerL: 2 })], 0)
    assert.deepEqual(result.mlByNutrientId, { 'nut-1': 0 })
    assert.equal(result.totalMl, 0)
    assert.deepEqual(result.warnings, [])
  })
})
