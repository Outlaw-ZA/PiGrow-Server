import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DosingPreviewRequestSchema, getWarningCodes } from './dosing.schema.js'

describe('dosing.schema warning codes', () => {
  it('accepts only reservoirLiters in preview requests', () => {
    assert.deepEqual(Object.keys(DosingPreviewRequestSchema.properties), ['reservoirLiters'])
  })

  it('exposes only phase-wide dosing warnings', () => {
    assert.deepEqual(getWarningCodes(), [
      'NO_NUTRIENTS_CONFIGURED',
      'NO_PH_BANDS',
      'RESERVOIR_TOO_SMALL',
    ])
  })
})
