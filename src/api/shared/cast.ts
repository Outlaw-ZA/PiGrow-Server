// Cast controller return values to satisfy the strict response-schema types
// Declared on each route. Prisma returns `Date` instances for timestamp fields,
// But JSON serialization (and our OpenAPI response schemas) describe them as
// ISO-8601 strings. The runtime is correct — this helper only appeases the
// TypeScript checker. The inferred return type follows the caller's annotation.
export const cast = <T>(value: unknown): T => value as T
