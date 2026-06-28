import { Type } from "@sinclair/typebox";

export const SensorTypeSchema = Type.Union([
  Type.Literal("HUMIDITY"),
  Type.Literal("TEMPERATURE"),
  Type.Literal("TEMP_HUMIDITY"),
  Type.Literal("CO2"),
  Type.Literal("PH"),
  Type.Literal("EC"),
]);

export const SensorProtocolSchema = Type.Union([
  Type.Literal("I2C"),
  Type.Literal("SPI"),
  Type.Literal("UART"),
  Type.Literal("RS485"),
]);

export const SensorParamsIdSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
});

export const SensorParamsControllerIdSchema = Type.Object({
  controllerId: Type.String({ format: "uuid" }),
});

export const CreateSensorSchema = Type.Object({
  controllerId: Type.String({ format: "uuid" }),
  name: Type.String({ maxLength: 100 }),
  type: SensorTypeSchema,
  mqttTopic: Type.String({ maxLength: 200 }),
  pinNumbers: Type.Array(Type.Integer({ minimum: 0, maximum: 40 })),
  protocol: SensorProtocolSchema,
});

export const UpdateSensorSchema = Type.Object({
  name: Type.Optional(Type.String({ maxLength: 100 })),
  type: Type.Optional(SensorTypeSchema),
  mqttTopic: Type.Optional(Type.String({ maxLength: 200 })),
  pinNumbers: Type.Optional(
    Type.Array(Type.Integer({ minimum: 0, maximum: 40 })),
  ),
  protocol: Type.Optional(SensorProtocolSchema),
  lastActive: Type.Optional(
    Type.String({
      format: "date-time",
      description: "ISO 8601 timestamp. Server-managed in normal flow.",
    }),
  ),
});
