# PiGrow REST API Reference

Base URL: `http://<host>:4000`

All IDs are UUIDv4 strings. Request bodies are JSON. All timestamps are ISO 8601.

---

## Automation overview

PiGrow's automation engine drives a controller's physical relays from three pieces of configuration:

1. **Devices** are persistent hardware (light, fan, heater, humidifier, etc.) attached to a `Controller`. They survive grow cycles; the same physical light stays wired to the same Pi across every grow.
2. **Grow Phases** carry a day/night clock schedule (`dayStartMinutes`, `dayDurationMinutes`) and a per-phase `PhaseEnvironment` row per period (`DAY` / `NIGHT`) holding environmental thresholds (temp, humidity, CO2).
3. **Automation Rules** link a device to a watch condition. Rules can be scoped to a phase (preferred) or a cycle, and fire when a rule's condition is met against the active phase's environment or the current clock period.

The engine itself is split into two paths:

- **Automation scheduler** (60-second tick): resolves the current day/night period from the active grow phase's clock schedule and (a) drives every `LIGHT` device on the controller to match the period, and (b) enforces enabled `ALWAYS_ON` / `ALWAYS_OFF` rules scoped to the active phase or cycle. Device-level `automationMode` (e.g. `MANUAL`, `ALWAYS_ON`) is the global override and always wins.
- **Threshold evaluator** (`ABOVE_MAX` / `BELOW_MIN` rules): runs on every persisted telemetry row; for the active phase + current period, reads `PhaseEnvironment.*Max` / `*Min` for the watched sensor type and fires the rule's action if the latest reading crosses the boundary. If an enabled `ALWAYS_ON` / `ALWAYS_OFF` rule covers the same `(device, scope, period)`, threshold rules for that device in that scope + period are suppressed.

Both paths consult the latest `DeviceStateLog` row for a device to enforce hysteresis — they never issue a command that matches the device's already-confirmed state. Closed-loop feedback is delivered by the Pi publishing `devices/<id>/state`; that handler reconciles `Device.isActive` and writes a `DeviceStateLog source:"AUTO"` row that becomes the source of truth for the next evaluation.

Historical grow cycles (`isActive = false`) keep all telemetry, device-state logs, and rules — they are not removed by ending a grow. No rules fire for a non-active cycle, so historical data is read-only and stable.

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
Get a controller with its active grow cycle (with the active phase and its environment), persistent device inventory, and sensor inventory.

**Response `200`** — Controller plus:
```ts
{
  // ...all Controller fields above...
  devices: Device[];               // Persistent hardware attached to this Pi (see Device section)
  growCycles: GrowCycle[];         // Only cycles where isActive === true
  // Each growCycle includes: phases (only phases where isActive === true),
  //                          and each phase includes: environments (DAY + NIGHT rows)
  sensors: Sensor[];               // Physical sensors wired to this Pi (see Sensors section)
}
```
**`404`** — `{ error: "Raspberry Pi configuration profile not found" }`

### `POST /api/controllers`
Register a new controller. Upserts by `macAddress` (re-registering an existing hub updates only the `name`; sensor inventory is never mutated by re-registration). When a new controller is created, you may seed an initial set of sensors in the same call.

**Request body:**
```ts
{
  macAddress: string;  // Pattern: ^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$
  name: string;        // max 100 chars
  ipAddress: string;   // IPv4 format
  sensors?: {          // optional — only applied on a fresh create
    name: string;
    type: SensorType;
    mqttTopic: string;       // max 200 chars
    pinNumbers: number[];     // 0-40 per entry
    protocol: SensorProtocol;
  }[];
}
```

**Response `201`** — Full Controller object (with `status: "OFFLINE"` default). On a fresh create, the response **includes the nested `sensors` array**.
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

### `PATCH /api/controllers/:id/heartbeat`
Update status reported by the Pi (ONLINE / OFFLINE).

**Request body:**
```ts
{ status: "ONLINE" | "OFFLINE"; }
```
**Response `200`** — Updated Controller object.
**`404`** — `{ error: "Controller not found for heartbeat update" }`

---

## Devices (GPIO Hardware)

A `Device` is a physical relay/actuator wired to a `Controller` (a light, fan, heater, humidifier, etc.). Devices are owned by the **Controller** and survive grow cycles — the same physical light stays wired to the same Pi across sequential grows. Grow cycles reference devices via `AutomationRule.deviceId`, not via a direct FK.

### Model

```ts
{
  id: string;
  controllerId: string;     // UUID of the parent Controller
  name: string;             // e.g. "SpiderFarmer SF2000", "AC Infinity T6"
  type: DeviceType;         // see below
  pinNumber: number;        // 0-40 (GPIO pin / relay channel)
  mqttTopic: string;        // max 150 chars
  automationMode: AutomationMode; // see below (default MANUAL)
  isActive: boolean;        // Server-tracked current relay state (last command issued / confirmed)
  createdAt: string;
  updatedAt: string;
}
```

`DeviceType` is one of:
`"LIGHT" | "EXHAUST_FAN" | "INTAKE_FAN" | "CIRCULATION_FAN" | "WATER_PUMP" | "AIR_CONDITIONER" | "HEATER" | "HUMIDIFIER" | "DEHUMIDIFIER" | "CO2_INJECTOR"`

`AutomationMode` is one of:
| Value | Meaning |
|---|---|
| `"MANUAL"` | No automation; only REST / Socket.IO commands. |
| `"SCHEDULED"` | Driven by the day/night clock (typical for `LIGHT`). |
| `"THRESHOLD"` | Evaluated against the active phase's `PhaseEnvironment` (typical for `HEATER`, fans, humidifier, CO2). |
| `"ALWAYS_ON"` | Pinned ON for the duration of the active grow. |
| `"ALWAYS_OFF"` | Pinned OFF (override). |

### `GET /api/devices/controller/:controllerId`
List all devices attached to a specific controller, ordered by `pinNumber` ascending.

**Response `200`** — Array of `Device`.
**`400`** — `{ error: "Failed to load hardware profiles" }`

### `GET /api/devices/:id`
Get a single device.

**Response `200`** — `Device` object.
**`404`** — `{ error: "Physical hardware device not found" }`

### `POST /api/devices`
Provision a new device on a controller.

**Request body:**
```ts
{
  controllerId: string;        // UUID
  name: string;                // max 100 chars
  type: DeviceType;
  pinNumber: number;           // integer 0-40
  mqttTopic: string;           // max 150 chars
  automationMode?: AutomationMode; // default MANUAL
  isActive?: boolean;          // default true
}
```

**Response `201`** — Full `Device` object.
**`400`** — `{ error: "Failed to map new hardware device" }`

### `POST /api/devices/batch`
Bulk-provision multiple devices on a single controller.

**Request body:**
```ts
{
  controllerId: string;        // UUID
  devices: {
    name: string;              // max 100 chars
    type: DeviceType;
    pinNumber: number;         // 0-40
    mqttTopic: string;         // max 150 chars
    automationMode?: AutomationMode;
    isActive?: boolean;        // default true
  }[];                          // min 1
}
```

**Response `201`** — Array of created `Device` objects.
**`400`** — `{ error: "Failed to map batch hardware devices" }`

### `PUT /api/devices/:id`
Update device configuration. `controllerId` is **immutable** (delete + recreate to move a device to a different Pi).

**Request body:**
```ts
{
  name?: string;
  type?: DeviceType;
  pinNumber?: number;          // 0-40
  mqttTopic?: string;          // max 150 chars
  automationMode?: AutomationMode;
  isActive?: boolean;
}
```

**Response `200`** — Updated `Device` object.
**`400`** — `{ error: "Hardware parameter update rejected" }`

### `DELETE /api/devices/:id`
Remove a device. **Cascades** to all `DeviceStateLog` rows and all `AutomationRule` rows attached to it.

**Response `204`** — No body.
**`404`** — `{ error: "Hardware profile deletion failed" }`

### `POST /api/devices/:id/command`
Send an immediate ON/OFF command (source = `MANUAL`).

**Request body:**
```ts
{ action: "ON" | "OFF"; }
```

**Side effects (single transaction):**
- `Device.isActive` updated to match the action.
- A `DeviceStateLog` row is written with `source: "MANUAL"`.
- The server publishes an MQTT command to `devices/<id>/commands` with payload `{ action, pin, timestamp }`.

**Response `200`** — `{ deviceId, action, timestamp }`.
**`404`** — `{ error: "Device command dispatch failed" }`

---

## Sensors

A `Sensor` is a physical probe wired to a specific Raspberry Pi (`Controller`). Each reading produced by a probe is persisted as a `Telemetry` row linked to that sensor.

### Model

```ts
{
  id: string;
  controllerId: string;          // UUID of the parent Pi
  name: string;                  // e.g. "DHT22 Ambient"
  type: SensorType;              // see below
  mqttTopic: string;             // e.g. "tent1/sensor/ambient"  (max 200 chars)
  pinNumbers: number[];          // GPIO / bus pins used (0-40)
  protocol: SensorProtocol;      // I2C | SPI | UART | RS485
  lastActive: string | null;     // ISO 8601; updated on every MQTT reading
  createdAt: string;             // ISO 8601
  updatedAt: string;             // ISO 8601
}
```

`SensorType` is one of:
`"HUMIDITY" | "TEMPERATURE" | "TEMP_HUMIDITY" | "CO2" | "PH" | "EC"`

`SensorProtocol` is one of:
`"I2C" | "SPI" | "UART" | "RS485"`

### `GET /api/sensors/controller/:controllerId`
List all sensors attached to a specific controller, ordered by `createdAt` ascending.

**Response `200`** — Array of `Sensor`.

**`400`** — `{ error: "Failed to load sensor inventory" }`

### `GET /api/sensors/:id`
Fetch a single sensor with a slim parent-controller summary.

**Response `200`** — `Sensor` plus:
```ts
{
  controller: { id: string; name: string; status: "ONLINE" | "OFFLINE" | "ERROR" };
}
```
**`404`** — `{ error: "Sensor not found" }`

### `POST /api/sensors`
Provision a new sensor on an existing controller.

**Request body:**
```ts
{
  controllerId: string;          // UUID of the parent Controller
  name: string;                  // max 100 chars
  type: SensorType;
  mqttTopic: string;             // max 200 chars
  pinNumbers: number[];          // 0-40 per entry; empty array allowed
  protocol: SensorProtocol;
}
```

**Response `201`** — Full `Sensor` object (`lastActive` is `null` until the first MQTT reading arrives).
**`400`** — `{ error: "Failed to register sensor" }`

### `PUT /api/sensors/:id`
Update a sensor. All fields are optional; only provided fields are updated. `controllerId` is **immutable** (delete + recreate to move a sensor to a different Pi).

**Request body:**
```ts
{
  name?: string;
  type?: SensorType;
  mqttTopic?: string;
  pinNumbers?: number[];
  protocol?: SensorProtocol;
  lastActive?: string;           // ISO 8601; normally server-managed
}
```

**Response `200`** — Updated `Sensor` object.
**`400`** — `{ error: "Failed to update sensor configuration" }`

### `DELETE /api/sensors/:id`
Remove a sensor. **Cascades** to all telemetry rows associated with the sensor (historical data for that probe is lost).

**Response `204`** — No body.
**`404`** — `{ error: "Sensor deletion failed" }`

---

## Grow Cycles

### `GET /api/grow-cycles`
List all grow cycles (includes basic controller info). Historical (`isActive = false`) cycles are included — they remain in the database for retrospective review.

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
Get a grow cycle with full nested details (phases, each phase's environment rows). **Devices are not included** here — devices are owned by the controller (see `GET /api/devices/controller/:controllerId`).

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
    dayStartMinutes: number;       // 0..1440 — minutes-from-midnight the photoperiod DAY begins
    dayDurationMinutes: number;    // 0..1440 — how long the day lasts
    createdAt: string;
    updatedAt: string;
    environments: PhaseEnvironment[]; // up to 2 rows: period = DAY or NIGHT
  }[];
}
```

**`404`** — `{ error: "Grow cycle record not found" }`

### `POST /api/grow-cycles`
Create a new grow cycle. Phases are **not** auto-generated — create them separately via `POST /api/grow-phases`. Devices are **not** provisioned here — devices are owned by the controller, not the cycle (see `POST /api/devices`).

**Request body:**
```ts
{
  name: string;           // max 100 chars
  controllerId: string;   // UUID
  isActive?: boolean;     // default: false
}
```

**Response `201`** — Full GrowCycle with nested phases and their environments.
**`400`** — `{ error: "Failed to create grow cycle record" }`
**`409`** — `{ error: "Controller already has an active grow cycle. End the current grow before starting a new one." }`

### `PUT /api/grow-cycles/:id`
Update a grow cycle.

**Request body:**
```ts
{
  name?: string;
  isActive?: boolean;
  startAt?: string;              // Date only: "YYYY-MM-DD" (no timestamp). Date-time strings are rejected.
}
```

**Response `200`** — Updated GrowCycle (without nested relations).
**`400`** — `{ error: "Failed to update grow cycle record" }`
**`409`** — `{ error: "Controller already has an active grow cycle. End the current grow before starting a new one." }`

### `DELETE /api/grow-cycles/:id`
Delete a grow cycle (cascades to phases, phase environments, automation rules, and telemetry). Devices are NOT deleted (they belong to the controller, not the cycle).

**Response `204`** — No body.
**`404`** — `{ error: "Record could not be deleted" }`

### `POST /api/grow-cycles/:id/skip-phase?today=YYYY-MM-DD`
Advance the active phase to the next one; trim the active phase's duration to its elapsed days. Cascades the date shift across all subsequent phases.

**Response `200`** — Updated GrowCycle with re-cascaded phase dates.
**`400`** — `{ error: "Grow cycle has not started yet" | "No active phase to skip" | "Cannot skip the final grow phase" | "Server could not determine today's date" }`
**`404`** — `{ error: "Grow cycle record not found" }`

### `POST /api/grow-cycles/:id/end-grow?today=YYYY-MM-DD`
Trim the active phase's duration to its elapsed days, canonicalize all phase dates, mark the cycle inactive, and deactivate all phases. Historical telemetry, device state logs, and rules are preserved on the controller.

**Response `200`** — Updated GrowCycle (with `isActive: false`).
**`400`** — `{ error: "Grow cycle has not started yet" | "No active phase to end" | "Server could not determine today's date" }`
**`404`** — `{ error: "Grow cycle record not found" }`

---

## Grow Phases

A `GrowPhase` represents a stage of a grow cycle. Each phase carries its own day/night clock schedule and a per-phase `PhaseEnvironment` row per period (`DAY` / `NIGHT`).

### `GET /api/grow-phases/cycle/:growCycleId`
List all phases for a grow cycle, in `order` ascending.

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
  dayStartMinutes: number;       // 0..1440 (default 360 = 06:00)
  dayDurationMinutes: number;    // 0..1440 (default 1080 = 18h)
  createdAt: string;
  updatedAt: string;
}
```
**`400`** — `{ error: "Failed to retrieve phases for this cycle" }`

### `GET /api/grow-phases/:id`
Get a single phase.
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
  dayStartMinutes?: number;    // 0..1440, default 360 (06:00)
  dayDurationMinutes?: number; // 0..1440, default 1080 (18h)
}
```

**Response `201`** — Full GrowPhase object.
**`400`** — `{ error: "Failed to create grow phase record" }`

### `PUT /api/grow-phases/:id`
Update a phase.

**Request body:**
```ts
{
  name?: string;
  order?: number;                 // >= 1
  durationDays?: number;          // >= 1
  isActive?: boolean;
  startAt?: string;               // Date only: "YYYY-MM-DD"
  endAt?: string;                 // Date only: "YYYY-MM-DD"
  dayStartMinutes?: number;       // 0..1440
  dayDurationMinutes?: number;    // 0..1440
}
```

**Response `200`** — Updated GrowPhase object.
**`400`** — `{ error: "Failed to update grow phase record" }`

### `DELETE /api/grow-phases/:id`
Delete a phase (cascades to its phase environments and automation rules).
**Response `204`** — No body.
**`404`** — `{ error: "Record could not be deleted" }`

### `PATCH /api/grow-phases/:id/activate`
Activate this phase and clear `isActive` on all other phases in the same grow cycle.
**Response `200`** — Updated GrowPhase object.
**`404`** — `{ error: "Grow phase could not be activated" }`

---

## Phase Environments

A `PhaseEnvironment` is a per-phase, per-period environmental threshold set. Each phase has at most one row for `DAY` and one for `NIGHT`. A null value on a threshold means "unconstrained" (the automation engine will not react to that sensor type in that period).

### Model

```ts
{
  id: string;
  growPhaseId: string;
  period: "DAY" | "NIGHT";
  tempMin: number | null;
  tempMax: number | null;
  tempTarget: number | null;
  humidityMin: number | null;
  humidityMax: number | null;
  humidityTarget: number | null;
  co2Min: number | null;
  co2Max: number | null;
  co2Target: number | null;
  createdAt: string;
  updatedAt: string;
}
```

### `GET /api/grow-phases/:growPhaseId/environment`
Return both `DAY` and `NIGHT` environment rows for the given phase. Missing periods are returned as `null` (so the client can tell `DAY` exists and `NIGHT` doesn't vs. both being absent).

**Response `200`**
```ts
{
  growPhaseId: string;
  day: PhaseEnvironment | null;
  night: PhaseEnvironment | null;
}
```
**`400`** — `{ error: "Failed to load phase environment" }`

### `PUT /api/grow-phases/:growPhaseId/environment/:period`
Upsert a phase environment row. `period` is `DAY` or `NIGHT`. Pass any subset of the threshold fields; omitted fields are cleared (set to `null`). Setting all thresholds to `null` is a valid "no constraints" configuration.

**URL params:**
- `:growPhaseId` — UUID
- `:period` — `DAY` | `NIGHT`

**Request body:**
```ts
{
  tempMin?: number | null;
  tempMax?: number | null;
  tempTarget?: number | null;
  humidityMin?: number | null;
  humidityMax?: number | null;
  humidityTarget?: number | null;
  co2Min?: number | null;
  co2Max?: number | null;
  co2Target?: number | null;
}
```

**Response `200`** — The upserted `PhaseEnvironment` row.
**`400`** — `{ error: "Failed to upsert phase environment" }`
**`404`** — `{ error: "Grow phase record not found" }`

### `DELETE /api/grow-phases/:growPhaseId/environment/:period`
Remove a phase environment row.

**Response `204`** — No body.
**`404`** — `{ error: "Phase environment row not found" }`

---

## Automation Rules

An `AutomationRule` is an explicit per-device trigger. A rule is scoped to exactly one of:

- a `GrowPhase` (preferred — per-stage behavior like "vegetative phase keeps humidity high"), **or**
- a `GrowCycle` (rare — cycle-wide baseline behavior, applies in any active phase).

A rule watches one sensor type and fires one device action when its condition is met.

### Model

```ts
{
  id: string;
  growCycleId: string | null;     // exactly one of (growCycleId, growPhaseId) is non-null
  growPhaseId: string | null;
  deviceId: string;               // UUID of the Device to actuate
  watchedSensorType: SensorType;  // which telemetry stream triggers this rule
  period: "DAY" | "NIGHT" | null; // null = applies in BOTH day and night
  condition: RuleCondition;       // see below
  action: "ON" | "OFF";
  cooldownSeconds: number;        // default 180 — min gap between two auto commands
  enabled: boolean;               // default true
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
}
```

`RuleCondition` is one of the following accepted values:

| Value | When it fires | Engine consults |
|---|---|---|
| `"ABOVE_MAX"` | Latest telemetry value for `watchedSensorType` exceeds the active phase's `PhaseEnvironment.*Max` for the current period. | `PhaseEnvironment.tempMax / humidityMax / co2Max` (matching sensor type). Requires `watchedSensorType`. |
| `"BELOW_MIN"` | Latest telemetry value for `watchedSensorType` falls below the active phase's `PhaseEnvironment.*Min` for the current period. | `PhaseEnvironment.tempMin / humidityMin / co2Min`. Requires `watchedSensorType`. |
| `"ALWAYS_ON"` | Pins the device to `ON` within the rule's scope (phase or cycle) and current period (or both, if `period` is null). Enforced by the automation scheduler on its 60s tick. | None (no threshold consulted). Requires `action: "ON"`; requires `watchedSensorType: null`. |
| `"ALWAYS_OFF"` | Pins the device to `OFF` within the rule's scope and current period (or both, if `period` is null). Enforced by the automation scheduler on its 60s tick. | None. Requires `action: "OFF"`; requires `watchedSensorType: null`. |

`"SCHEDULE_ON"` and `"SCHEDULE_OFF"` exist in the schema for backward compatibility but are rejected at the API layer (`400`). Light scheduling is driven directly by the grow-phase clock — there is no automation rule representation of "light on at day start" anymore, and LIGHT devices are not eligible for automation rules.

**Suppression:** an enabled `ALWAYS_ON` / `ALWAYS_OFF` rule covering `(device, scope, period)` suppresses any `ABOVE_MAX` / `BELOW_MIN` rule for that same `(device, scope, period)` on the threshold evaluator path. The pin itself is enforced by the scheduler.

**Precedence:** device-level `Device.automationMode` is the global override and always wins over rule-level behavior:
- `MANUAL` — rules never drive the device (neither threshold nor ALWAYS_*).
- `ALWAYS_ON` — never issues `OFF`, even if a rule says `ALWAYS_OFF`.
- `ALWAYS_OFF` — never issues `ON`, even if a rule says `ALWAYS_ON`.

Cooldown is checked against `now - lastTriggeredAt` for the same rule (default 180s). A `null` period is treated as "applies in both `DAY` and `NIGHT`".

### `GET /api/automation-rules/grow-cycle/:growCycleId`
List all rules scoped to a grow cycle (cycle-level rules only — does not include rules scoped to a phase within that cycle).

**Response `200`** — Array of `AutomationRule`.
**`400`** — `{ error: "Failed to load automation rules" }`

### `GET /api/automation-rules/grow-phase/:growPhaseId`
List all rules scoped to a grow phase.

**Response `200`** — Array of `AutomationRule`.
**`400`** — `{ error: "Failed to load automation rules" }`

### `GET /api/automation-rules/device/:deviceId`
List all rules that actuate a specific device.

**Response `200`** — Array of `AutomationRule`.
**`400`** — `{ error: "Failed to load automation rules" }`

### `POST /api/automation-rules`
Create a rule.

**Request body:**
```ts
{
  growCycleId?: string;            // exactly one of these must be set
  growPhaseId?: string;
  deviceId: string;
  watchedSensorType?: SensorType | null; // required for ABOVE_MAX/BELOW_MIN; null for ALWAYS_*
  period?: "DAY" | "NIGHT" | null;        // null = both
  condition: RuleCondition;        // ABOVE_MAX | BELOW_MIN | ALWAYS_ON | ALWAYS_OFF
  action: "ON" | "OFF";
  cooldownSeconds?: number;        // default 180
  enabled?: boolean;               // default true
}
```

**Response `201`** — Full `AutomationRule` object.
**`400`** — `{ error: "Failed to create automation rule" }` (also returned when the scope / period / condition invariants are violated; message identifies the violation).

### `PUT /api/automation-rules/:id`
Update a rule. All fields except `id` are optional; only provided fields are updated. Scope (`growCycleId` / `growPhaseId`) is **immutable** — delete + recreate to re-scope.

**Request body:**
```ts
{
  deviceId?: string;
  watchedSensorType?: SensorType | null;
  period?: "DAY" | "NIGHT" | null;
  condition?: RuleCondition;
  action?: "ON" | "OFF";
  cooldownSeconds?: number;
  enabled?: boolean;
}
```

**Response `200`** — Updated `AutomationRule` object.
**`400`** — `{ error: "Failed to update automation rule" }`

### `PATCH /api/automation-rules/:id/toggle`
Flip the `enabled` flag. Convenience for pausing/resuming a rule without delete + recreate.

**Response `200`** — `{ id, enabled }`.
**`400`** — `{ error: "Failed to toggle automation rule" }`

### `DELETE /api/automation-rules/:id`
Delete a rule.

**Response `204`** — No body.
**`400`** — `{ error: "Failed to delete automation rule" }`

---

## Telemetry

Telemetry readings are produced by physical `Sensor`s. Each reading is a single numeric value (`value`) tagged with the sensor that produced it (`sensorId`) and the type of measurement (`sensorType`). Readings are written to the database, broadcast live to the frontend via Socket.IO, and **fed into the threshold evaluator** which may trigger `AutomationRule`s.

### Model

```ts
{
  id: string;
  growCycleId: string;
  sensorId: string;
  sensorType: SensorType;
  value: number;
  createdAt: string;
  sensor: {
    id: string;
    name: string;
    type: SensorType;
    protocol: SensorProtocol;
  };
}
```

### `GET /api/telemetry/grow-cycle/:growCycleId`
List every telemetry reading for a grow cycle, newest first. Includes a slim `sensor` summary on each row.
**Response `200`** — Array of `Telemetry` (with nested `sensor`).
**`400`** — `{ error: "Failed to load telemetry readings" }`

### `GET /api/telemetry/grow-cycle/:growCycleId/latest`
Return the most-recent reading **per physical sensor** (not per `sensorType`) for the grow cycle. A `TEMP_HUMIDITY` sensor therefore contributes up to two rows (one temp, one humidity), each representing its own latest sample.
**Response `200`** — Array of `Telemetry` (with nested `sensor`).
**`400`** — `{ error: "Failed to load latest telemetry" }`

### `GET /api/telemetry/grow-cycle/:growCycleId/range?from=...&to=...`
Return telemetry rows for a grow cycle whose `createdAt` falls within the given ISO 8601 window. Ordered by `createdAt` ascending.
**Response `200`** — Array of `Telemetry` (with nested `sensor`).
**`400`** — `{ error: "Failed to load telemetry range" }`

### `POST /api/telemetry`
Ingest a single telemetry reading manually. In production, MQTT is the canonical ingestion path; this endpoint is for tests and admin tooling. The manual path does **not** invoke the threshold evaluator — only MQTT ingestion does.
**Request body:**
```ts
{
  growCycleId: string;
  sensorId: string;
  sensorType: SensorType;
  value: number;
}
```
**Response `201`** — Created `Telemetry` (with nested `sensor`).
**`400`** — `{ error: "Failed to ingest telemetry reading" }`

### MQTT Ingestion

- Pi publishes to: **`sensors/<sensorId>/telemetry`**
- Backend subscribed to: **`sensors/+/telemetry`**
- Payload (JSON):
  ```ts
  {
    readings: [
      { sensorType: "TEMPERATURE", value: 24.7 },
      { sensorType: "HUMIDITY",    value: 58.1 }
    ]
  }
  ```
- The server resolves the sensor's controller's currently active grow cycle and writes one `Telemetry` row per reading against it. The sensor's `lastActive` is updated.
- After persisting, the threshold evaluator runs against every reading (see Automation overview). Rules for the active grow cycle/phase that match the reading's `sensorType` may fire ON/OFF commands to the corresponding device.
- If the sensor's controller has no active grow cycle, the payload is dropped and a warning is logged (the `growCycleId` column is non-null by design). The MQTT state feedback path (`devices/<id>/state`) still works — device state is independent of the active grow cycle.

### MQTT Device State Feedback

- Pi publishes to: **`devices/<deviceId>/state`**
- Backend subscribed to: **`devices/+/state`**
- Payload (JSON):
  ```ts
  { action: "ON" | "OFF"; timestamp: number; }
  ```
- The server reconciles `Device.isActive` to match the reported state and writes a `DeviceStateLog` row with `source: "AUTO" reason: "state confirmed"`. This row becomes the source of truth for the evaluator's hysteresis check on subsequent ticks.

### Socket.IO Events

| Event | Direction | Payload |
|---|---|---|
| `ui_command` | Frontend → Server | `{ deviceId: string, action: "ON"\|"OFF", pin: number }` |
| `frontend_telemetry` | Server → Frontend | `{ sensorId, sensorName, sensorType, value, growCycleId, timestamp }` (one event per persisted reading) |

---

## Error Response Format

All error responses return:
```ts
{ error: string }
```

A `404` is returned when a resource by ID is not found. A `400` is returned for validation or database operation failures. A `409` is returned when a controller already has an active grow cycle.

---

## TypeScript Types Summary (for FE)

```ts
// Enums
type DeviceType =
  | "LIGHT" | "EXHAUST_FAN" | "INTAKE_FAN" | "CIRCULATION_FAN"
  | "WATER_PUMP" | "AIR_CONDITIONER" | "HEATER" | "HUMIDIFIER"
  | "DEHUMIDIFIER" | "CO2_INJECTOR";

type AutomationMode =
  | "MANUAL" | "SCHEDULED" | "THRESHOLD" | "ALWAYS_ON" | "ALWAYS_OFF";

type SensorType = "HUMIDITY" | "TEMPERATURE" | "TEMP_HUMIDITY" | "CO2" | "PH" | "EC";
type SensorProtocol = "I2C" | "SPI" | "UART" | "RS485";

type DayNightPeriod = "DAY" | "NIGHT";

type RuleCondition = "ABOVE_MAX" | "BELOW_MIN" | "ALWAYS_ON" | "ALWAYS_OFF"; // SCHEDULE_ON / SCHEDULE_OFF exist in the schema for backward compat but are rejected at the API layer

type DeviceAction = "ON" | "OFF";

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
  controllerId: string;          // Devices are owned by the Controller, not by a grow cycle.
  name: string;
  type: DeviceType;
  pinNumber: number;
  mqttTopic: string;
  automationMode: AutomationMode;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface GrowCycle {
  id: string;
  controllerId: string;
  name: string;
  isActive: boolean;
  startAt: string | null;        // Date only: "YYYY-MM-DD"
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
  startAt: string | null;        // Date only: "YYYY-MM-DD"
  endAt: string | null;          // Date only: "YYYY-MM-DD"
  dayStartMinutes: number;       // 0..1440 — minutes-from-midnight the photoperiod DAY begins
  dayDurationMinutes: number;    // 0..1440 — how long DAY lasts; NIGHT = 1440 - this
  createdAt: string;
  updatedAt: string;
}

interface PhaseEnvironment {
  id: string;
  growPhaseId: string;
  period: DayNightPeriod;
  tempMin: number | null;
  tempMax: number | null;
  tempTarget: number | null;
  humidityMin: number | null;
  humidityMax: number | null;
  humidityTarget: number | null;
  co2Min: number | null;
  co2Max: number | null;
  co2Target: number | null;
  createdAt: string;
  updatedAt: string;
}

interface AutomationRule {
  id: string;
  growCycleId: string | null;     // exactly one of (growCycleId, growPhaseId) is non-null
  growPhaseId: string | null;
  deviceId: string;
  watchedSensorType: SensorType | null; // null for ALWAYS_ON / ALWAYS_OFF rules
  period: DayNightPeriod | null;  // null = applies in both
  condition: RuleCondition;
  action: DeviceAction;
  cooldownSeconds: number;        // default 180
  enabled: boolean;               // default true
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Sensor {
  id: string;
  controllerId: string;
  name: string;
  type: SensorType;
  mqttTopic: string;
  pinNumbers: number[];
  protocol: SensorProtocol;
  lastActive: string | null;     // ISO 8601 or null
  createdAt: string;
  updatedAt: string;
}

interface Telemetry {
  id: string;
  growCycleId: string;
  sensorId: string;              // Non-null FK to the producing Sensor
  sensorType: SensorType;
  value: number;
  createdAt: string;
  sensor: {
    id: string;
    name: string;
    type: SensorType;
    protocol: SensorProtocol;
  };
}

interface DeviceStateLog {
  id: string;
  deviceId: string;
  action: "ON" | "OFF";
  source: "MANUAL" | "AUTO" | "UI";
  //   MANUAL — REST command endpoint (`POST /api/devices/:id/command`)
  //   UI     — Socket.IO `ui_command` event from the dashboard
  //   AUTO   — written by the threshold evaluator, the day/night light scheduler,
  //            and the closed-loop device state handler
  reason: string | null;         // e.g. "temp 31.2°C > max 28°C (DAY)" or "state confirmed"
  createdAt: string;
}
```

---

## DeviceStateLog (audit trail)

Every ON/OFF command issued to a device is recorded in the `DeviceStateLog` table for audit and debugging.

| Write path | `source` value | When |
|---|---|---|
| `POST /api/devices/:id/command` | `MANUAL` | Caller invokes the REST command endpoint. State update and log write commit in a single transaction. |
| Socket.IO `ui_command` event | `UI` | Frontend dashboard sends a toggle. Log is written fire-and-forget (errors are logged but do not affect the MQTT publish). |
| Light scheduler (60s tick) | `AUTO` | The light scheduler drives a `LIGHT` device to match the current day/night period of the active grow phase. `reason` is e.g. `"day cycle start"`. |
| Automation scheduler — ALWAYS_* (60s tick) | `AUTO` | An enabled `ALWAYS_ON` / `ALWAYS_OFF` rule is enforced for the active phase/cycle + current period. `reason` is e.g. `"ALWAYS_ON rule (<id>)"`. |
| Threshold evaluator (telemetry-driven) | `AUTO` | An `ABOVE_MAX` or `BELOW_MIN` rule fires. `reason` is e.g. `"temp 31.2°C > max 28°C (DAY)"`. |
| Device state feedback handler | `AUTO` | The Pi publishes a `devices/<id>/state` confirmation. `reason` is `"state confirmed"`. This row is the source of truth for the evaluator's hysteresis check on subsequent ticks. |

There is currently no read endpoint for `DeviceStateLog` — query the table directly if needed. Indexed on `deviceId` and `createdAt`.

---

## Frontend Integration Notes

### 1. Devices belong to the Controller, not to grow cycles

- Devices persist across all grow cycles on a controller. The same light stays wired to the same Pi between grows.
- Use `GET /api/devices/controller/:controllerId` to list the persistent device inventory of a tent.
- Grow cycles no longer carry a `devices` array. Use `GET /api/grow-cycles/:id` to fetch a cycle (phases + environments only) and call `GET /api/devices/controller/:controllerId` separately.
- `POST /api/devices` provisions a device on a controller; `POST /api/grow-cycles` no longer accepts a `devices` array.

### 2. Per-phase day/night schedule and thresholds

- Each `GrowPhase` carries `dayStartMinutes` and `dayDurationMinutes` (the server defaults are 360 and 1080, i.e. an 18/6 photoperiod starting at 06:00).
- A phase has at most one `PhaseEnvironment` per `period` (`DAY` / `NIGHT`). Fetch both via `GET /api/grow-phases/:id/environment`. Configure via `PUT /api/grow-phases/:id/environment/:period`. A null threshold means "unconstrained".
- Editing UI: a `phase.edit` form with a per-period (DAY/NIGHT) sub-grid of (temp, humidity, co2) min/max/target fields.

### 3. Automation rules

- Rules are scoped to a phase (preferred) or a cycle — exactly one. Configure via `POST /api/automation-rules` and `PUT /api/automation-rules/:id`.
- Suggested UI: a `phase.edit` "Automation" tab that lists rules for that phase, with quick-add templates per device type:
  - `EXHAUST_FAN` / `AIR_CONDITIONER` / `INTAKE_FAN` → `ABOVE_MAX` on `TEMPERATURE` → `ON` (with `OFF` rule on `BELOW_MIN - 0.5` if you want a deadband).
  - `HEATER` → `BELOW_MIN` on `TEMPERATURE` → `ON`.
  - `HUMIDIFIER` → `BELOW_MIN` on `HUMIDITY` → `ON`.
  - `DEHUMIDIFIER` → `ABOVE_MAX` on `HUMIDITY` → `ON`.
  - `CO2_INJECTOR` → `BELOW_MIN` on `CO2` → `ON` (typically scoped to `period: "DAY"`).
  - `LIGHT` → **no automation rule needed**. Light scheduling is automatic from the grow-phase clock; configure the phase's `dayStartMinutes` / `dayDurationMinutes` instead.

### 4. MQTT topics (firmware contract)

| Direction | Topic | Payload |
|---|---|---|
| Pi → Server | `sensors/<sensorId>/telemetry` | `{ readings: [{ sensorType, value }] }` |
| Server → Pi | `devices/<deviceId>/commands` | `{ action: "ON"\|"OFF", pin: number, timestamp: number }` |
| Pi → Server | `devices/<deviceId>/state` | `{ action: "ON"\|"OFF", timestamp: number }` (closed-loop confirmation) |

The Pi must publish `devices/<id>/state` whenever a relay actually changes. The server uses that to update `Device.isActive` and to provide hysteresis for the automation engine. State feedback also writes a `DeviceStateLog` row with `source: "AUTO" reason: "state confirmed"`, which becomes the evaluator's source of truth.

### 5. Live telemetry and live device state

- `frontend_telemetry` event payload: `{ sensorId, sensorName, sensorType, value, growCycleId, timestamp }`.
- (Optional, future) `frontend_device_state` event: the server can broadcast updated `DeviceStateLog` rows to the FE for live state panels.

### 6. Migration checklist for the FE

| Area | Action |
|---|---|
| Types | Update `Device` (now `controllerId` + `automationMode`). Add `AutomationMode`, `DayNightPeriod`, `RuleCondition`, `DeviceAction`, `PhaseEnvironment`, `AutomationRule`. |
| Controller page | Show persistent device inventory (one section per tent) using `GET /api/devices/controller/:id`. |
| Cycle page | Remove any "provision devices" UI from the grow-cycle create flow. Add an "Automation" tab on each phase. |
| Phase editor | Add fields for `dayStartMinutes` / `dayDurationMinutes`; add a DAY/NIGHT sub-grid for thresholds (`PUT /api/grow-phases/:id/environment/:period`). |
| Rules editor | CRUD over `POST/GET/PUT/DELETE /api/automation-rules`. Show `enabled` toggle and `lastTriggeredAt` timestamp. |
| Telemetry UI | Group by `sensorId` rather than by `sensorType`; show sensor name; handle `TEMP_HUMIDITY` as a single sensor that emits two reading kinds. |
| Live socket handler | Update `frontend_telemetry` payload shape (`sensorId`, `sensorName`, `sensorType`, `value`, `growCycleId`, `timestamp`). |
