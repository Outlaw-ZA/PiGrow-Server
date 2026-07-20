# PiGrow-Server

Indoor growing automation backend — a TypeScript service that manages
Raspberry Pi-based greenhouse/grow-tent controllers. Includes the
**auto-provisioning** service that lets a fresh Pi be claimed from the UI
with no pre-configuration.

## Tech Stack

| Layer       | |
|-------------|--|
| Runtime     | Node.js 22 |
| Language    | TypeScript 6 |
| Web         | Fastify 5 |
| Validation  | TypeBox |
| Database    | PostgreSQL 16 via Prisma 7 |
| Real-time   | Socket.IO |
| Device comms| MQTT (Mosquitto broker, UDP 9999 discovery) |

## Quick Start

```bash
# Install dependencies
bun install

# Generate Prisma client
bunx prisma generate

# Run migrations (auto-provisioning columns are additive)
bunx prisma migrate dev

# Start dev server (hot-reload)
bun run dev

# Run tests (157 tests; 20 in the provisioning suite)
bun run test

# Production build
bun run build && bun start
```

Requires a running PostgreSQL instance and MQTT broker. See `.env` for
`DATABASE_URL` and `docker-compose.yaml` for the full stack.

## Architecture

```
[Raspberry Pi (PiGrow-Client)]                          [Workstation]
   UDP :9999 beacon ────────────────────────────────────> ┐
   subscribes MQTT provision/<mac>/claim  <──────────────┐ │
                                                          │ │
                                                          v │
                          ┌───────────────────────────────┐ │
                          │  PiGrow-Server (Fastify)      │ │
                          │                               │ │
                          │  src/services/                │ │
                          │    DiscoveryService.ts  <─────┘ │ (UDP :9999 listener)
                          │                               │
                          │  src/api/modules/             │
                          │    provisioning/   ──> MQTT ──┘ publishes ClaimResponse
                          │      GET  /api/controllers/scan
                          │      POST /api/controllers/claim   (one Prisma $transaction:
                          │                                   Controller upsert + Sensor/Device
                          │                                   auto-create from hwManifest +
                          │                                   scrypt-hashed MQTT credentials)
                          │    controllers/   (legacy manual)
                          │    devices/       (legacy manual)
                          │    sensors/       (legacy manual)
                          │    ...
                          │  src/mqtt-handlers/           │
                          │    device-state-handler.ts    │ (subscribes devices/+/state)
                          │    telemetry-handler.ts       │ (subscribes sensors/+/telemetry)
                          │  src/automation/              │
                          │    scheduler.ts (60s tick)    │
                          └───────────────────────────────┘
                                  │
                            Socket.IO + REST
                                  │
                                  v
                          ┌───────────────────────────────┐
                          │  PiGrow-UI (browser)          │
                          │  /admin/controllers/scan      │
                          └───────────────────────────────┘
```

### Layout

- **`src/server.ts`** — entrypoint: Fastify → Socket.IO → MQTT → plugins → routes → automation scheduler → listen
- **`src/services/DiscoveryService.ts`** — UDP 9999 listener, 120 s sighting TTL with **source-IP continuity** (a same-LAN neighbor can't hijack an unclaimed Pi's slot), **per-source quota (8)** and **fair global eviction (256)** to prevent cache-flooding, **per-MAC attempt budget (5)** with 429 cooldown on PIN-bruteforce. Has test seams `clearForTesting()` / `__seedForTesting()`.
- **`src/api/modules/provisioning/`** — `GET /scan`, `POST /claim`. The claim flow is the load-bearing piece: it does a constant-time PIN check, an atomic `prisma.$transaction` upserting the Controller and creating/updating Sensor + Device rows from the Pi's `hwManifest` (match key: controller + type + protocol + pinNumbers — never the mutable `name`), generates per-controller MQTT credentials hashed with scrypt, and publishes the `ClaimResponse` to MQTT. Returns 401/404/409/429 as appropriate; never leaks `mqttPasswordHash` or `claimPinHash` in the response.
- **`src/api/modules/<name>/`** — each domain has routes, controller, schema, and test
- **`src/mqtt-handlers/`** — MQTT topic handlers for telemetry and device state feedback
- **`src/automation/`** — `period.ts` (day/night resolver), `scheduler.ts` (60s light-schedule tick), `evaluator.ts` (threshold-driven reactions)
- **`src/plugins/prisma.ts`** — Fastify plugin that decorates the server with Prisma client

## Provisioning API

All routes are mounted under `/api` and documented live via Swagger UI at
**`http://localhost:4000/documentation`** (when the dev server is running).
The same OpenAPI 3.0 document is committed to
[`openapi.json`](./openapi.json) for offline reference and to keep PRs
reviewable.

### New endpoints

| Method | Path                          | Purpose                                                |
| ------ | ----------------------------- | ------------------------------------------------------ |
| GET    | `/api/controllers/scan`       | Return all currently-discovered Pis (LAN discovery)    |
| POST   | `/api/controllers/claim`      | Claim a Pi by `{mac, claimPin, name}`                  |

Status codes: 200 / 201 on claim, 401 wrong/expired PIN, 404 unknown MAC,
409 already consumed (replay protection), 429 attempt budget exceeded
(see `Retry-After`).

### Prisma additions (additive, non-breaking)

`Controller` model gained:
- `provisionState` (enum `DeviceProvisionState`: `UNCLAIMED`/`ACTIVE`/`INACTIVE`)
- `deviceSerial`, `lastBeaconAt`, `mqttUsername` (unique), `mqttPasswordHash` (scrypt)
- All nullable with defaults; existing rows migrate clean.

`DeviceProvisionState` defaults to `ACTIVE` for legacy rows.

## Protocol reference

The full wire format (ProvisionBeacon, ClaimResponse, mDNS TXT keys, MQTT
topic layout, threat-model assumptions) is documented in
[`docs/provisioning-protocol.md`](./docs/provisioning-protocol.md). Both
PiGrow-Client and PiGrow-UI build against the same spec.

## Tests

```sh
bun run test          # 157 tests / 13 suites
```

The 20-test **Controller provisioning API** suite covers: scan cache, UDP
beacon ingest, happy-path claim (asserts plaintext password IS in the
published MQTT message and IS NOT in the persisted DB row), mismatched
PIN (401), expired PIN (401), unknown MAC (404), replayed PIN (409, no
credential rotation, no re-publish), concurrent claim (one 200 + one 409),
attempt-budget exhaustion (429 + Retry-After, reset by fresh beacon),
hwManifest upsert without duplicating sensors/devices when the user
renamed them via the legacy API, post-expiry source-IP takeover
rejection, single-source 256-beacon fair-eviction, post-consume
different-IP chosen-PIN rotation rejection, **capacity eviction retains
source binding through the quiet TTL** (the in-model bypass the security
reviewer flagged in wave 3).

Three pre-existing flaky tests in `automation-engine` / `interval-scheduler` /
`devices` are unrelated to provisioning (run-to-run wobble in shared
test-DB state; identified at baseline, never modified).

## Security posture (v1)

- **Same-LAN only.** Discovery is UDP broadcast + mDNS; no remote/cloud.
- **6-digit PIN, 5-minute expiry, single-use** is the provisioning gate.
  Plaintext on the wire is acceptable for the opportunistic-neighbor
  threat model (the operator-locked v1 scope).
- **Anonymous MQTT broker** in v1; per-controller MQTT credentials are
  **generated and persisted** at claim so the Phase-2 security upgrade
  (broker `allow_anonymous false` + per-credential ACLs) is mostly a
  config flip — **but the plaintext passwords are observable over the
  anonymous broker**, so Phase 2 also requires credential rotation
  through an authenticated channel before enforcement. Tracked as a
  Phase-2 deliverable.
- **DiscoveryService hardening** (closes the in-model bypasses within
  the stated threat model):
  - Source-IP binding is retained through PIN expiry, through successful
    consume, and through capacity eviction (swept only after 120 s of
    bound-source silence).
  - Per-source 8-MAC quota + 256-entry global cap with fair eviction
    (evicts from the chattiest source).
  - 5-failure attempt budget per MAC with 429 + Retry-After.
  - 8 KiB beacon max, 32-item manifest cap per array, type-strict validation.
- **No REST / Socket.IO auth** in v1, consistent with the rest of the
  server. Lock down before exposing to the internet.

## Why no TLS yet?

Home LAN. Don't expose to the internet. Phase 2 covers TLS on broker /
REST / Socket.IO.