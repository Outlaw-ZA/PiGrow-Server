import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestApp, teardownTestApp } from "../test-helper.js";
import { resolvePeriod } from "../../../automation/period.js";
import { evaluateThresholds } from "../../../automation/evaluator.js";
import { lightScheduler } from "../../../automation/scheduler.js";

describe("Automation engine", () => {
  let prismaClient: any;
  let testApp: any;
  let controllerId: string;
  let growCycleId: string;
  let growPhaseId: string;
  let lightId: string;
  let fanId: string;
  let heaterId: string;

  const mac = `77:88:99:aa:bb:${Date.now().toString(16).slice(-2)}`;

  before(async () => {
    const { server, prisma } = await createTestApp();
    prismaClient = prisma;
    testApp = server;
    // The server is needed only to boot the prisma plugin decoration.
    // It is closed in `after` via teardownTestApp.

    const controller = await prisma.controller.create({
      data: {
        growCycles: {
          create: {
            isActive: true,
            name: "Engine Test Cycle",
            phases: {
              create: {
                name: "Veg",
                order: 1,
                durationDays: 30,
                isActive: true,
                // 06:00..24:00 (default 18/6)
                dayStartMinutes: 360,
                dayDurationMinutes: 1080,
              },
            },
          },
        },
        ipAddress: "192.168.1.130",
        macAddress: mac,
        name: "Automation Engine Test Pi",
      },
      include: { growCycles: { include: { phases: true } } },
    });
    controllerId = controller.id;
    growCycleId = controller.growCycles[0].id;
    growPhaseId = controller.growCycles[0].phases[0].id;

    await prisma.sensor.create({
      data: {
        controllerId,
        name: "DHT22",
        pinNumbers: [4],
        protocol: "I2C",
        type: "TEMPERATURE",
      },
    });

    const light = await prisma.device.create({
      data: {
        automationMode: "SCHEDULED",
        controllerId,
        name: "Light",
        pinNumber: 4,
        type: "LIGHT",
      },
    });
    const fan = await prisma.device.create({
      data: {
        automationMode: "THRESHOLD",
        controllerId,
        name: "Exhaust Fan",
        pinNumber: 17,
        type: "EXHAUST_FAN",
      },
    });
    const heater = await prisma.device.create({
      data: {
        automationMode: "THRESHOLD",
        controllerId,
        name: "Heater",
        pinNumber: 27,
        type: "HEATER",
      },
    });
    lightId = light.id;
    fanId = fan.id;
    heaterId = heater.id;
  });

  after(async () => {
    await prismaClient.automationRule.deleteMany({
      where: { device: { controllerId } },
    });
    await prismaClient.deviceStateLog.deleteMany({
      where: { device: { controllerId } },
    });
    await prismaClient.phaseEnvironment.deleteMany({
      where: { growPhase: { growCycle: { controllerId } } },
    });
    await prismaClient.device.deleteMany({ where: { controllerId } });
    await prismaClient.telemetry.deleteMany({ where: { growCycleId } });
    await prismaClient.sensor.deleteMany({ where: { controllerId } });
    await prismaClient.growCycle.deleteMany({
      where: { controller: { macAddress: mac } },
    });
    await prismaClient.controller.deleteMany({ where: { macAddress: mac } });
    await teardownTestApp(testApp);
  });

  // ---------- period resolver ----------

  test("resolvePeriod - returns DAY for a time inside the day window (06:00..24:00)", () => {
    const noon = new Date("2026-07-01T12:00:00");
    assert.equal(resolvePeriod(360, 1080, noon), "DAY");
  });

  test("resolvePeriod - returns NIGHT for a time outside the day window", () => {
    const midnight = new Date("2026-07-01T02:00:00");
    assert.equal(resolvePeriod(360, 1080, midnight), "NIGHT");
  });

  test("resolvePeriod - handles a wrap-past-midnight schedule (18/6 starting at 18:00)", () => {
    // Day = 18:00..12:00. 20:00 is day.
    const eightPm = new Date("2026-07-01T20:00:00");
    assert.equal(resolvePeriod(1080, 720, eightPm), "DAY");
    // 03:00 is also day (window wraps).
    const threeAm = new Date("2026-07-01T03:00:00");
    assert.equal(resolvePeriod(1080, 720, threeAm), "DAY");
    // 15:00 is night.
    const threePm = new Date("2026-07-01T15:00:00");
    assert.equal(resolvePeriod(1080, 720, threePm), "NIGHT");
  });

  test("resolvePeriod - all-day when dayDurationMinutes = 1440", () => {
    const anyTime = new Date("2026-07-01T03:00:00");
    assert.equal(resolvePeriod(0, 1440, anyTime), "DAY");
  });

  test("resolvePeriod - all-night when dayDurationMinutes = 0", () => {
    const anyTime = new Date("2026-07-01T15:00:00");
    assert.equal(resolvePeriod(360, 0, anyTime), "NIGHT");
  });

  // ---------- evaluator (threshold rules) ----------

  test("evaluator - fires ABOVE_MAX rule when telemetry value exceeds the active DAY tempMax", async () => {
    // Configure DAY env: tempMax = 28
    await prismaClient.phaseEnvironment.create({
      data: {
        growPhaseId,
        humidityMax: 80,
        humidityMin: 50,
        period: "DAY",
        tempMax: 28,
        tempMin: 22,
      },
    });
    // Create the rule: fan ABOVE_MAX on TEMPERATURE, DAY
    await prismaClient.automationRule.create({
      data: {
        action: "ON",
        condition: "ABOVE_MAX",
        cooldownSeconds: 0, // Disable cooldown for the test
        deviceId: fanId,
        growPhaseId,
        period: "DAY",
        watchedSensorType: "TEMPERATURE",
      },
    });

    // First reading: 31°C -> ABOVE 28 -> command ON issued
    await evaluateThresholds({
      growCycleId,
      now: new Date("2026-07-01T12:00:00"),
      sensorId: 'test-sensor-id',
      sensorType: "TEMPERATURE",
      value: 31,
    });

    const log = await prismaClient.deviceStateLog.findFirst({
      orderBy: { createdAt: "desc" },
      where: { deviceId: fanId },
    });
    assert.ok(log, "DeviceStateLog should be written");
    assert.equal(log.action, "ON");
    assert.equal(log.source, "AUTO");
    assert.match(log.reason ?? "", /TEMP.*31.*max 28/);

    // Second reading: same value, hysteresis kicks in -> no new log
    const before = await prismaClient.deviceStateLog.count({
      where: { deviceId: fanId },
    });
    await evaluateThresholds({
      growCycleId,
      now: new Date("2026-07-01T12:00:01"),
      sensorId: 'test-sensor-id',
      sensorType: "TEMPERATURE",
      value: 32,
    });
    const after = await prismaClient.deviceStateLog.count({
      where: { deviceId: fanId },
    });
    assert.equal(after, before, "Hysteresis: no duplicate ON command");
  });

  test("evaluator - BELOW_MIN rule fires on a heater when temp drops below the active NIGHT tempMin", async () => {
    // Configure NIGHT env
    await prismaClient.phaseEnvironment.create({
      data: {
        growPhaseId,
        humidityMax: 80,
        humidityMin: 50,
        period: "NIGHT",
        tempMax: 24,
        tempMin: 19,
      },
    });
    await prismaClient.automationRule.create({
      data: {
        action: "ON",
        condition: "BELOW_MIN",
        cooldownSeconds: 0,
        deviceId: heaterId,
        growPhaseId,
        period: "NIGHT",
        watchedSensorType: "TEMPERATURE",
      },
    });

    // 17°C at 02:00 (NIGHT for an 18/6 schedule starting at 06:00) -> below 19 -> ON
    await evaluateThresholds({
      growCycleId,
      now: new Date("2026-07-01T02:00:00"),
      sensorId: 'test-sensor-id',
      sensorType: "TEMPERATURE",
      value: 17,
    });

    const log = await prismaClient.deviceStateLog.findFirst({
      orderBy: { createdAt: "desc" },
      where: { deviceId: heaterId },
    });
    assert.ok(log);
    assert.equal(log.action, "ON");
    assert.match(log.reason ?? "", /TEMP.*17.*min 19/);
  });

  // ---------- DeviceThresholdHold writes (threshold overrides interval) ----------

  test("evaluator - writes a DeviceThresholdHold row when a threshold rule fires", async () => {
    // Fresh setup: clean the heater's state + rules, then create a NIGHT env
    // + BELOW_MIN rule, fire it, and assert the hold row exists with the
    // Correct heldUntil and ruleId.
    await prismaClient.deviceStateLog.deleteMany({ where: { deviceId: heaterId } });
    await prismaClient.automationRule.deleteMany({ where: { deviceId: heaterId } });
    await prismaClient.phaseEnvironment.deleteMany({
      where: { growPhaseId, period: "NIGHT" },
    });
    await prismaClient.phaseEnvironment.create({
      data: {
        growPhaseId,
        period: "NIGHT",
        tempMax: 24,
        tempMin: 19,
      },
    });
    const rule = await prismaClient.automationRule.create({
      data: {
        action: "ON",
        condition: "BELOW_MIN",
        cooldownSeconds: 0,
        deviceId: heaterId,
        growPhaseId,
        period: "NIGHT",
        watchedSensorType: "TEMPERATURE",
      },
    });

    const fireAt = new Date("2026-07-01T02:00:00");
    await evaluateThresholds({
      growCycleId,
      now: fireAt,
      sensorId: 'test-sensor-id',
      sensorType: "TEMPERATURE",
      value: 17,
    });

    const hold = await prismaClient.deviceThresholdHold.findUnique({
      where: { deviceId: heaterId },
    });
    assert.ok(hold, "DeviceThresholdHold should be written on a threshold fire");
    assert.equal(hold.ruleId, rule.id);
    // HeldUntil is now + cooldownSeconds (0 -> now). Use a small tolerance.
    assert.ok(
      Math.abs(hold.heldUntil.getTime() - fireAt.getTime()) < 50,
      `heldUntil should be ~${fireAt.toISOString()}, got ${hold.heldUntil.toISOString()}`,
    );
  });

  test("evaluator - refreshes the DeviceThresholdHold on a subsequent fire", async () => {
    // Hold from the previous test exists. Fire again with cooldownSeconds=120
    // And assert heldUntil moves to now + 120s. To do that, update the rule's
    // Cooldown to 120 (the previous test used 0).
    const rule = await prismaClient.automationRule.findFirstOrThrow({
      where: { condition: "BELOW_MIN", deviceId: heaterId },
    });
    await prismaClient.automationRule.update({
      data: { cooldownSeconds: 120 },
      where: { id: rule.id },
    });

    const fireAt = new Date("2026-07-01T03:00:00");
    await evaluateThresholds({
      growCycleId,
      now: fireAt,
      sensorId: 'test-sensor-id',
      sensorType: "TEMPERATURE",
      value: 16,
    });

    const hold = await prismaClient.deviceThresholdHold.findUnique({
      where: { deviceId: heaterId },
    });
    assert.ok(hold);
    const expected = fireAt.getTime() + 120_000;
    assert.ok(
      Math.abs(hold.heldUntil.getTime() - expected) < 50,
      `heldUntil should be ~${new Date(expected).toISOString()}, got ${hold.heldUntil.toISOString()}`,
    );
    assert.equal(hold.ruleId, rule.id);
  });

  test("evaluator - does NOT write a DeviceThresholdHold when the threshold does not fire", async () => {
    // Clean the hold. Then evaluate a reading that does NOT cross any
    // Threshold (25°C at night when tempMin=19, tempMax=24 -> 25 > 24, ABOVE_MAX).
    // Wait — the heater rule is BELOW_MIN. A reading of 25°C does not cross
    // BELOW_MIN (25 > 19). The heater has a BELOW_MIN rule (action ON when
    // Temp < 19). 25 does not fire it. So no fire -> no hold write.
    // But there might be a hold from the previous test. Delete it first.
    await prismaClient.deviceThresholdHold.deleteMany({
      where: { deviceId: heaterId },
    });

    await evaluateThresholds({
      growCycleId,
      now: new Date("2026-07-01T02:00:00"),
      sensorId: 'test-sensor-id',
      sensorType: "TEMPERATURE",
      value: 25,
    });

    const hold = await prismaClient.deviceThresholdHold.findUnique({
      where: { deviceId: heaterId },
    });
    assert.equal(hold, null, "No hold should be written when no threshold fires");
  });

  // ---------- ABOVE_MIN / BELOW_MAX / ABOVE_TARGET / BELOW_TARGET rule conditions ----------

  test("evaluator - BELOW_MAX rule fires when telemetry value drops below the active DAY tempMax", async () => {
    // Reuse the DAY env created by the ABOVE_MAX test (tempMax=28, tempMin=22).
    // Clear the fan's prior state and ALL its prior rules so the only rule
    // That can fire is the one this test creates (hysteresis + rule isolation).
    await prismaClient.deviceStateLog.deleteMany({ where: { deviceId: fanId } });
    await prismaClient.automationRule.deleteMany({
      where: { deviceId: fanId },
    });
    await prismaClient.automationRule.create({
      data: {
        action: "ON",
        condition: "BELOW_MAX",
        cooldownSeconds: 0,
        deviceId: fanId,
        growPhaseId,
        period: "DAY",
        watchedSensorType: "TEMPERATURE",
      },
    });

    // 27°C at noon (DAY for 18/6 starting at 06:00) -> below 28 -> ON
    await evaluateThresholds({
      growCycleId,
      now: new Date("2026-07-01T12:00:00"),
      sensorId: 'test-sensor-id',
      sensorType: "TEMPERATURE",
      value: 27,
    });

    const log = await prismaClient.deviceStateLog.findFirst({
      orderBy: { createdAt: "desc" },
      where: { deviceId: fanId, source: "AUTO" },
    });
    assert.ok(log, "DeviceStateLog should be written for BELOW_MAX fire");
    assert.equal(log.action, "ON");
    assert.match(log.reason ?? "", /TEMP.*27.*max 28/);
  });

  test("evaluator - ABOVE_MIN rule fires when telemetry value rises above the active NIGHT tempMin", async () => {
    // Reuse the NIGHT env created by the BELOW_MIN test (tempMax=24, tempMin=19).
    // Clear the heater's prior state and ALL its prior rules so the only rule
    // That can fire is the one this test creates (hysteresis + rule isolation).
    await prismaClient.deviceStateLog.deleteMany({ where: { deviceId: heaterId } });
    await prismaClient.automationRule.deleteMany({
      where: { deviceId: heaterId },
    });
    await prismaClient.automationRule.create({
      data: {
        action: "ON",
        condition: "ABOVE_MIN",
        cooldownSeconds: 0,
        deviceId: heaterId,
        growPhaseId,
        period: "NIGHT",
        watchedSensorType: "TEMPERATURE",
      },
    });

    // 20°C at 02:00 (NIGHT for 18/6 starting at 06:00) -> above 19 -> ON
    await evaluateThresholds({
      growCycleId,
      now: new Date("2026-07-01T02:00:00"),
      sensorId: 'test-sensor-id',
      sensorType: "TEMPERATURE",
      value: 20,
    });

    const log = await prismaClient.deviceStateLog.findFirst({
      orderBy: { createdAt: "desc" },
      where: { deviceId: heaterId, source: "AUTO" },
    });
    assert.ok(log, "DeviceStateLog should be written for ABOVE_MIN fire");
    assert.equal(log.action, "ON");
    assert.match(log.reason ?? "", /TEMP.*20.*min 19/);
  });

  test("evaluator - ABOVE_TARGET rule fires when telemetry value exceeds the active DAY tempTarget", async () => {
    // Upsert DAY env to add tempTarget=25 alongside the existing tempMax/tempMin.
    await prismaClient.phaseEnvironment.upsert({
      create: { growPhaseId, period: "DAY", tempMax: 28, tempMin: 22, tempTarget: 25 },
      update: { tempTarget: 25 },
      where: { growPhaseId_period: { growPhaseId, period: "DAY" } },
    });
    // Clear the fan's prior state and ALL its prior rules so the only rule
    // That can fire is the one this test creates (hysteresis + rule isolation).
    await prismaClient.deviceStateLog.deleteMany({ where: { deviceId: fanId } });
    await prismaClient.automationRule.deleteMany({
      where: { deviceId: fanId },
    });
    await prismaClient.automationRule.create({
      data: {
        action: "ON",
        condition: "ABOVE_TARGET",
        cooldownSeconds: 0,
        deviceId: fanId,
        growPhaseId,
        period: "DAY",
        watchedSensorType: "TEMPERATURE",
      },
    });

    // 26°C at noon (DAY) -> above target 25 -> ON
    await evaluateThresholds({
      growCycleId,
      now: new Date("2026-07-01T12:00:00"),
      sensorId: 'test-sensor-id',
      sensorType: "TEMPERATURE",
      value: 26,
    });

    const log = await prismaClient.deviceStateLog.findFirst({
      orderBy: { createdAt: "desc" },
      where: { deviceId: fanId, source: "AUTO" },
    });
    assert.ok(log, "DeviceStateLog should be written for ABOVE_TARGET fire");
    assert.equal(log.action, "ON");
    assert.match(log.reason ?? "", /TEMP.*26.*target 25/);
  });

  test("evaluator - BELOW_TARGET rule fires when telemetry value drops below the active NIGHT tempTarget", async () => {
    // Upsert NIGHT env to add tempTarget=20 alongside the existing tempMax/tempMin.
    await prismaClient.phaseEnvironment.upsert({
      create: { growPhaseId, period: "NIGHT", tempMax: 24, tempMin: 19, tempTarget: 20 },
      update: { tempTarget: 20 },
      where: { growPhaseId_period: { growPhaseId, period: "NIGHT" } },
    });
    // Clear the heater's prior state and ALL its prior rules so the only rule
    // That can fire is the one this test creates (hysteresis + rule isolation).
    await prismaClient.deviceStateLog.deleteMany({ where: { deviceId: heaterId } });
    await prismaClient.automationRule.deleteMany({
      where: { deviceId: heaterId },
    });
    await prismaClient.automationRule.create({
      data: {
        action: "ON",
        condition: "BELOW_TARGET",
        cooldownSeconds: 0,
        deviceId: heaterId,
        growPhaseId,
        period: "NIGHT",
        watchedSensorType: "TEMPERATURE",
      },
    });

    // 18°C at 02:00 (NIGHT) -> below target 20 -> ON
    await evaluateThresholds({
      growCycleId,
      now: new Date("2026-07-01T02:00:00"),
      sensorId: 'test-sensor-id',
      sensorType: "TEMPERATURE",
      value: 18,
    });

    const log = await prismaClient.deviceStateLog.findFirst({
      orderBy: { createdAt: "desc" },
      where: { deviceId: heaterId, source: "AUTO" },
    });
    assert.ok(log, "DeviceStateLog should be written for BELOW_TARGET fire");
    assert.equal(log.action, "ON");
    assert.match(log.reason ?? "", /TEMP.*18.*target 20/);
  });

  test("evaluator - rule scoped to a different period does not fire", async () => {
    // 31°C at 02:00 (NIGHT) with the DAY-only ABOVE_MAX rule should NOT fire
    const before = await prismaClient.deviceStateLog.count({
      where: { deviceId: fanId },
    });
    await evaluateThresholds({
      growCycleId,
      now: new Date("2026-07-01T02:00:00"),
      sensorId: 'test-sensor-id',
      sensorType: "TEMPERATURE",
      value: 31,
    });
    const after = await prismaClient.deviceStateLog.count({
      where: { deviceId: fanId },
    });
    assert.equal(after, before, "Period mismatch -> no command");
  });

  test("evaluator - null period rule applies in BOTH day and night", async () => {
    // Create a null-period rule (applies both DAY and NIGHT)
    await prismaClient.automationRule.create({
      data: {
        action: "OFF",
        condition: "BELOW_MIN",
        cooldownSeconds: 0,
        deviceId: heaterId,
        growPhaseId,
        period: null,
        watchedSensorType: "TEMPERATURE",
      },
    });

    // Heater is currently ON. Reading 30°C (above NIGHT min 19) -> rule wants OFF
    // At 12:00 (DAY) -> no DAY env, but rule is null-period, condition BELOW_MIN,
    // So we should only fire if NIGHT env.min exists and value < min. We DID set
    // NIGHT min to 19 earlier, and the rule is null-period so it checks the
    // Current period's env. At DAY with no DAY env, getBoundaryFields returns
    // Null boundary -> we already early-return in that case. So the rule never
    // Fires at noon. Verify no new log.
    const before = await prismaClient.deviceStateLog.count({
      where: { deviceId: heaterId, source: "AUTO" },
    });
    await evaluateThresholds({
      growCycleId,
      now: new Date("2026-07-01T12:00:00"),
      sensorId: 'test-sensor-id',
      sensorType: "TEMPERATURE",
      value: 30,
    });
    const after = await prismaClient.deviceStateLog.count({
      where: { deviceId: heaterId, source: "AUTO" },
    });
    assert.equal(after, before);
  });

  test("evaluator - device with MANUAL automationMode is never auto-driven", async () => {
    // Switch the fan to MANUAL and add a fresh rule
    await prismaClient.device.update({
      data: { automationMode: "MANUAL" },
      where: { id: fanId },
    });
    const before = await prismaClient.deviceStateLog.count({
      where: { deviceId: fanId, source: "AUTO" },
    });
    await evaluateThresholds({
      growCycleId,
      now: new Date("2026-07-01T12:00:00"),
      sensorId: 'test-sensor-id',
      sensorType: "TEMPERATURE",
      value: 99,
    });
    const after = await prismaClient.deviceStateLog.count({
      where: { deviceId: fanId, source: "AUTO" },
    });
    assert.equal(after, before, "MANUAL device is ignored by the evaluator");
  });

  test("evaluator - non-active grow cycle is a no-op even if rules exist", async () => {
    await prismaClient.growCycle.update({
      data: { isActive: false },
      where: { id: growCycleId },
    });
    const before = await prismaClient.deviceStateLog.count();
    await evaluateThresholds({
      growCycleId,
      now: new Date("2026-07-01T12:00:00"),
      sensorId: 'test-sensor-id',
      sensorType: "TEMPERATURE",
      value: 99,
    });
    const after = await prismaClient.deviceStateLog.count();
    assert.equal(after, before, "Inactive cycle: no commands");
    // Re-activate for any subsequent tests
    await prismaClient.growCycle.update({
      data: { isActive: true },
      where: { id: growCycleId },
    });
  });

  // ---------- light scheduler (drives LIGHT devices directly) ----------

  test("light scheduler - drives a SCHEDULED LIGHT to ON during the day period (no rules needed)", async () => {
    // Clear prior logs and ensure the LIGHT is in a known OFF state.
    await prismaClient.deviceStateLog.deleteMany({ where: { deviceId: lightId } });
    await prismaClient.device.update({
      data: { isActive: false },
      where: { id: lightId },
    });
    // Defensive: if any prior scheduler runs left an AutomationRule for this
    // Light, clear it — the new scheduler does not consult rules.
    await prismaClient.automationRule.deleteMany({ where: { deviceId: lightId } });

    // Tick at noon (DAY for the 18/6 schedule starting at 06:00) -> ON
    await lightScheduler.tick(new Date("2026-07-01T12:00:00"));

    const onLog = await prismaClient.deviceStateLog.findFirst({
      orderBy: { createdAt: "desc" },
      where: { action: "ON", deviceId: lightId, source: "AUTO" },
    });
    assert.ok(onLog, "Light ON log written by scheduler");
    assert.match(onLog.reason ?? "", /day cycle start/);

    const light = await prismaClient.device.findUnique({ where: { id: lightId } });
    assert.equal(light.isActive, true);

    // Tick again at noon -> hysteresis prevents a second MQTT command, but
    // The scheduler still writes a log entry for the state history chart.
    const before = await prismaClient.deviceStateLog.count({
      where: { deviceId: lightId, source: "AUTO" },
    });
    await lightScheduler.tick(new Date("2026-07-01T12:00:30"));
    const after = await prismaClient.deviceStateLog.count({
      where: { deviceId: lightId, source: "AUTO" },
    });
    assert.equal(after, before + 1, "Scheduler writes a tick log even when state is unchanged");
  });

  test("light scheduler - drives a SCHEDULED LIGHT to OFF when night begins", async () => {
    // Tick at 02:00 (NIGHT for the 18/6 schedule starting at 06:00) -> OFF
    await lightScheduler.tick(new Date("2026-07-01T02:00:00"));

    const offLog = await prismaClient.deviceStateLog.findFirst({
      orderBy: { createdAt: "desc" },
      where: { action: "OFF", deviceId: lightId, source: "AUTO" },
    });
    assert.ok(offLog, "Light OFF log written by scheduler");
    assert.match(offLog.reason ?? "", /night cycle start/);

    const light = await prismaClient.device.findUnique({ where: { id: lightId } });
    assert.equal(light.isActive, false);
  });

  test("light scheduler - leaves a MANUAL LIGHT untouched", async () => {
    // Set the fan to be a LIGHT in MANUAL mode for this scenario, since
    // The test fixture's fan is an EXHAUST_FAN. Use a fresh device.
    const manualLight = await prismaClient.device.create({
      data: {
        automationMode: "MANUAL",
        controllerId,
        isActive: false,
        name: "Manual Light (scheduler test)",
        pinNumber: 24,
        type: "LIGHT",
      },
    });

    await lightScheduler.tick(new Date("2026-07-01T12:00:00"));

    const log = await prismaClient.deviceStateLog.findFirst({
      where: { deviceId: manualLight.id, source: "AUTO" },
    });
    assert.equal(log, null, "MANUAL light should not be driven by the scheduler");

    const after = await prismaClient.device.findUnique({ where: { id: manualLight.id } });
    assert.equal(after.isActive, false, "MANUAL light should remain in its initial state");
  });

  test("light scheduler - never turns an ALWAYS_ON LIGHT OFF", async () => {
    const alwaysOnLight = await prismaClient.device.create({
      data: {
        automationMode: "ALWAYS_ON",
        controllerId,
        isActive: true,
        name: "Always On Light (scheduler test)",
        pinNumber: 25,
        type: "LIGHT",
      },
    });

    // Tick at 02:00 (NIGHT) -> desiredAction OFF -> skipped for ALWAYS_ON
    await lightScheduler.tick(new Date("2026-07-01T02:00:00"));

    const offLog = await prismaClient.deviceStateLog.findFirst({
      where: { action: "OFF", deviceId: alwaysOnLight.id, source: "AUTO" },
    });
    assert.equal(offLog, null, "ALWAYS_ON light must never receive an OFF command");

    const after = await prismaClient.device.findUnique({ where: { id: alwaysOnLight.id } });
    assert.equal(after.isActive, true, "ALWAYS_ON light should remain ON");
  });

  // ---------- ALWAYS_ON / ALWAYS_OFF rule conditions ----------

  test("evaluator - ABOVE_MAX rule is suppressed when an ALWAYS_ON rule covers the same device", async () => {
    // Ensure the fan has both a NIGHT ABOVE_MAX rule and an ALWAYS_ON rule.
    // Configure NIGHT env to keep ABOVE_MAX fires deterministic.
    await prismaClient.phaseEnvironment.upsert({
      create: { growPhaseId, period: "DAY", tempMax: 28, tempMin: 22 },
      update: { tempMax: 28 },
      where: { growPhaseId_period: { growPhaseId, period: "DAY" } },
    });
    await prismaClient.automationRule.deleteMany({ where: { deviceId: fanId } });
    await prismaClient.automationRule.create({
      data: {
        action: "ON",
        condition: "ABOVE_MAX",
        cooldownSeconds: 0,
        deviceId: fanId,
        growPhaseId,
        period: null,
        watchedSensorType: "TEMPERATURE",
      },
    });
    await prismaClient.automationRule.create({
      data: {
        action: "ON",
        condition: "ALWAYS_ON",
        deviceId: fanId,
        growPhaseId,
        period: null,
        watchedSensorType: null,
      },
    });
    // Reset fan state for a clean assertion.
    await prismaClient.device.update({
      data: { isActive: false },
      where: { id: fanId },
    });
    await prismaClient.deviceStateLog.deleteMany({ where: { deviceId: fanId } });

    // Hot reading at noon -> ABOVE_MAX would normally fire, but the ALWAYS_ON
    // Rule suppresses it for this device in this scope.
    const before = await prismaClient.deviceStateLog.count({
      where: { deviceId: fanId, source: "AUTO" },
    });
    await evaluateThresholds({
      growCycleId,
      now: new Date("2026-07-01T12:00:00"),
      sensorId: 'test-sensor-id',
      sensorType: "TEMPERATURE",
      value: 99,
    });
    const after = await prismaClient.deviceStateLog.count({
      where: { deviceId: fanId, source: "AUTO" },
    });
    assert.equal(
      after,
      before,
      "evaluator should not fire ABOVE_MAX for a device pinned by ALWAYS_ON",
    );
  });

  test("evaluator - suppression is per-scope: ALWAYS_ON in a different phase does not suppress a threshold rule", async () => {
    // Always-on rule is cycle-scoped (rare case where the rule belongs to the
    // Cycle, not a phase). The threshold rule is phase-scoped. Cycle-scoped
    // Rules apply across all phases in the cycle, so this DOES suppress.
    // This test is asserting the behavior: a cycle-scoped ALWAYS_ON pin
    // Suppresses phase-scoped threshold rules in the cycle.
    await prismaClient.automationRule.deleteMany({ where: { deviceId: fanId } });
    await prismaClient.automationRule.create({
      data: {
        action: "ON",
        condition: "ABOVE_MAX",
        cooldownSeconds: 0,
        deviceId: fanId,
        growPhaseId,
        period: "DAY",
        watchedSensorType: "TEMPERATURE",
      },
    });
    await prismaClient.automationRule.create({
      data: {
        action: "ON",
        condition: "ALWAYS_ON",
        deviceId: fanId,
        growCycleId,
        period: "DAY",
        watchedSensorType: null,
      },
    });
    await prismaClient.deviceStateLog.deleteMany({ where: { deviceId: fanId } });

    const before = await prismaClient.deviceStateLog.count({
      where: { deviceId: fanId, source: "AUTO" },
    });
    await evaluateThresholds({
      growCycleId,
      now: new Date("2026-07-01T12:00:00"), // DAY for the 18/6 schedule
      sensorId: 'test-sensor-id',
      sensorType: "TEMPERATURE",
      value: 99,
    });
    const after = await prismaClient.deviceStateLog.count({
      where: { deviceId: fanId, source: "AUTO" },
    });
    assert.equal(
      after,
      before,
      "cycle-scoped ALWAYS_ON in the active period suppresses the phase-scoped ABOVE_MAX",
    );

    // Clean up the cycle-scoped rule.
    await prismaClient.automationRule.deleteMany({
      where: { condition: "ALWAYS_ON", deviceId: fanId, growCycleId },
    });
  });

  test("scheduler - ALWAYS_ON rule pins a non-LIGHT device to ON, even with no threshold trigger", async () => {
    // Earlier tests left the fan in MANUAL; reset to THRESHOLD so the
    // Scheduler will actually drive it.
    await prismaClient.device.update({
      data: { automationMode: "THRESHOLD" },
      where: { id: fanId },
    });
    await prismaClient.automationRule.deleteMany({ where: { deviceId: fanId } });
    await prismaClient.automationRule.create({
      data: {
        action: "ON",
        condition: "ALWAYS_ON",
        deviceId: fanId,
        growPhaseId,
        period: null,
        watchedSensorType: null,
      },
    });
    await prismaClient.device.update({
      data: { isActive: false },
      where: { id: fanId },
    });
    await prismaClient.deviceStateLog.deleteMany({ where: { deviceId: fanId } });

    // Tick at 02:00 (NIGHT) — no threshold reading needed, the rule should fire.
    await lightScheduler.tick(new Date("2026-07-01T02:00:00"));

    const onLog = await prismaClient.deviceStateLog.findFirst({
      orderBy: { createdAt: "desc" },
      where: { action: "ON", deviceId: fanId, source: "AUTO" },
    });
    assert.ok(onLog, "ALWAYS_ON rule should drive the device to ON");
    assert.match(onLog.reason ?? "", /ALWAYS_ON rule/);

    const fan = await prismaClient.device.findUnique({ where: { id: fanId } });
    assert.equal(fan.isActive, true);

    // Hysteresis prevents a second MQTT command, but the scheduler still
    // Writes a tick log for the state history chart.
    const before = await prismaClient.deviceStateLog.count({
      where: { deviceId: fanId, source: "AUTO" },
    });
    await lightScheduler.tick(new Date("2026-07-01T02:00:30"));
    const after = await prismaClient.deviceStateLog.count({
      where: { deviceId: fanId, source: "AUTO" },
    });
    assert.equal(after, before + 1, "Scheduler writes a tick log even when state is unchanged");
  });

  test("scheduler - ALWAYS_OFF rule with period: DAY does not fire at NIGHT", async () => {
    // Earlier tests left the fan in MANUAL; reset to THRESHOLD so the
    // Scheduler will actually drive it.
    await prismaClient.device.update({
      data: { automationMode: "THRESHOLD" },
      where: { id: fanId },
    });
    // Create a cycle-scoped fan with period: DAY ALWAYS_OFF. At NIGHT the rule
    // Does not match the current period, so the device should not be driven.
    await prismaClient.automationRule.deleteMany({ where: { deviceId: fanId } });
    await prismaClient.automationRule.create({
      data: {
        action: "OFF",
        condition: "ALWAYS_OFF",
        deviceId: fanId,
        growPhaseId,
        period: "DAY",
        watchedSensorType: null,
      },
    });
    await prismaClient.device.update({
      data: { isActive: true },
      where: { id: fanId },
    });
    await prismaClient.deviceStateLog.deleteMany({ where: { deviceId: fanId } });

    // Tick at 02:00 (NIGHT) — the rule's period is DAY, so it does not apply.
    await lightScheduler.tick(new Date("2026-07-01T02:00:00"));

    const offLog = await prismaClient.deviceStateLog.findFirst({
      where: { action: "OFF", deviceId: fanId, source: "AUTO" },
    });
    assert.equal(offLog, null, "ALWAYS_OFF rule scoped to DAY must not fire at NIGHT");

    // Tick at 12:00 (DAY) — the rule applies now, drives the device to OFF.
    await lightScheduler.tick(new Date("2026-07-01T12:00:00"));

    const newOffLog = await prismaClient.deviceStateLog.findFirst({
      orderBy: { createdAt: "desc" },
      where: { action: "OFF", deviceId: fanId, source: "AUTO" },
    });
    assert.ok(newOffLog, "ALWAYS_OFF rule should drive the device OFF during DAY");
    assert.match(newOffLog.reason ?? "", /ALWAYS_OFF rule/);
  });

  test("scheduler - ALWAYS_ON rule fires even when the device's automationMode is MANUAL", async () => {
    // Switch the fan to MANUAL and confirm the scheduler still drives it.
    await prismaClient.automationRule.deleteMany({ where: { deviceId: fanId } });
    await prismaClient.automationRule.create({
      data: {
        action: "ON",
        condition: "ALWAYS_ON",
        deviceId: fanId,
        growPhaseId,
        period: null,
        watchedSensorType: null,
      },
    });
    await prismaClient.device.update({
      data: { automationMode: "MANUAL", isActive: false },
      where: { id: fanId },
    });
    await prismaClient.deviceStateLog.deleteMany({ where: { deviceId: fanId } });

    await lightScheduler.tick(new Date("2026-07-01T12:00:00"));

    const log = await prismaClient.deviceStateLog.findFirst({
      where: { deviceId: fanId, source: "AUTO" },
    });
    assert.ok(log, "MANUAL device should still be driven by an enabled ALWAYS_ON rule");
    assert.equal(log.action, "ON");

    const after = await prismaClient.device.findUnique({ where: { id: fanId } });
    assert.equal(after.isActive, true, "ALWAYS_ON rule should turn the device ON");
  });

  test("scheduler - device-level ALWAYS_OFF beats rule-level ALWAYS_ON", async () => {
    // A device with automationMode ALWAYS_OFF should never be turned ON by an
    // ALWAYS_ON rule (device-level wins over rule-level).
    await prismaClient.automationRule.deleteMany({ where: { deviceId: fanId } });
    await prismaClient.automationRule.create({
      data: {
        action: "ON",
        condition: "ALWAYS_ON",
        deviceId: fanId,
        growPhaseId,
        period: null,
        watchedSensorType: null,
      },
    });
    await prismaClient.device.update({
      data: { automationMode: "ALWAYS_OFF", isActive: false },
      where: { id: fanId },
    });
    await prismaClient.deviceStateLog.deleteMany({ where: { deviceId: fanId } });

    await lightScheduler.tick(new Date("2026-07-01T12:00:00"));

    const onLog = await prismaClient.deviceStateLog.findFirst({
      where: { action: "ON", deviceId: fanId, source: "AUTO" },
    });
    assert.equal(
      onLog,
      null,
      "device-level ALWAYS_OFF must override rule-level ALWAYS_ON",
    );

    // The scheduler does NOT actively drive non-LIGHT devices based on
    // AutomationMode alone — the device is left in its initial state
    // (isActive: false, set up above) and only moved by a rule.
    const offLog = await prismaClient.deviceStateLog.findFirst({
      where: { action: "OFF", deviceId: fanId, source: "AUTO" },
    });
    assert.equal(
      offLog,
      null,
      "scheduler does not issue commands for a non-LIGHT device that has no matching rule",
    );
    const after = await prismaClient.device.findUnique({ where: { id: fanId } });
    assert.equal(after.isActive, false, "device should remain in its initial OFF state");
  });
});
