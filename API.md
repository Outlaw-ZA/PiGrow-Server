# PiGrow REST API Reference

Base URL: `http://<host>:4000`

All IDs are UUIDv4 strings. Request bodies are JSON. All timestamps are ISO 8601.

---

## Controllers (Raspberry Pi Hubs)

### `GET /api/controllers`
List all registered controllers.

**Response `200`** — Array of:
```ts
{
  id: string;
  macAddress: string;    // e.g. "AA:BB:CC:DD:EE:FF"
  ipAddress: string;     // e.g. "192.168.1.100"
  name: string;          // e.g. "Tent 1 Pi"
  status: "ONLINE" | "OFFLINE" | "ERROR";
  createdAt: string;     // ISO 8601
  updatedAt: string;     // ISO 8601
}
```

### `GET /api/controllers/:id`
Get a controller with its devices and active grow cycles.

**Response `200`** — Controller plus:
```ts
{
  // ...all Controller fields above...
  devices: Device[];               // Full Device objects (see Device section)
  growCycles: GrowCycle[];         // Only cycles where isActive === true
  // Each growCycle includes: phases (only phases where isActive === true)
}
```
**`404`** — `{ error: "Raspberry Pi configuration profile not found" }`

### `POST /api/controllers`
Register a new controller (upserts by macAddress).

**Request body:**
```ts
{
  macAddress: string;  // Pattern: ^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$
  name: string;        // max 100 chars
  ipAddress: string;   // IPv4 format
}
```

**Response `201`** — Full Controller object (with `status: "OFFLINE"` default).
**`400`** — `{ error: "Failed to map controller network identity" }`

### `PUT /api/controllers/:id`
Update controller name or status.

**Request body:**
```ts
{
  name?: string;                   // max 100 chars
  status?: "ONLINE" | "OFFLINE" | "ERROR";
}
```

**Response `200`** — Updated Controller object.
**`400`** — `{ error: "Unable to reconcile device parameters" }`

### `DELETE /api/controllers/:id`
Remove a controller.

**Response `204`** — No body.
**`404`** — `{ error: "Profile unlinking rejected" }`

---

## Devices (GPIO Hardware)

### `GET /api/devices/controller/:controllerId`
List all devices assigned to a specific controller.

**Response `200`** — Array of:
```ts
{
  id: string;
  controllerId: string;
  name: string;                    // e.g. "SpiderFarmer SF2000"
  type: DeviceType;
  pinNumber: number;               // 0-40 (GPIO pin)
  mqttTopic: string;               // e.g. "tent1/device/light/cmd"
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
```
Where `DeviceType` is one of:
`"LIGHT" | "EXHAUST_FAN" | "INTAKE_FAN" | "CIRCULATION_FAN" | "WATER_PUMP" | "AIR_CONDITIONER" | "HEATER" | "HUMIDIFIER" | "DEHUMIDIFIER" | "CO2_INJECTOR"`

**`400`** — `{ error: "Failed to load hardware profiles" }`

### `GET /api/device/:id`
Get a single device with its controller and device configs.

**Response `200`** — Device plus:
```ts
{
  // ...all Device fields above...
  controller: Controller;          // Full Controller object
  deviceConfigs: DeviceConfig[];   // All DeviceConfig objects for this device
}
```
**`404`** — `{ error: "Physical hardware device not found" }`

### `POST /api/device`
Provision a new device.

**Request body:**
```ts
{
  controllerId: string;   // UUID
  name: string;           // max 100 chars
  type: DeviceType;       // see above
  pinNumber: number;      // integer 0-40
  mqttTopic: string;      // max 150 chars
  isActive?: boolean;     // default: true
}
```

**Response `201`** — Full Device object.
**`400`** — `{ error: "Failed to map new hardware device" }`

### `PUT /api/device/:id`
Update device configuration.

**Request body:**
```ts
{
  name?: string;
  type?: DeviceType;
  pinNumber?: number;      // 0-40
  mqttTopic?: string;      // max 150 chars
  isActive?: boolean;
}
```

**Response `200`** — Updated Device object.
**`400`** — `{ error: "Hardware parameter update rejected" }`

### `DELETE /api/device/:id`
Remove a device.

**Response `204`** — No body.
**`404`** — `{ error: "Hardware profile deletion failed" }`

---

## Grow Cycles

### `GET /api/grow-cycles`
List all grow cycles (includes basic controller info).

**Response `200`** — Array of:
```ts
{
  id: string;
  controllerId: string;
  name: string;
  isActive: boolean;
  startAt: string | null;        // Date only: "YYYY-MM-DD" (no timestamp)
  createdAt: string;
  updatedAt: string;
  controller: {
    name: string;
    status: "ONLINE" | "OFFLINE" | "ERROR";
  };
}
```

### `GET /api/grow-cycles/:id`
Get a grow cycle with full nested details (phases, device configs, devices).

**Response `200`** — GrowCycle plus:
```ts
{
  // ...all GrowCycle fields above...
  controller: Controller;          // Full Controller object
  phases: {
    id: string;
    growCycleId: string;
    name: string;
    order: number;
    durationDays: number;
    isActive: boolean;
    startAt: string | null;        // Date only: "YYYY-MM-DD"
    endAt: string | null;          // Date only: "YYYY-MM-DD"
    createdAt: string;
    updatedAt: string;
    deviceConfigs: {
      id: string;
      growPhaseId: string;
      deviceId: string;
      triggerType: TriggerType;
      configData: Record<string, unknown>;  // JSON payload
      createdAt: string;
      updatedAt: string;
      device: Device;              // Full Device object
    }[];
  }[];
}
```
Where `TriggerType` is: `"SCHEDULE" | "THRESHOLD" | "ALWAYS_ON" | "ALWAYS_OFF"`

**`404`** — `{ error: "Grow cycle record not found" }`

### `POST /api/grow-cycles`
Create a new grow cycle. **Auto-generates 4 default phases** with device configs based on the controller's active devices.

**Request body:**
```ts
{
  name: string;           // max 100 chars
  controllerId: string;   // UUID
  isActive?: boolean;     // default: false
}
```

**Default phases created automatically:**

| # | Phase Name | Duration | Light Config | Exhaust Config | Pump Config |
|---|---|---|---|---|---|
| 1 | Seedling / Clone | 14d | SCHEDULE, 18h on @06:00 | THRESHOLD, TEMP > 25°C | — |
| 2 | Vegetative Stage | 30d | SCHEDULE, 22h on @06:00 | THRESHOLD, TEMP > 26.5°C | — |
| 3 | Flowering / Bloom | 60d | SCHEDULE, 12h on @06:00 | THRESHOLD, TEMP > 26°C | — |
| 4 | Curing / Harvest | 7d | ALWAYS_OFF | — | ALWAYS_OFF |

Configs are only created if the controller has an active device of the corresponding type.

**Response `201`** — Full GrowCycle with nested phases and deviceConfigs (same shape as `GET /:id`).
**`400`** — `{ error: "Failed to create grow cycle record" }`

### `PUT /api/grow-cycles/:id`
Update a grow cycle.

**Request body:**
```ts
{
  name?: string;
  controllerId?: string;
  isActive?: boolean;
  startAt?: string;              // Date only: "YYYY-MM-DD" (no timestamp). Date-time strings are rejected.
}
```

**Response `200`** — Updated GrowCycle (without nested relations).
**`400`** — `{ error: "Failed to update grow cycle record" }`

### `DELETE /api/grow-cycles/:id`
Delete a grow cycle (cascades to phases, device configs, and telemetry).

**Response `204`** — No body.
**`404`** — `{ error: "Record could not be deleted" }`

---

## Grow Phases

### `GET /api/grow-phases/cycle/:growCycleId`
List all phases for a grow cycle (includes device configs).

**Response `200`** — Array of:
```ts
{
  id: string;
  growCycleId: string;
  name: string;
  order: number;
  durationDays: number;
  isActive: boolean;
  startAt: string | null;        // Date only: "YYYY-MM-DD"
  endAt: string | null;          // Date only: "YYYY-MM-DD"
  createdAt: string;
  updatedAt: string;
  deviceConfigs: {
    id: string;
    growPhaseId: string;
    deviceId: string;
    triggerType: TriggerType;
    configData: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
    device: Device;              // Full Device object
  }[];
}
```
**`400`** — `{ error: "Failed to retrieve phases for this cycle" }`

### `GET /api/grow-phases/:id`
Get a single phase with device configs.

**Response `200`** — Same shape as individual phase above.
**`404`** — `{ error: "Grow phase record not found" }`

### `POST /api/grow-phases`
Create a custom phase.

**Request body:**
```ts
{
  growCycleId: string;    // UUID
  name: string;           // max 100 chars
  order: number;          // integer >= 1
  durationDays: number;   // integer >= 1
  isActive?: boolean;     // default: false
  startAt?: string;       // Date only: "YYYY-MM-DD" (no timestamp). Date-time strings are rejected.
  endAt?: string;         // Date only: "YYYY-MM-DD" (no timestamp). Date-time strings are rejected.
}
```

**Response `201`** — Full GrowPhase object (without deviceConfigs).
**`400`** — `{ error: "Failed to create grow phase record" }`

### `PUT /api/grow-phases/:id`
Update a phase.

**Request body:**
```ts
{
  name?: string;
  order?: number;          // >= 1
  durationDays?: number;   // >= 1
  isActive?: boolean;
  startAt?: string;        // Date only: "YYYY-MM-DD" (no timestamp). Date-time strings are rejected.
  endAt?: string;          // Date only: "YYYY-MM-DD" (no timestamp). Date-time strings are rejected.
}
```

**Response `200`** — Updated GrowPhase object.
**`400`** — `{ error: "Failed to update grow phase record" }`

### `DELETE /api/grow-phases/:id`
Delete a phase.

**Response `204`** — No body.
**`404`** — `{ error: "Record could not be deleted" }`

---

## Device Configs

A `DeviceConfig` is the rule that ties a physical `Device` to a `GrowPhase` — it controls when and how the device is triggered. Device configs are created both by grow-cycle auto-generation (see `POST /api/grow-cycles`) and via the standalone endpoints below.

### Model

```ts
{
  id: string;
  growPhaseId: string;            // UUID
  deviceId: string;               // UUID
  triggerType: "SCHEDULE" | "THRESHOLD" | "ALWAYS_ON" | "ALWAYS_OFF";
  configData: ConfigData;         // Discriminated union — shape depends on triggerType
  createdAt: string;
  updatedAt: string;
  device: Device;                 // Full Device object (included in all read responses)
}
```

### `configData` shapes (discriminated union by `triggerType`)

The API accepts **multiple known variants** for each trigger type for backwards compatibility with data already in the database. New clients should prefer the canonical (auto-generated) form.

| `triggerType` | Canonical form | Alternative form (also accepted) |
|---|---|---|
| `SCHEDULE` | `{ onTime: "06:00", durationHours: 18 }` | `{ onTime: "06:00", offTime: "00:00" }` |
| `THRESHOLD` | `{ metric: "TEMP", high: 26.5 }` | `{ sensor: "TEMPERATURE", condition: "GREATER_THAN", value: 26.5, action: "ON" }` |
| `ALWAYS_ON` | `{}` | any object (lenient — extra keys ignored) |
| `ALWAYS_OFF` | `{}` | any object (lenient — extra keys ignored) |

- `onTime` / `offTime` must match `^([01][0-9]|2[0-3]):[0-5][0-9]$` (24h `HH:MM`).
- `durationHours` must be a number in `[0.1, 24]`.
- `condition` must be one of: `"GREATER_THAN" | "LESS_THAN" | "GREATER_THAN_OR_EQUAL" | "LESS_THAN_OR_EQUAL" | "EQUAL"`.
- `action` must be one of: `"ON" | "OFF" | "TOGGLE"`.

### `GET /api/device-configs/phase/:phaseId`

List all device configs for a phase. Always includes the full `device` object on each entry.

**Response `200`** — Array of `DeviceConfig` (with nested `device`), ordered by `createdAt` ascending.

**`400`** — `{ error: "Failed to load device configurations" }`

### `GET /api/device-configs/:id`

Fetch a single device config by ID.

**Response `200`** — `DeviceConfig` (with nested `device`).

**`404`** — `{ error: "Device configuration not found" }`

### `POST /api/device-configs`

Create a device config linking a device to a phase with a trigger rule.

**Request body** (discriminated by `triggerType`):

```ts
// SCHEDULE — one of:
{ growPhaseId: string; deviceId: string; triggerType: "SCHEDULE";
  configData: { onTime: "06:00"; durationHours: 18 } }
| { growPhaseId: string; deviceId: string; triggerType: "SCHEDULE";
  configData: { onTime: "06:00"; offTime: "00:00" } }

// THRESHOLD — one of:
| { growPhaseId: string; deviceId: string; triggerType: "THRESHOLD";
  configData: { metric: "TEMP"; high: 26.5 } }
| { growPhaseId: string; deviceId: string; triggerType: "THRESHOLD";
  configData: { sensor: "TEMPERATURE"; condition: "GREATER_THAN"; value: 26.5; action: "ON" } }

// ALWAYS_ON / ALWAYS_OFF — any object (lenient)
| { growPhaseId: string; deviceId: string; triggerType: "ALWAYS_ON" | "ALWAYS_OFF";
  configData: Record<string, unknown> }
```

**Response `201`** — Created `DeviceConfig` (with nested `device`).

**`400`** — `{ error: "Failed to create device configuration" }` — returned for any validation failure (unknown `triggerType`, missing `configData` fields, bad time format, non-UUID IDs, etc.) or DB error.

### `PUT /api/device-configs/:id`

Update a device config's trigger rule. **`triggerType` and `configData` must be sent together** as a consistent pair — partial updates are rejected.

- `growPhaseId` and `deviceId` are **immutable** after creation. To move a config to a different phase or device, delete and recreate it.

**Request body** — same shape as `POST` minus `growPhaseId` and `deviceId`.

**Response `200`** — Updated `DeviceConfig` (with nested `device`).

**`400`** — `{ error: "Failed to update device configuration" }` — validation or DB error.

### `DELETE /api/device-configs/:id`

Remove a device config.

**Response `204`** — No body.

**`404`** — `{ error: "Device configuration deletion failed" }`

---

---

## Telemetry

> **Note:** Telemetry has no REST endpoints. Data flows from Raspberry Pi → MQTT → Server → Socket.IO broadcast to frontend.

### MQTT Ingestion

- Pi publishes to: `devices/<deviceId>/telemetry`
- Backend subscribed to: `devices/+/telemetry`
- Payload fields: `temperature` (float), `humidity` (float)

### Socket.IO Events

| Event | Direction | Payload |
|---|---|---|
| `ui_command` | Frontend → Server | `{ deviceId: string, action: string, pin: number }` |
| `frontend_telemetry` | Server → Frontend | Broadcasts parsed telemetry to all connected UI clients |

---

## Error Response Format

All error responses return:
```ts
{ error: string }
```

A `404` is returned when a resource by ID is not found. A `400` is returned for validation or database operation failures.

---

## TypeScript Types Summary (for FE)

```ts
// Enums
type DeviceType = "LIGHT" | "EXHAUST_FAN" | "INTAKE_FAN" | "CIRCULATION_FAN"
  | "WATER_PUMP" | "AIR_CONDITIONER" | "HEATER" | "HUMIDIFIER"
  | "DEHUMIDIFIER" | "CO2_INJECTOR";

type TriggerType = "SCHEDULE" | "THRESHOLD" | "ALWAYS_ON" | "ALWAYS_OFF";

// Models
interface Controller {
  id: string;
  macAddress: string;
  ipAddress: string;
  name: string;
  status: "ONLINE" | "OFFLINE" | "ERROR";
  createdAt: string;
  updatedAt: string;
}

interface Device {
  id: string;
  controllerId: string;
  name: string;
  type: DeviceType;
  pinNumber: number;
  mqttTopic: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface GrowCycle {
  id: string;
  controllerId: string;
  name: string;
  isActive: boolean;
  startAt: string | null;        // Date only: "YYYY-MM-DD" (no timestamp)
  createdAt: string;
  updatedAt: string;
}

interface GrowPhase {
  id: string;
  growCycleId: string;
  name: string;
  order: number;
  durationDays: number;
  isActive: boolean;
  startAt: string | null;    // Date only: "YYYY-MM-DD"
  endAt: string | null;      // Date only: "YYYY-MM-DD"
  createdAt: string;
  updatedAt: string;
}

interface DeviceConfig {
  id: string;
  growPhaseId: string;
  deviceId: string;
  triggerType: TriggerType;
  configData: ConfigData;       // Discriminated union — see below
  createdAt: string;
  updatedAt: string;
  device: Device;               // Always included in API responses
}

// Discriminated union — narrow with `deviceConfig.triggerType`
type ConfigData =
  | { triggerType: "SCHEDULE"; configData: { onTime: string; durationHours: number } | { onTime: string; offTime: string } }
  | { triggerType: "THRESHOLD"; configData: { metric: string; high: number } | { sensor: string; condition: "GREATER_THAN" | "LESS_THAN" | "GREATER_THAN_OR_EQUAL" | "LESS_THAN_OR_EQUAL" | "EQUAL"; value: number; action: "ON" | "OFF" | "TOGGLE" } }
  | { triggerType: "ALWAYS_ON" | "ALWAYS_OFF"; configData: Record<string, unknown> };

// Helper to access the typed configData given a triggerType
type ConfigDataFor<T extends TriggerType> = Extract<ConfigData, { triggerType: T }>["configData"];

interface Telemetry {
  id: string;
  growCycleId: string;
  sensorType: string;     // "TEMPERATURE" | "HUMIDITY" | "CO2" | "PH" | "EC"
  value: number;
  createdAt: string;
}
```
