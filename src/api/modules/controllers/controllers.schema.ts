import { Type } from '@sinclair/typebox'
import { ErrorSchema } from '../../shared/schemas.js'

const SensorTypeSchema = Type.Union([
  Type.Literal('HUMIDITY'),
  Type.Literal('TEMPERATURE'),
  Type.Literal('TEMP_HUMIDITY'),
  Type.Literal('CO2'),
  Type.Literal('PH'),
  Type.Literal('EC'),
])

const SensorProtocolSchema = Type.Union([
  Type.Literal('I2C'),
  Type.Literal('SPI'),
  Type.Literal('UART'),
  Type.Literal('RS485'),
])

const PeriodSchema = Type.Union([Type.Literal('DAY'), Type.Literal('NIGHT')])

const NullableNumber = Type.Optional(Type.Union([Type.Number(), Type.Null()]))

const PhaseEnvironmentSchema = Type.Object({
  co2Max: NullableNumber,
  co2Min: NullableNumber,
  co2Target: NullableNumber,
  createdAt: Type.String({ format: 'date-time' }),
  growPhaseId: Type.String({ format: 'uuid' }),
  humidityMax: NullableNumber,
  humidityMin: NullableNumber,
  humidityTarget: NullableNumber,
  id: Type.String({ format: 'uuid' }),
  period: PeriodSchema,
  tempMax: NullableNumber,
  tempMin: NullableNumber,
  tempTarget: NullableNumber,
  updatedAt: Type.String({ format: 'date-time' }),
})

const GrowPhaseSchema = Type.Object({
  createdAt: Type.String({ format: 'date-time' }),
  dayDurationMinutes: Type.Integer(),
  dayStartMinutes: Type.Integer(),
  durationDays: Type.Integer(),
  endAt: Type.Union([Type.String({ format: 'date' }), Type.Null()]),
  environments: Type.Optional(Type.Array(PhaseEnvironmentSchema)),
  growCycleId: Type.String({ format: 'uuid' }),
  id: Type.String({ format: 'uuid' }),
  isActive: Type.Boolean(),
  name: Type.String(),
  order: Type.Integer(),
  startAt: Type.Union([Type.String({ format: 'date' }), Type.Null()]),
  updatedAt: Type.String({ format: 'date-time' }),
})

const GrowCycleSchema = Type.Object({
  controllerId: Type.String({ format: 'uuid' }),
  createdAt: Type.String({ format: 'date-time' }),
  id: Type.String({ format: 'uuid' }),
  isActive: Type.Boolean(),
  name: Type.String(),
  startAt: Type.Union([Type.String({ format: 'date' }), Type.Null()]),
  updatedAt: Type.String({ format: 'date-time' }),
})

const DeviceSchema = Type.Object({
  automationMode: Type.Union([
    Type.Literal('MANUAL'),
    Type.Literal('SCHEDULED'),
    Type.Literal('THRESHOLD'),
    Type.Literal('ALWAYS_ON'),
    Type.Literal('ALWAYS_OFF'),
  ]),
  controllerId: Type.String({ format: 'uuid' }),
  createdAt: Type.String({ format: 'date-time' }),
  id: Type.String({ format: 'uuid' }),
  isActive: Type.Boolean(),
  maxOnSeconds: Type.Optional(Type.Union([Type.Integer(), Type.Null()])),
  name: Type.String(),
  pinNumber: Type.Integer(),
  type: Type.Union([
    Type.Literal('LIGHT'),
    Type.Literal('EXHAUST_FAN'),
    Type.Literal('INTAKE_FAN'),
    Type.Literal('CIRCULATION_FAN'),
    Type.Literal('WATER_PUMP'),
    Type.Literal('AIR_CONDITIONER'),
    Type.Literal('HEATER'),
    Type.Literal('HUMIDIFIER'),
    Type.Literal('DEHUMIDIFIER'),
    Type.Literal('CO2_INJECTOR'),
  ]),
  updatedAt: Type.String({ format: 'date-time' }),
})

const SensorSchema = Type.Object({
  controllerId: Type.String({ format: 'uuid' }),
  createdAt: Type.String({ format: 'date-time' }),
  id: Type.String({ format: 'uuid' }),
  lastActive: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  name: Type.String(),
  pinNumbers: Type.Array(Type.Integer()),
  protocol: SensorProtocolSchema,
  type: SensorTypeSchema,
  updatedAt: Type.String({ format: 'date-time' }),
})

export const ControllerResponseSchema = Type.Object({
  createdAt: Type.String({ format: 'date-time' }),
  id: Type.String({ format: 'uuid' }),
  ipAddress: Type.String(),
  macAddress: Type.String(),
  name: Type.String(),
  status: Type.String({
    description: 'Controller reachability. One of "ONLINE" | "OFFLINE" | "ERROR".',
  }),
  updatedAt: Type.String({ format: 'date-time' }),
})

export const ControllerDetailResponseSchema = Type.Object({
  ...ControllerResponseSchema.properties,
  devices: Type.Optional(Type.Array(DeviceSchema)),
  growCycles: Type.Optional(
    Type.Array(
      Type.Object({
        ...GrowCycleSchema.properties,
        phases: Type.Optional(Type.Array(GrowPhaseSchema)),
      }),
    ),
  ),
  sensors: Type.Optional(Type.Array(SensorSchema)),
})

export const ControllersArrayResponseSchema = Type.Array(ControllerResponseSchema)

export const ControllerCreateResponseSchema = Type.Object({
  ...ControllerResponseSchema.properties,
  sensors: Type.Optional(Type.Array(SensorSchema)),
})

export const SeedSensorSchema = Type.Object({
  name: Type.String({ maxLength: 100 }),
  pinNumbers: Type.Array(Type.Integer({ maximum: 40, minimum: 0 })),
  protocol: SensorProtocolSchema,
  type: SensorTypeSchema,
})

// Schema for registering a new physical Raspberry Pi hub
export const CreateControllerSchema = Type.Object({
  ipAddress: Type.String({
    description: 'The local network IP of the active Raspberry Pi client node',
    format: 'ipv4',
  }),
  macAddress: Type.String({
    description: 'Valid standard network MAC Address string (e.g., b8:27:eb:bf:d3:42)',
    pattern: '^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$',
  }),
  name: Type.String({
    description: 'Descriptive label for identifying the tent deployment location',
    maxLength: 100,
  }),
  sensors: Type.Optional(
    Type.Array(SeedSensorSchema, {
      description:
        'Optional list of physical sensors to seed on the controller at registration time. Sensors can be added, updated, or removed later via the /api/sensors endpoints.',
    }),
  ),
})

// Schema for updating basic server-side hub parameters
export const UpdateControllerSchema = Type.Object({
  name: Type.Optional(Type.String({ maxLength: 100 })),
  status: Type.Optional(
    Type.Union([Type.Literal('ONLINE'), Type.Literal('OFFLINE'), Type.Literal('ERROR')]),
  ),
})

export const ControllerParamsIdSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
})

// Schema for Pi status heartbeat reporting
export const HeartbeatSchema = Type.Object({
  status: Type.Union([Type.Literal('ONLINE'), Type.Literal('OFFLINE')]),
})

export { ErrorSchema }
