import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PhaseEnvironmentSchema } from './phase-environment-schema.js'

describe('PhaseEnvironmentSchema', () => {
  it('contains only period-specific environment properties', () => {
    const properties = [...Object.keys(PhaseEnvironmentSchema.properties)].toSorted((left, right) =>
      left.localeCompare(right),
    )
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
      'tempMax',
      'tempMin',
      'tempTarget',
      'updatedAt',
    ]
      .slice()
      .toSorted((left, right) => left.localeCompare(right))
    assert.deepEqual(properties, expected)
  })

  it('does not include phase-wide pH band fields', () => {
    const properties = Object.keys(PhaseEnvironmentSchema.properties)
    assert.ok(!properties.includes('phMin'))
    assert.ok(!properties.includes('phTarget'))
    assert.ok(!properties.includes('phMax'))
  })
})
