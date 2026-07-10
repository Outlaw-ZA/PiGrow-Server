import { Type } from '@sinclair/typebox'

export const ErrorSchema = Type.Object(
  {
    error: Type.String({ description: 'Human-readable error message' }),
  },
  { $id: 'Error', description: 'Generic JSON error envelope returned by all 4xx/5xx responses' },
)

export const NullableNumberField = {
  nullable: true,
  type: 'number',
} as const
