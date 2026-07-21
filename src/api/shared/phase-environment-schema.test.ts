import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PhaseEnvironmentSchema } from './phase-environment-schema.js'

describe('PhaseEnvironmentSchema', () => {
  it('has the same properties as the prior inline definitions', () => {
    const properties = Object.keys(PhaseEnvironmentSchema.properties).slice().toSorted()
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
      .toSorted()
    assert.deepEqual(properties, expected)
  })

  it('has exactly 14 properties', () => {
    assert.equal(Object.keys(PhaseEnvironmentSchema.properties).length, 14)
  })
})
