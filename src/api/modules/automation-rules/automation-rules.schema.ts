import { Type } from "@sinclair/typebox";
import {
  SensorType,
  DayNightPeriod,
  RuleCondition,
  DeviceAction,
} from "../../../generated/client/enums.js";

const SensorTypeEnum = Type.Union(
  Object.values(SensorType).map((v) => Type.Literal(v)),
);
const PeriodEnum = Type.Union(
  Object.values(DayNightPeriod).map((v) => Type.Literal(v)),
);
// At the API layer ABOVE_MAX / BELOW_MIN / ALWAYS_ON / ALWAYS_OFF are accepted.
// SCHEDULE_ON / SCHEDULE_OFF still exist in the enum for backward compatibility
// but are rejected at the controller with a specific 400 message. We list them
// here so TypeBox passes the request through to the controller (where the
// application-level rejection is what the FE should see and render).
const AcceptedRuleConditionEnum = Type.Union(
  Object.values(RuleCondition).map((v) => Type.Literal(v)),
);
const DeviceActionEnum = Type.Union(
  Object.values(DeviceAction).map((v) => Type.Literal(v)),
);

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
