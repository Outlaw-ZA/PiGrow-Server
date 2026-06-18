import { Type } from "@sinclair/typebox";

export const CreateTelemetrySchema = Type.Object({
  growCycleId: Type.String({
    format: "uuid",
    description: "The grow cycle this telemetry reading belongs to",
  }),
  sensorType: Type.String({
    maxLength: 50,
    description: "e.g., TEMPERATURE, HUMIDITY, CO2, PH, EC",
  }),
  value: Type.Number({
    description: "The sensor reading value",
  }),
});

export const TelemetryParamsGrowCycleIdSchema = Type.Object({
  growCycleId: Type.String({ format: "uuid" }),
});

export const TelemetryRangeQuerySchema = Type.Object({
  from: Type.String({
    format: "date-time",
    description: "ISO 8601 start timestamp (inclusive)",
  }),
  to: Type.String({
    format: "date-time",
    description: "ISO 8601 end timestamp (inclusive)",
  }),
});
