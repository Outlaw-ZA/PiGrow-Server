import { Type } from "@sinclair/typebox";

const TriggerTypeEnum = Type.Union([
  Type.Literal("SCHEDULE"),
  Type.Literal("THRESHOLD"),
  Type.Literal("ALWAYS_ON"),
  Type.Literal("ALWAYS_OFF"),
]);

const TimeString = Type.String({
  pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$",
  description: "Time in 24h HH:MM format",
});

const ScheduleDuration = Type.Object({
  onTime: TimeString,
  durationHours: Type.Number({ minimum: 0.1, maximum: 24 }),
});

const ScheduleWindow = Type.Object({
  onTime: TimeString,
  offTime: TimeString,
});

const ScheduleConfigData = Type.Union([ScheduleDuration, ScheduleWindow], {
  description:
    "SCHEDULE payload: { onTime, durationHours } OR { onTime, offTime }",
});

const ThresholdMetric = Type.Object({
  metric: Type.String({ minLength: 1 }),
  high: Type.Number(),
});

const ThresholdCondition = Type.Object({
  sensor: Type.String({ minLength: 1 }),
  condition: Type.Union([
    Type.Literal("GREATER_THAN"),
    Type.Literal("LESS_THAN"),
    Type.Literal("GREATER_THAN_OR_EQUAL"),
    Type.Literal("LESS_THAN_OR_EQUAL"),
    Type.Literal("EQUAL"),
  ]),
  value: Type.Number(),
  action: Type.Union([Type.Literal("ON"), Type.Literal("OFF"), Type.Literal("TOGGLE")]),
});

const ThresholdConfigData = Type.Union([ThresholdMetric, ThresholdCondition], {
  description:
    "THRESHOLD payload: { metric, high } OR { sensor, condition, value, action }",
});

const EmptyConfigData = Type.Object(
  {},
  { additionalProperties: true },
);

const CreateBase = {
  growPhaseId: Type.String({
    format: "uuid",
    description: "The phase this device config belongs to",
  }),
  deviceId: Type.String({
    format: "uuid",
    description: "The physical device this config rules over",
  }),
};

export const CreateDeviceConfigSchema = Type.Union(
  [
    Type.Object({
      ...CreateBase,
      triggerType: Type.Literal("SCHEDULE"),
      configData: ScheduleConfigData,
    }),
    Type.Object({
      ...CreateBase,
      triggerType: Type.Literal("THRESHOLD"),
      configData: ThresholdConfigData,
    }),
    Type.Object({
      ...CreateBase,
      triggerType: Type.Literal("ALWAYS_ON"),
      configData: EmptyConfigData,
    }),
    Type.Object({
      ...CreateBase,
      triggerType: Type.Literal("ALWAYS_OFF"),
      configData: EmptyConfigData,
    }),
  ],
  {
    description:
      "Create a device config. configData shape is determined by triggerType (discriminated union).",
  },
);

export const UpdateDeviceConfigSchema = Type.Union(
  [
    Type.Object({
      triggerType: Type.Literal("SCHEDULE"),
      configData: ScheduleConfigData,
    }),
    Type.Object({
      triggerType: Type.Literal("THRESHOLD"),
      configData: ThresholdConfigData,
    }),
    Type.Object({
      triggerType: Type.Literal("ALWAYS_ON"),
      configData: EmptyConfigData,
    }),
    Type.Object({
      triggerType: Type.Literal("ALWAYS_OFF"),
      configData: EmptyConfigData,
    }),
  ],
  {
    description:
      "Update a device config. Both triggerType and configData are required together and must be a consistent pair.",
  },
);

export const DeviceConfigParamsIdSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
});

export const DeviceConfigParamsPhaseIdSchema = Type.Object({
  phaseId: Type.String({ format: "uuid" }),
});
