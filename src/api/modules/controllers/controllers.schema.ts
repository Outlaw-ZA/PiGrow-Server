import { Type } from "@sinclair/typebox";

const SensorTypeSchema = Type.Union([
  Type.Literal("HUMIDITY"),
  Type.Literal("TEMPERATURE"),
  Type.Literal("TEMP_HUMIDITY"),
  Type.Literal("CO2"),
  Type.Literal("PH"),
  Type.Literal("EC"),
]);

const SensorProtocolSchema = Type.Union([
  Type.Literal("I2C"),
  Type.Literal("SPI"),
  Type.Literal("UART"),
  Type.Literal("RS485"),
]);

export const SeedSensorSchema = Type.Object({
  name: Type.String({ maxLength: 100 }),
  type: SensorTypeSchema,
  mqttTopic: Type.String({ maxLength: 200 }),
  pinNumbers: Type.Array(Type.Integer({ minimum: 0, maximum: 40 })),
  protocol: SensorProtocolSchema,
});

// Schema for registering a new physical Raspberry Pi hub
export const CreateControllerSchema = Type.Object({
  macAddress: Type.String({
    pattern: "^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$",
    description:
      "Valid standard network MAC Address string (e.g., b8:27:eb:bf:d3:42)",
  }),
  name: Type.String({
    maxLength: 100,
    description:
      "Descriptive label for identifying the tent deployment location",
  }),
  ipAddress: Type.String({
    format: "ipv4",
    description: "The local network IP of the active Raspberry Pi client node",
  }),
  sensors: Type.Optional(
    Type.Array(SeedSensorSchema, {
      description:
        "Optional list of physical sensors to seed on the controller at registration time. Sensors can be added, updated, or removed later via the /api/sensors endpoints.",
    }),
  ),
});

// Schema for updating basic server-side hub parameters
export const UpdateControllerSchema = Type.Object({
  name: Type.Optional(Type.String({ maxLength: 100 })),
  status: Type.Optional(
    Type.Union([
      Type.Literal("ONLINE"),
      Type.Literal("OFFLINE"),
      Type.Literal("ERROR"),
    ]),
  ),
});

export const ControllerParamsIdSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
});

// Schema for Pi status heartbeat reporting
export const HeartbeatSchema = Type.Object({
  status: Type.Union([Type.Literal("ONLINE"), Type.Literal("OFFLINE")]),
});
