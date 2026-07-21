import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PhaseEnvironmentSchema } from './phase-environment-schema.js'

describe('PhaseEnvironmentSchema', () => {
  it('has the same properties as the prior inline definitions', () => {
    const properties = [...Object.keys(PhaseEnvironmentSchema.properties)].slice().sort()
    const expected = [
      'co2Max',
      'co2Min',
      'co2Target',
      'createdAt',
      'growPhaseId',
      'humidityMax',
      'humidityMin',
      'humidityTarget',
      'id',
      'period',
      'phMax',
      'phMin',
      'phTarget',
      'tempMax',
      'tempMin',
      'tempTarget',
      'updatedAt',
    ]
      .slice()
      .sort()
    assert.deepEqual(properties, expected)
  })

  it('has exactly 17 properties', () => {
    assert.equal(Object.keys(PhaseEnvironmentSchema.properties).length, 17)
  })

  it('includes the pH band fields', () => {
    const properties = Object.keys(PhaseEnvironmentSchema.properties)
    assert.ok(properties.includes('phMin'))
    assert.ok(properties.includes('phTarget'))
    assert.ok(properties.includes('phMax'))
  })
})
