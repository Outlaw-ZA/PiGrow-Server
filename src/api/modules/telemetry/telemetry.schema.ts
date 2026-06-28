import { Type } from "@sinclair/typebox";

export const TelemetrySensorTypeSchema = Type.Union([
  Type.Literal("HUMIDITY"),
  Type.Literal("TEMPERATURE"),
  Type.Literal("TEMP_HUMIDITY"),
  Type.Literal("CO2"),
  Type.Literal("PH"),
  Type.Literal("EC"),
]);

export const CreateTelemetrySchema = Type.Object({
  growCycleId: Type.String({
    format: "uuid",
    description: "The grow cycle this telemetry reading belongs to",
  }),
  sensorId: Type.String({
    format: "uuid",
    description: "The physical sensor that produced this reading",
  }),
  sensorType: TelemetrySensorTypeSchema,
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
