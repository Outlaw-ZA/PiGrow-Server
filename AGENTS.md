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
3. **Node test runner "Promise resolution is still pending" warnings** — every test file logs this when run with `node:test`; it's a pre-existing quirk of `app.close()` + Prisma's pg adapter pool. All actual test assertions pass.

## Entrypoint

`src/server.ts` — boot order: Fastify → Socket.IO → MQTT connect → register plugins → register routes → listen on `:4000`.

## Routes

All under `/api`: controllers, devices, sensors, grow-cycles, grow-phases, device-configs, telemetry. Full reference in `API.md`.

## Sensors

- `Sensor` model: physical probe attached to a `Controller`. Fields: `id, name, type (SensorType), controllerId, mqttTopic, pinNumbers (Int[]), protocol (SensorProtocol), lastActive, createdAt, updatedAt`.
- `SensorType` enum: `HUMIDITY | TEMPERATURE | TEMP_HUMIDITY | CO2 | PH | EC` (also used by `Telemetry.sensorType`).
- `SensorProtocol` enum: `I2C | SPI | UART | RS485`.
- Sensors are seeded on controller **create** via the optional `sensors` array in `POST /api/controllers`. All other sensor CRUD goes through `/api/sensors/*`.
- MQTT topic for telemetry is `sensors/<sensorId>/telemetry` with payload `{ readings: [{ sensorType, value }] }`. The handler resolves the sensor's controller's active grow cycle and writes one `Telemetry` row per reading; if no active grow cycle exists, the reading is dropped (with a warning).
