import { Type } from "@sinclair/typebox";

// Explicit string literals matching your Prisma DeviceType enum
const DeviceTypeEnum = Type.Union([
  Type.Literal("LIGHT"),
  Type.Literal("EXHAUST_FAN"),
  Type.Literal("INTAKE_FAN"),
  Type.Literal("CIRCULATION_FAN"),
  Type.Literal("WATER_PUMP"),
  Type.Literal("AIR_CONDITIONER"),
  Type.Literal("HEATER"),
  Type.Literal("HUMIDIFIER"),
  Type.Literal("DEHUMIDIFIER"),
  Type.Literal("CO2_INJECTOR"),
]);

// Body shape for a single device entry (used by both single and batch create)
const DeviceBody = Type.Object({
  name: Type.String({ maxLength: 100 }),
  type: DeviceTypeEnum,
  pinNumber: Type.Integer({ minimum: 0, maximum: 40 }),
  mqttTopic: Type.String({ maxLength: 150 }),
  isActive: Type.Optional(Type.Boolean({ default: true })),
});

// Schema for provisioning a new device on a grow
export const CreateDeviceSchema = Type.Object({
  growCycleId: Type.String({ format: "uuid" }),
  name: Type.String({ maxLength: 100 }),
  type: DeviceTypeEnum,
  pinNumber: Type.Integer({ minimum: 0, maximum: 40 }),
  mqttTopic: Type.String({ maxLength: 150 }),
  isActive: Type.Optional(Type.Boolean({ default: true })),
});

// Schema for bulk provisioning multiple devices on a single grow
export const BatchCreateDeviceSchema = Type.Object({
  growCycleId: Type.String({ format: "uuid" }),
  devices: Type.Array(DeviceBody, { minItems: 1 }),
});

// Schema for modifying hardware parameters
export const UpdateDeviceSchema = Type.Object({
  name: Type.Optional(Type.String({ maxLength: 100 })),
  type: Type.Optional(DeviceTypeEnum),
  pinNumber: Type.Optional(Type.Integer({ minimum: 0, maximum: 40 })),
  mqttTopic: Type.Optional(Type.String({ maxLength: 150 })),
  isActive: Type.Optional(Type.Boolean()),
});

// Schema for sending a ON/OFF command to a device
export const DeviceCommandSchema = Type.Object({
  action: Type.Union([Type.Literal("ON"), Type.Literal("OFF")]),
});

export const DeviceParamsIdSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
});

export const DeviceParamsGrowCycleIdSchema = Type.Object({
  growCycleId: Type.String({ format: "uuid" }),
});
