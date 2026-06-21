import { Type } from "@sinclair/typebox";

// Schema for creating a new GrowCycle
export const CreateGrowCycleSchema = Type.Object({
  name: Type.String({
    maxLength: 100,
    description: "The name of the specific grow run or harvest batch",
  }),
  controllerId: Type.String({
    format: "uuid",
    description: "The UUID of the physical Raspberry Pi running this cycle",
  }),
  isActive: Type.Optional(
    Type.Boolean({
      default: false,
      description: "Whether this grow cycle is actively running right now",
    }),
  ),
});

// Schema for updating an existing GrowCycle (all body fields optional)
export const UpdateGrowCycleSchema = Type.Object({
  name: Type.Optional(Type.String({ maxLength: 100 })),
  controllerId: Type.Optional(Type.String({ format: "uuid" })),
  isActive: Type.Optional(Type.Boolean()),
  startAt: Type.Optional(
    Type.String({
      format: "date",
      description: "Date (YYYY-MM-DD) marking when this grow cycle started",
    }),
  ),
});

// Schema for validating the URL path UUID parameter
export const GrowCycleParamsIdSchema = Type.Object({
  id: Type.String({
    format: "uuid",
    description: "The unique UUID identifier of the grow cycle",
  }),
});
