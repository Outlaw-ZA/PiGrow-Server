import { Type } from "@sinclair/typebox";
import { ErrorSchema } from "../../shared/schemas.js";

const SensorTypeEnum = Type.Union([
  Type.Literal("HUMIDITY"),
  Type.Literal("TEMPERATURE"),
  Type.Literal("TEMP_HUMIDITY"),
  Type.Literal("CO2"),
  Type.Literal("PH"),
  Type.Literal("EC"),
]);
const PeriodEnum = Type.Union([
  Type.Literal("DAY"),
  Type.Literal("NIGHT"),
]);
// At the API layer all six threshold conditions (ABOVE_MAX / BELOW_MIN /
// ABOVE_MIN / BELOW_MAX / ABOVE_TARGET / BELOW_TARGET) and ALWAYS_ON /
// ALWAYS_OFF are accepted. SCHEDULE_ON / SCHEDULE_OFF still exist in the
// enum for backward compatibility but are rejected at the controller with a
// specific 400 message. We list them here so TypeBox passes the request
// through to the controller (where the application-level rejection is what
// the FE should see and render).
const AcceptedRuleConditionEnum = Type.Union([
  Type.Literal("ABOVE_MAX"),
  Type.Literal("BELOW_MIN"),
  Type.Literal("ABOVE_MIN"),
  Type.Literal("BELOW_MAX"),
  Type.Literal("ABOVE_TARGET"),
  Type.Literal("BELOW_TARGET"),
  Type.Literal("ALWAYS_ON"),
  Type.Literal("ALWAYS_OFF"),
  Type.Literal("SCHEDULE_ON"),
  Type.Literal("SCHEDULE_OFF"),
]);
const DeviceActionEnum = Type.Union([
  Type.Literal("ON"),
  Type.Literal("OFF"),
]);

export const AutomationRuleResponseSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  growCycleId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
  growPhaseId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
  deviceId: Type.String({ format: "uuid" }),
  watchedSensorType: Type.Union([SensorTypeEnum, Type.Null()]),
  period: Type.Union([PeriodEnum, Type.Null()]),
  condition: AcceptedRuleConditionEnum,
  action: DeviceActionEnum,
  cooldownSeconds: Type.Integer(),
  enabled: Type.Boolean(),
  lastTriggeredAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
  createdAt: Type.String({ format: "date-time" }),
  updatedAt: Type.String({ format: "date-time" }),
});

export const AutomationRuleArrayResponseSchema = Type.Array(
  AutomationRuleResponseSchema,
);

export const AutomationRuleToggleResponseSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  enabled: Type.Boolean(),
});

export const AutomationRuleIdParamsSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
});

export const AutomationRuleGrowCycleParamsSchema = Type.Object({
  growCycleId: Type.String({ format: "uuid" }),
});

export const AutomationRuleGrowPhaseParamsSchema = Type.Object({
  growPhaseId: Type.String({ format: "uuid" }),
});

export const AutomationRuleDeviceParamsSchema = Type.Object({
  deviceId: Type.String({ format: "uuid" }),
});

export const CreateAutomationRuleSchema = Type.Object({
  growCycleId: Type.Optional(Type.String({ format: "uuid" })),
  growPhaseId: Type.Optional(Type.String({ format: "uuid" })),
  deviceId: Type.String({ format: "uuid" }),
  // Nullable: ALWAYS_ON / ALWAYS_OFF rules don't watch a sensor; threshold
  // rules must set this. Enforced in the controller.
  watchedSensorType: Type.Optional(Type.Union([SensorTypeEnum, Type.Null()])),
  period: Type.Optional(Type.Union([PeriodEnum, Type.Null()])),
  condition: AcceptedRuleConditionEnum,
  action: DeviceActionEnum,
  cooldownSeconds: Type.Optional(
    Type.Integer({ minimum: 0, default: 180 }),
  ),
  enabled: Type.Optional(Type.Boolean({ default: true })),
});

export const UpdateAutomationRuleSchema = Type.Object({
  deviceId: Type.Optional(Type.String({ format: "uuid" })),
  watchedSensorType: Type.Optional(Type.Union([SensorTypeEnum, Type.Null()])),
  period: Type.Optional(Type.Union([PeriodEnum, Type.Null()])),
  condition: Type.Optional(AcceptedRuleConditionEnum),
  action: Type.Optional(DeviceActionEnum),
  cooldownSeconds: Type.Optional(Type.Integer({ minimum: 0 })),
  enabled: Type.Optional(Type.Boolean()),
});

export { ErrorSchema };
