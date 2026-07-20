# PiGrow Controller Provisioning Protocol v1

**Status:** canonical spec. PiGrow-Client, PiGrow-Server, and PiGrow-UI all build to this.
**Threat model:** opportunistic neighbor on shared WiFi. v1 secures *provisioning* only via a
time-limited 6-digit PIN. Transport (MQTT/REST/Socket.IO) remains anonymous in v1; per-controller
MQTT credentials are *generated and stored* now so a later broker-config flip upgrades transport auth
without a schema migration.

## 1. Overview

A brand-new Raspberry Pi running PiGrow-Client boots in **unclaimed** mode: it has no server-assigned
`controllerId` yet. It advertises itself on the LAN and waits for a claim message. The server
discovers it, the UI shows it, the user types a PIN, the server claims it (creating the Controller +
auto-creating its Sensor/Device rows from the Pi's reported hardware manifest), and the Pi switches to
**active** mode.

States a Controller moves through: `UNCLAIMED` -> `ACTIVE` (on successful claim). `INACTIVE` is a
later off/disabled state. `CLAIMING` is an optional transient state during the claim transaction.

## 2. The ProvisionBeacon (Pi -> LAN)

Emitted by the Pi while unclaimed, over two parallel channels so the server can pick whichever it
prefers. Both carry the **same logical payload**.

### 2.1 Channels
- **UDP broadcast beacon** (primary). Destination `255.255.255.255:9999` (or subnet-directed
  broadcast), sent every `7s`. JSON payload = §2.2. The Pi binds to `0.0.0.0:9999` for sending; the
  server listens on `0.0.0.0:9999`. This is a fire-and-forget presence beacon — the claim handshake
  itself happens over MQTT (§3), not over UDP reply.
- **mDNS / DNS-SD** (supplementary). Service type `_pigrow._tcp.local.`, service name derived from the
  device serial. TXT record fields:
  - `pgv` = protocol schema version (`"1"`)
  - `pgserial` = device serial (string)
  - `pgmac` = MAC address, colon-separated uppercase
  - `pgpin` = 6-digit claim PIN (string, zero-padded)
  - `pgexp` = PIN expiry, Unix epoch ms (string)
  - `pgfw` = firmware/client version (string)
  - `pgbeacon` = base64url-encoded compact JSON of the full §2.2 payload (so the server can recover
    the `hwManifest` from TXT alone without a UDP packet)

The server MAY use either channel; the UDP beacon is authoritative if they disagree (mDNS TXT is
cached longer by resolvers).

### 2.2 UDP beacon payload (JSON)

```json
{
  "schema": 1,
  "serial": "PIGROW-A1B2C3",
  "mac": "AA:BB:CC:DD:EE:FF",
  "ip": "192.168.1.42",
  "fwVersion": "0.4.0",
  "claimPin": "123456",
  "pinExpiresAt": 1737000000000,
  "hwManifest": {
    "sensors": [
      { "type": "BME280", "protocol": "I2C", "i2cBus": 1, "i2cAddr": 118, "interval": 30 }
    ],
    "relays": [
      { "type": "LIGHT", "pin": 17, "name": "Main Light" },
      { "type": "EXHAUST_FAN", "pin": 18 }
    ]
  }
}
```

Field rules:
- `schema` — integer, must be `1` for this spec. Unknown future versions: server ignores the beacon
  (or surfaces "unsupported firmware" in the UI).
- `serial` — stable device identifier the Pi mints once and persists (e.g. `PIGROW-` + 6 hex from
  crypto/rand). Survives reboots. NOT the MQTT client_id; that is separate.
- `mac` — primary network interface MAC, colon-separated uppercase. Used as the Controller's unique
  key for upsert (matches existing `POST /api/controllers` upsert-by-macAddress behavior).
- `ip` — best-effort local IP at beacon time. Informational; the server re-uses its own socket's
  source IP for the UDP packet anyway.
- `fwVersion` — PiGrow-Client semver. Surfaced in UI scan results.
- `claimPin` — exactly 6 ASCII digits, zero-padded (`"000000"`..`"999999"`), generated with
  crypto/rand. Rotates every 5 minutes (`pinExpiresAt`). **Single-use:** invalidated immediately on
  a successful claim; the Pi stops beaconing and switches to active mode.
- `pinExpiresAt` — Unix epoch ms. The server rejects a claim whose PIN is past this.
- `hwManifest` — the Pi's wired hardware. Drives auto-creation of Sensor and Device rows at claim.
  - `sensors[]` — `{ type, protocol, i2cBus?, i2cAddr?, pin?, interval }`. Match key for upsert:
    `(controllerMac, type, protocol, i2cBus, i2cAddr)` for I2C; `(controllerMac, type, protocol, pin)`
    for GPIO/1-wire. `interval` in seconds.
  - `relays[]` — `{ type, pin, name? }`. Match key for upsert: `(controllerMac, pin)`. `type` maps to
    the existing Device `type` enum (LIGHT, EXHAUST_FAN, etc.). `name` optional; server defaults it
    (e.g. `"Light 17"`).

### 2.3 PIN lifecycle
- Generated on first boot (and anytime the Pi is in unclaimed mode with no valid PIN).
- Valid for 5 minutes (`pinExpiresAt = now + 5min`).
- On expiry, a new PIN is generated; the next beacon advertises the new PIN + expiry.
- On a successful claim (server publishes ClaimResponse to `provision/<mac>/claim`), the Pi stops
  beaconing, discards any remaining PIN validity, and switches to active mode. A replay of an old PIN
  therefore cannot re-claim.

## 3. The claim handshake (over MQTT)

The claim message is delivered over the existing Mosquitto broker (anonymous in v1), NOT over UDP —
UDP is presence-only. Topic naming reuses the existing `mac`-keyed convention.

### 3.1 Claim topic
- `provision/<mac>/claim` where `<mac>` is the Pi's MAC, colon-separated uppercase, matching the
  beacon. (e.g. `provision/AA:BB:CC:DD:EE:FF/claim`). QoS 1, retained = false (a stale retained claim
  would auto-re-claim a Pi after a reboot, which we do NOT want — the Pi persists its own claimed
  state locally and never re-enters unclaimed mode once claimed).
- The Pi subscribes to `provision/<mac>/claim` while unclaimed.
- The server publishes the `ClaimResponse` to this topic on a successful `POST /api/controllers/claim`.

### 3.2 ClaimResponse payload (server -> Pi, JSON)

```json
{
  "schema": 1,
  "controllerId": "8e7c1f2a-...",
  "controllerMac": "AA:BB:CC:DD:EE:FF",
  "mqttBrokerUrl": "mqtt://192.168.1.10:1883",
  "mqttUsername": "pigrow-8e7c1f2a",
  "mqttPassword": "<random 24-char base64>",
  "serverHttpUrl": "http://192.168.1.10:3000",
  "pairedAt": 1737000000000
}
```

Field rules:
- `schema` — `1`.
- `controllerId` — UUID the server generated for the Controller row. The Pi persists this and uses it
  for the heartbeat endpoint (`PATCH /api/controllers/<controllerId>/heartbeat`) — replacing the
  today-manual "copy UUID into config.yaml" step.
- `mqttBrokerUrl` — the broker URL the Pi should use for active-mode MQTT. May differ from the
  anonymous broker the Pi used during provisioning (in v1 they're the same; the field exists so a
  later per-credential broker can be a different instance/transport).
- `mqttUsername` / `mqttPassword` — per-controller credentials the server generated and stored (hashed)
  on the Controller row. **v1 broker still has `allow_anonymous true`**, so these are unused by the
  broker today; they're persisted so the Phase-2-security upgrade (broker `allow_anonymous false` +
  ACL by username) is a config flip, not a code change. The Pi stores them and is prepared to send
  them.
- `serverHttpUrl` — base URL for the heartbeat and any future REST calls.
- `pairedAt` — Unix epoch ms, for the Pi's log/diagnostics.

### 3.3 Pi activation
On receiving a `ClaimResponse` whose `controllerMac` matches its own MAC:
1. Verify `schema == 1`.
2. Persist to a new `state.json` (separate from legacy `config.yaml`):
   `{ controllerId, controllerMac, mqttBrokerUrl, mqttUsername, mqttPassword, serverHttpUrl,
      provisionState: "ACTIVE", pairedAt }`.
3. Stop the beacon + unsubscribe from `provision/<mac>/claim`.
4. Reload active configuration: read `state.json` (preferred) over `config.yaml` (legacy). Start the
   heartbeat goroutine (gated on `controllerId != ""`, which is now set). Reconnect MQTT to
   `mqttBrokerUrl` with credentials, publish LWT `{"online":true}` retained, subscribe
   `devices/+/commands`, begin publishing `sensors/<sensorId>/telemetry` and
   `devices/<deviceId>/state`.

## 4. Server scan + claim REST API

### 4.1 `GET /api/controllers/scan`
Returns discovered-but-unclaimed Pis the server has seen via its DiscoveryService (UDP listener +
optional mDNS). Response:

```json
{
  "controllers": [
    {
      "mac": "AA:BB:CC:DD:EE:FF",
      "ip": "192.168.1.42",
      "serial": "PIGROW-A1B2C3",
      "fwVersion": "0.4.0",
      "pinActive": true,
      "hwManifest": { /* §2.2 hwManifest */ }
    }
  ]
}
```

- `pinActive`: true iff `pinExpiresAt` is in the future; false if expired (UI shows "PIN expired,
  waiting for new one").
- Sighting cache TTL: 120s (a Pi that stops beaconing disappears from results after 120s).
- No DB writes from scan. No auth (consistent with v1's no-auth posture; a Phase-2-security task adds
  it to scan + claim together).

### 4.2 `POST /api/controllers/claim`
Request: `{ mac, claimPin, name }` (`ip` optional, taken from the sighting cache by mac).

Server flow (all DB work in one Prisma `$transaction`):
1. Look up sighting in the DiscoveryService cache by `mac`. Reject `404` if missing/expired.
2. Constant-time compare `claimPin` to the cached sighting's `claimPin`. Reject `401` on mismatch or
   if `pinExpiresAt` is past.
3. Upsert `Controller` by `macAddress` (reuse existing `createController` logic): if exists, update
   `name`; if new, create with `status: 'OFFLINE'` (will flip to ONLINE on first heartbeat). Set
   `provisionState: 'ACTIVE'`, `deviceSerial`, `claimPinHash: null` (PIN is single-use; clear on
   success), `pinExpiresAt: null`, `lastBeaconAt: now`.
4. From `hwManifest.sensors`, upsert `Sensor` rows (match-key per §2.2) under this Controller.
5. From `hwManifest.relays`, upsert `Device` rows (match-key `(controllerMac, pin)`) under this
   Controller, with `type`, `pinNumber`, default `automationMode`, default `isActive: false`, and the
   server default `maxOnSeconds` ceiling.
6. Generate per-controller MQTT credentials: `mqttUsername = "pigrow-" + controllerId`,
   `mqttPassword` = 24-char crypto-random base64. Store `mqttPasswordHash` (bcrypt or argon2,
   server's existing choice) on the Controller; store the *plaintext* only in the ClaimResponse
   message (never persisted in plaintext server-side).
7. Build `ClaimResponse`, publish to MQTT `provision/<mac>/claim` QoS 1, retained=false.
8. Return `{ controller: <Controller row incl. id> }` to the UI (201 on first claim, 200 on
   re-claim of an existing mac).

### 4.3 Re-claim semantics
- Re-claiming an already-ACTIVE Controller (user re-provisions a Pi that was reset to unclaimed) is
  allowed: the Controller row is updated (not duplicated) and its Sensors/Devices are upserted by
  match-key (changed wiring merges, never duplicates).
- The PIN is single-use per claim: after a successful claim the Pi stops beaconing, so a second claim
  against the same mac must come from a *fresh* unclaimed cycle (new PIN). The server does not keep a
  reusable PIN.

## 5. Backward compatibility

- Existing manually-configured Controllers (operator hand-wrote `config.yaml` with a copied
  `controller_id`) keep working unchanged. Active-mode config resolution prefers `state.json` and
  falls back to `config.yaml`; a legacy Pi has no `state.json` and reads `config.yaml` as today.
- `mqttTopic` deprecation and `maxOnSeconds` addition are untouched.
- New schema fields are additive, nullable-with-defaults, so the Prisma migration is non-breaking.
- The existing `POST /api/controllers` (manual create by mac+ip+name) stays — the UI can still add a
  Controller by typing its MAC/IP. Scan + claim is an alternative path, not a replacement.

## 6. Out of scope (v1)

- Per-controller Ed25519 keypair + server-issued MQTT tokens (Phase 2 security).
- Switching the broker to `allow_anonymous false` (Phase 2 security; creds already persisted).
- TLS on MQTT / REST / Socket.IO.
- GPIO/I2C auto-detect (replaces the hand-written `hardware.yaml`).
- `--setup-ap` captive-portal fallback (designed for, not built in v1).
- Remote/cloud server support (v1 is same-LAN only).

## 7. Schema additions (Prisma model `Controller`)

```
provisionState     DeviceProvisionState @default(ACTIVE)   // UNCLAIMED | ACTIVE | INACTIVE
deviceSerial       String?
claimPinHash       String?
pinExpiresAt       DateTime?
lastBeaconAt       DateTime?
mqttUsername       String?                            @unique
mqttPasswordHash   String?
```

`DeviceProvisionState` enum values migrate clean for existing rows (`ACTIVE` default). No existing
field is renamed or removed.