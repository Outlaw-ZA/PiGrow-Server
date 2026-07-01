# PiGrow-Server — Agents.md

## Commands

| Action | Command |
|--------|---------|
| Dev server (hot-reload) | `npm run dev` |
| Build (tsc) | `npm run build` |
| Run production | `npm start` |
| Run all tests | `npm test` |
| Prisma generate | `npx prisma generate` |
| Prisma migrate dev | `npx prisma migrate dev` |

All test/watch commands load `.env` via `--env-file=.env`. No linter or formatter is configured.

## Architecture

- **Single-package repo**, not a monorepo.
- **Fastify 5** + **TypeBox** for typed request validation.
- **Prisma 7** — client generated to `src/generated/client/` (not `node_modules/@prisma/client`). Import from `../generated/client/client.js`.
- **Socket.IO** for real-time frontend push.
- **MQTT** (`mqtt.js`) for Raspberry Pi communication.
- **NodeNext** module resolution — all local imports **must use `.js` extensions** even for `.ts` files.

## Module pattern

Each API module has exactly 4 files in `src/api/modules/<name>/`:
- `<name>.routes.ts` — route registration
- `<name>.controller.ts` — business logic (receives `FastifyInstance` in constructor, uses `server.prisma`)
- `<name>.schema.ts` — TypeBox schemas
- `<name>.test.ts` — integration tests

## Testing

- Node.js native test runner (`node:test`, `node:assert/strict`).
- Integration-style: creates real Fastify + Prisma instance via `createTestApp()` from `test-helper.ts`.
- Operates on a real database — records are created and cleaned up per test.
- Run all: `npm test` (globs `src/api/modules/**/*.test.ts`).

## Known issues

1. **Docker port mismatch** — Dockerfile `EXPOSE 3000`, server listens on `4000`.
2. **`import "dotenv/config"` in `prisma.config.ts`** but `dotenv` is not a dependency (relies on `--env-file=.env` flag or `tsx` behavior).
3. (resolved) Test files previously hung for 30-60s on exit because `app.close()` does not drain the underlying `pg.Pool` and the singleton `mqttClient` socket was left open. The fix is `teardownTestApp()` in `src/api/modules/test-helper.ts` which calls `closeDatabase()` (drains the pool) and `endMqtt()` (closes the MQTT socket) in addition to `app.close()`. All test files use this helper.

## Entrypoint

`src/server.ts` — boot order: Fastify → Socket.IO → MQTT connect → register plugins → register routes → start automation scheduler → listen on `:4000`.

## Routes

All under `/api`:
- `/api/controllers` — Raspberry Pi controller management
- `/api/devices` — GPIO device management (devices owned by Controller)
- `/api/sensors` — sensor inventory per Controller
- `/api/grow-cycles` — grow cycle scheduling
- `/api/grow-phases` — phase management with activation/deactivation
- `/api/grow-phases/:id/environment` — per-phase DAY/NIGHT threshold sets
- `/api/automation-rules` — explicit per-device trigger rules
- `/api/telemetry` — sensor telemetry ingestion and queries

Full reference in `API.md`.

## Sensors

- `Sensor` model: physical probe attached to a `Controller`. Fields: `id, name, type (SensorType), controllerId, mqttTopic, pinNumbers (Int[]), protocol (SensorProtocol), lastActive, createdAt, updatedAt`.
- `SensorType` enum: `HUMIDITY | TEMPERATURE | TEMP_HUMIDITY | CO2 | PH | EC` (also used by `Telemetry.sensorType` and `AutomationRule.watchedSensorType`).
- `SensorProtocol` enum: `I2C | SPI | UART | RS485`.
- Sensors are seeded on controller **create** via the optional `sensors` array in `POST /api/controllers`. All other sensor CRUD goes through `/api/sensors/*`.
- MQTT topic for telemetry is `sensors/<sensorId>/telemetry` with payload `{ readings: [{ sensorType, value }] }`. The handler resolves the sensor's controller's active grow cycle and writes one `Telemetry` row per reading; if no active grow cycle exists, the reading is dropped (with a warning).

## Devices

- `Device` model: physical relay/actuator wired to a `Controller`. **Devices are owned by the Controller (not the grow cycle)** — the same light, fan, and heater persist across sequential grows on the same Pi. Fields: `id, name, type (DeviceType), controllerId, pinNumber, mqttTopic, automationMode, isActive, createdAt, updatedAt`.
- `DeviceType` enum: `LIGHT | EXHAUST_FAN | INTAKE_FAN | CIRCULATION_FAN | WATER_PUMP | AIR_CONDITIONER | HEATER | HUMIDIFIER | DEHUMIDIFIER | CO2_INJECTOR`.
- `AutomationMode` enum (per-device, drives the automation engine):
  - `MANUAL` — no automation; only REST/Socket.IO commands accepted.
  - `SCHEDULED` — driven by the day/night clock. Used by `LIGHT` devices.
  - `THRESHOLD` — evaluated against the active phase's `PhaseEnvironment` rules. Used by fans, heater, humidifier, CO2 injector.
  - `ALWAYS_ON` / `ALWAYS_OFF` — pinned regardless of clock or thresholds.
- **MQTT command topic (server → Pi):** `devices/<deviceId>/commands` with payload `{ action: "ON"|"OFF", pin: number, timestamp: number }`.
- **MQTT state topic (Pi → server, closed-loop feedback):** `devices/<deviceId>/state` with payload `{ action: "ON"|"OFF", timestamp: number }`. The server reconciles `Device.isActive` and writes a `DeviceStateLog source:"AUTO"` row on every state report.
- Devices are listed by `GET /api/devices/controller/:controllerId`. CRUD goes through `/api/devices/*`. `POST /:id/command` sends an immediate ON/OFF command (source=`MANUAL`).

## Grow Phases & Day/Night

- `GrowPhase` model now carries a **day/night clock schedule**:
  - `dayStartMinutes` (Int, 0..1440) — minutes from midnight when the photoperiod DAY begins.
  - `dayDurationMinutes` (Int, 0..1440) — how long the day lasts. Night = 1440 - dayDurationMinutes.
  - Examples: 18/6 → 360..1440; 12/12 → 360..720; all-day → 0..1440; all-night → 0..0.
- The automation engine resolves the current period from `new Date()` using the **active** phase's schedule. Server and Pi share the same TZ.

## Phase Environments

- `PhaseEnvironment` — per-phase, per-period threshold set keyed on `(growPhaseId, period)` where `period ∈ { DAY, NIGHT }`.
- Fields: `tempMin/Max/Target`, `humidityMin/Max/Target`, `co2Min/Max/Target` — all nullable; null = unconstrained.
- CRUD: `GET /api/grow-phases/:id/environment` returns both DAY and NIGHT rows; `PUT /api/grow-phases/:id/environment/:period` upserts; `DELETE /api/grow-phases/:id/environment/:period` removes.

## Automation

- `AutomationRule` — explicit per-device trigger rule.
  - Scoped to exactly one of: a `GrowPhase` (preferred) or a `GrowCycle` (rare cycle-wide rules). Enforced in the controller.
  - Fields: `deviceId, watchedSensorType (nullable), period (DAY|NIGHT|null=both), condition, action, cooldownSeconds, enabled, lastTriggeredAt`.
  - **LIGHT devices are not eligible for automation rules.** Light scheduling is driven directly by the grow-phase clock — there is no automation rule representation of "light on at day start" anymore.
  - `RuleCondition` enum (only `ABOVE_MAX` / `BELOW_MIN` / `ALWAYS_ON` / `ALWAYS_OFF` are accepted at the API layer):
    - `ABOVE_MAX` — fires when the latest telemetry value for `watchedSensorType` exceeds the active phase's environment `*Max`. Common use: exhaust fan on temp. **Requires a non-null `watchedSensorType`.**
    - `BELOW_MIN` — fires when the latest value falls below `*Min`. Common use: heater on temp, humidifier on humidity, CO2 injector on CO2. **Requires a non-null `watchedSensorType`.**
    - `ALWAYS_ON` — pins the device to ON within the rule's scope (phase or cycle) and current period (or both, if `period` is null). Enforced by the automation scheduler's 60s tick. `action` must be `ON`; `watchedSensorType` must be null.
    - `ALWAYS_OFF` — same as `ALWAYS_ON` but for OFF. `action` must be `OFF`; `watchedSensorType` must be null.
    - `SCHEDULE_ON` / `SCHEDULE_OFF` — remain in the schema for backward compatibility but are rejected at the API layer (`POST`/`PUT` return 400). They have no remaining consumer.
  - `DeviceAction` enum: `ON` | `OFF`.
  - `cooldownSeconds` (default 180) suppresses repeated firings of the same rule. `enabled` lets the user pause without deletion.
- **Automation engine** (`src/automation/evaluator.ts`): every persisted telemetry row is checked against enabled rules whose `watchedSensorType` matches the reading. Hysteresis is enforced by reading the latest `DeviceStateLog` row for the device — the engine never issues a command that matches the device's already-confirmed state. The query also filters out `device.type = LIGHT` as a defensive measure against any pre-existing rule rows. **Per-device suppression:** an enabled `ALWAYS_ON` / `ALWAYS_OFF` rule covering `(device, scope, period)` skips evaluation of `ABOVE_MAX` / `BELOW_MIN` rules for that same `(device, scope, period)`. The pin itself is enforced by the scheduler, not the evaluator.
- **Automation scheduler** (`src/automation/scheduler.ts`): a 60-second tick. Two responsibilities:
  1. **Light driving** — for each controller with an active grow cycle, resolves the current day/night period from the active phase's `dayStartMinutes` / `dayDurationMinutes`, finds every `LIGHT` device on that controller, respects its `automationMode` (`MANUAL` skipped; `ALWAYS_ON` never turned OFF; `ALWAYS_OFF` never turned ON; otherwise toggled to match the period), and issues the command if it differs from the device's latest confirmed state. No `AutomationRule` rows are consulted for lights.
  2. **ALWAYS_* enforcement** — for each enabled `ALWAYS_ON` / `ALWAYS_OFF` rule scoped to the active phase or cycle and matching the current period (or `period: null`), issues the rule's action to the target device. Device-level `automationMode` always wins: `MANUAL` is skipped; `ALWAYS_ON` / `ALWAYS_OFF` on the device block the opposite action. LIGHT devices are skipped defensively.
- **Device state handler** (`src/mqtt-handlers/device-state-handler.ts`): the Pi publishes `devices/<id>/state` whenever a relay actually changes. The server reconciles `Device.isActive` and appends a `DeviceStateLog source:"AUTO" reason:"state confirmed"` row, which becomes the source of truth for the scheduler's and evaluator's hysteresis check.
- No-op when no active grow cycle exists — telemetry is still persisted, but rules never fire.
