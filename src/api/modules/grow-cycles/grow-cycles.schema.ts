import { Type } from "@sinclair/typebox";

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

// Reusable device item shape for the grow-create payload.
const GrowDeviceItem = Type.Object({
  name: Type.String({ maxLength: 100 }),
  type: DeviceTypeEnum,
  pinNumber: Type.Integer({ minimum: 0, maximum: 40 }),
  mqttTopic: Type.String({ maxLength: 150 }),
  isActive: Type.Optional(Type.Boolean({ default: true })),
});

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
  devices: Type.Array(GrowDeviceItem, {
    description:
      "Hardware devices to provision for this grow. Each device is scoped to this grow only and cannot be seen by other grows on the same controller.",
  }),
});

// Schema for updating an existing GrowCycle (all body fields optional)
// controllerId is intentionally NOT allowed — a grow is bound to its controller for life.
export const UpdateGrowCycleSchema = Type.Object({
  name: Type.Optional(Type.String({ maxLength: 100 })),
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

// Schema for the optional query string on POST /grow-cycles/:id/skip-phase
export const SkipPhaseQuerySchema = Type.Object({
  today: Type.Optional(
    Type.String({
      format: "date",
      description:
        "Optional override for today's date (YYYY-MM-DD). Useful for timezone-correct skip operations; defaults to server UTC today.",
    }),
  ),
});
