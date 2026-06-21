import { Type } from "@sinclair/typebox";

// Schema for creating a Phase (Strict JSON primitives)
export const CreateGrowPhaseSchema = Type.Object({
  growCycleId: Type.String({
    format: "uuid",
    description: "The unique ID of the grow cycle this phase belongs to",
  }),
  name: Type.String({
    maxLength: 100,
    description: "e.g., Early Veg, Late Bloom, Flush",
  }),
  order: Type.Integer({
    minimum: 1,
    description: "The sequential execution order index (e.g., 1, 2, 3)",
  }),
  durationDays: Type.Integer({
    minimum: 1,
    description: "Target runtime duration in days for this phase",
  }),
  isActive: Type.Optional(
    Type.Boolean({
      default: false,
      description: "Flags whether this phase is currently running",
    }),
  ),
  startAt: Type.Optional(
    Type.String({
      format: "date",
      description: "Date (YYYY-MM-DD) when this phase actively started execution",
    }),
  ),
  endAt: Type.Optional(
    Type.String({
      format: "date",
      description: "Date (YYYY-MM-DD) when this phase concluded",
    }),
  ),
});

// Schema for updating a Phase (All body fields optional)
export const UpdateGrowPhaseSchema = Type.Object({
  name: Type.Optional(Type.String({ maxLength: 100 })),
  order: Type.Optional(Type.Integer({ minimum: 1 })),
  durationDays: Type.Optional(Type.Integer({ minimum: 1 })),
  isActive: Type.Optional(Type.Boolean()),
  startAt: Type.Optional(Type.String({ format: "date" })),
  endAt: Type.Optional(Type.String({ format: "date" })),
});

// Schema for matching the dynamic URL path parameter of a single Phase
export const GrowPhaseParamsIdSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
});

// Schema for querying or targeting by a specific Grow Cycle context
export const GrowPhaseParamsCycleIdSchema = Type.Object({
  growCycleId: Type.String({ format: "uuid" }),
});
