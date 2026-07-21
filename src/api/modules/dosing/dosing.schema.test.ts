import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { getWarningCodes } from './dosing.schema.js'

describe('dosing.schema warning codes', () => {
  it('exposes the canonical warning set', () => {
    assert.deepEqual(getWarningCodes(), [
      'NO_NUTRIENTS_CONFIGURED',
      'NO_DAY_NUTRIENTS',
      'NO_NIGHT_NUTRIENTS',
      'NO_PH_BANDS',
      'PH_DAY_NIGHT_MISMATCH',
      'RESERVOIR_TOO_SMALL',
    ])
  })
})
