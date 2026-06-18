import { Type } from "@sinclair/typebox";

const TriggerTypeEnum = Type.Union([
  Type.Literal("SCHEDULE"),
  Type.Literal("THRESHOLD"),
  Type.Literal("ALWAYS_ON"),
  Type.Literal("ALWAYS_OFF"),
]);

export const CreateDeviceConfigSchema = Type.Object({
  growPhaseId: Type.String({
    format: "uuid",
    description: "The phase this device config belongs to",
  }),
  deviceId: Type.String({
    format: "uuid",
    description: "The physical device this config rules over",
  }),
  triggerType: TriggerTypeEnum,
  configData: Type.Any({
    description:
      "JSON payload (schedule: { onTime, offTime }, threshold: { sensor, condition, value, action })",
  }),
});

export const UpdateDeviceConfigSchema = Type.Object({
  triggerType: Type.Optional(TriggerTypeEnum),
  configData: Type.Optional(Type.Any()),
});

export const DeviceConfigParamsIdSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
});

export const DeviceConfigParamsPhaseIdSchema = Type.Object({
  phaseId: Type.String({ format: "uuid" }),
});
