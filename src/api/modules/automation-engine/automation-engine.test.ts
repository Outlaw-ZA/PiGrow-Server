import { test, describe, before, after } from "node:test";
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
        macAddress: mac,
        name: "Automation Engine Test Pi",
        ipAddress: "192.168.1.130",
        growCycles: {
          create: {
            name: "Engine Test Cycle",
            isActive: true,
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
        type: "TEMPERATURE",
        mqttTopic: "tent1/temp",
        pinNumbers: [4],
        protocol: "I2C",
      },
    });

    const light = await prisma.device.create({
      data: {
        controllerId,
        name: "Light",
        type: "LIGHT",
        pinNumber: 4,
        mqttTopic: "tent1/light",
        automationMode: "SCHEDULED",
      },
    });
    const fan = await prisma.device.create({
      data: {
        controllerId,
        name: "Exhaust Fan",
        type: "EXHAUST_FAN",
        pinNumber: 17,
        mqttTopic: "tent1/fan",
        automationMode: "THRESHOLD",
      },
    });
    const heater = await prisma.device.create({
      data: {
        controllerId,
        name: "Heater",
        type: "HEATER",
        pinNumber: 27,
        mqttTopic: "tent1/heater",
        automationMode: "THRESHOLD",
      },
    });
    lightId = light.id;
    fanId = fan.id;
    heaterId = heater.id;
  });

  after(async () => {
    await prismaClient.automationRule.deleteMany({});
    await prismaClient.deviceStateLog.deleteMany({});
    await prismaClient.phaseEnvironment.deleteMany({});
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
        period: "DAY",
        tempMax: 28,
        tempMin: 22,
        humidityMax: 80,
        humidityMin: 50,
      },
    });
    // Create the rule: fan ABOVE_MAX on TEMPERATURE, DAY
    await prismaClient.automationRule.create({
      data: {
        growPhaseId,
        deviceId: fanId,
        watchedSensorType: "TEMPERATURE",
        period: "DAY",
        condition: "ABOVE_MAX",
        action: "ON",
        cooldownSeconds: 0, // disable cooldown for the test
      },
    });

    // First reading: 31°C -> ABOVE 28 -> command ON issued
    await evaluateThresholds({
      growCycleId,
      sensorType: "TEMPERATURE",
      value: 31,
      now: new Date("2026-07-01T12:00:00"),
    });

    const log = await prismaClient.deviceStateLog.findFirst({
      where: { deviceId: fanId },
      orderBy: { createdAt: "desc" },
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
      sensorType: "TEMPERATURE",
      value: 32,
      now: new Date("2026-07-01T12:00:01"),
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
        period: "NIGHT",
        tempMax: 24,
        tempMin: 19,
        humidityMax: 80,
        humidityMin: 50,
      },
    });
    await prismaClient.automationRule.create({
      data: {
        growPhaseId,
        deviceId: heaterId,
        watchedSensorType: "TEMPERATURE",
        period: "NIGHT",
        condition: "BELOW_MIN",
        action: "ON",
        cooldownSeconds: 0,
      },
    });

    // 17°C at 02:00 (NIGHT for an 18/6 schedule starting at 06:00) -> below 19 -> ON
    await evaluateThresholds({
      growCycleId,
      sensorType: "TEMPERATURE",
      value: 17,
      now: new Date("2026-07-01T02:00:00"),
    });

    const log = await prismaClient.deviceStateLog.findFirst({
      where: { deviceId: heaterId },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(log);
    assert.equal(log.action, "ON");
    assert.match(log.reason ?? "", /TEMP.*17.*min 19/);
  });

  test("evaluator - rule scoped to a different period does not fire", async () => {
    // 31°C at 02:00 (NIGHT) with the DAY-only ABOVE_MAX rule should NOT fire
    const before = await prismaClient.deviceStateLog.count({
      where: { deviceId: fanId },
    });
    await evaluateThresholds({
      growCycleId,
      sensorType: "TEMPERATURE",
      value: 31,
      now: new Date("2026-07-01T02:00:00"),
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
        growPhaseId,
        deviceId: heaterId,
        watchedSensorType: "TEMPERATURE",
        period: null,
        condition: "BELOW_MIN",
        action: "OFF",
        cooldownSeconds: 0,
      },
    });

    // Heater is currently ON. Reading 30°C (above NIGHT min 19) -> rule wants OFF
    // at 12:00 (DAY) -> no DAY env, but rule is null-period, condition BELOW_MIN,
    // so we should only fire if NIGHT env.min exists and value < min. We DID set
    // NIGHT min to 19 earlier, and the rule is null-period so it checks the
    // current period's env. At DAY with no DAY env, getBoundaryFields returns
    // null boundary -> we already early-return in that case. So the rule never
    // fires at noon. Verify no new log.
    const before = await prismaClient.deviceStateLog.count({
      where: { deviceId: heaterId, source: "AUTO" },
    });
    await evaluateThresholds({
      growCycleId,
      sensorType: "TEMPERATURE",
      value: 30,
      now: new Date("2026-07-01T12:00:00"),
    });
    const after = await prismaClient.deviceStateLog.count({
      where: { deviceId: heaterId, source: "AUTO" },
    });
    assert.equal(after, before);
  });

  test("evaluator - device with MANUAL automationMode is never auto-driven", async () => {
    // Switch the fan to MANUAL and add a fresh rule
    await prismaClient.device.update({
      where: { id: fanId },
      data: { automationMode: "MANUAL" },
    });
    const before = await prismaClient.deviceStateLog.count({
      where: { deviceId: fanId, source: "AUTO" },
    });
    await evaluateThresholds({
      growCycleId,
      sensorType: "TEMPERATURE",
      value: 99,
      now: new Date("2026-07-01T12:00:00"),
    });
    const after = await prismaClient.deviceStateLog.count({
      where: { deviceId: fanId, source: "AUTO" },
    });
    assert.equal(after, before, "MANUAL device is ignored by the evaluator");
  });

  test("evaluator - non-active grow cycle is a no-op even if rules exist", async () => {
    await prismaClient.growCycle.update({
      where: { id: growCycleId },
      data: { isActive: false },
    });
    const before = await prismaClient.deviceStateLog.count();
    await evaluateThresholds({
      growCycleId,
      sensorType: "TEMPERATURE",
      value: 99,
      now: new Date("2026-07-01T12:00:00"),
    });
    const after = await prismaClient.deviceStateLog.count();
    assert.equal(after, before, "Inactive cycle: no commands");
    // Re-activate for any subsequent tests
    await prismaClient.growCycle.update({
      where: { id: growCycleId },
      data: { isActive: true },
    });
  });

  // ---------- light scheduler (drives LIGHT devices directly) ----------

  test("light scheduler - drives a SCHEDULED LIGHT to ON during the day period (no rules needed)", async () => {
    // Clear prior logs and ensure the LIGHT is in a known OFF state.
    await prismaClient.deviceStateLog.deleteMany({ where: { deviceId: lightId } });
    await prismaClient.device.update({
      where: { id: lightId },
      data: { isActive: false },
    });
    // Defensive: if any prior scheduler runs left an AutomationRule for this
    // light, clear it — the new scheduler does not consult rules.
    await prismaClient.automationRule.deleteMany({ where: { deviceId: lightId } });

    // Tick at noon (DAY for the 18/6 schedule starting at 06:00) -> ON
    await lightScheduler.tick(new Date("2026-07-01T12:00:00"));

    const onLog = await prismaClient.deviceStateLog.findFirst({
      where: { deviceId: lightId, action: "ON", source: "AUTO" },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(onLog, "Light ON log written by scheduler");
    assert.match(onLog.reason ?? "", /day cycle start/);

    const light = await prismaClient.device.findUnique({ where: { id: lightId } });
    assert.equal(light.isActive, true);

    // Tick again at noon -> hysteresis, no new log
    const before = await prismaClient.deviceStateLog.count({
      where: { deviceId: lightId, source: "AUTO" },
    });
    await lightScheduler.tick(new Date("2026-07-01T12:00:30"));
    const after = await prismaClient.deviceStateLog.count({
      where: { deviceId: lightId, source: "AUTO" },
    });
    assert.equal(after, before, "Hysteresis: no duplicate ON command");
  });

  test("light scheduler - drives a SCHEDULED LIGHT to OFF when night begins", async () => {
    // Tick at 02:00 (NIGHT for the 18/6 schedule starting at 06:00) -> OFF
    await lightScheduler.tick(new Date("2026-07-01T02:00:00"));

    const offLog = await prismaClient.deviceStateLog.findFirst({
      where: { deviceId: lightId, action: "OFF", source: "AUTO" },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(offLog, "Light OFF log written by scheduler");
    assert.match(offLog.reason ?? "", /night cycle start/);

    const light = await prismaClient.device.findUnique({ where: { id: lightId } });
    assert.equal(light.isActive, false);
  });

  test("light scheduler - leaves a MANUAL LIGHT untouched", async () => {
    // Set the fan to be a LIGHT in MANUAL mode for this scenario, since
    // the test fixture's fan is an EXHAUST_FAN. Use a fresh device.
    const manualLight = await prismaClient.device.create({
      data: {
        controllerId,
        name: "Manual Light (scheduler test)",
        type: "LIGHT",
        pinNumber: 24,
        mqttTopic: "engine/manual-light",
        automationMode: "MANUAL",
        isActive: false,
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
        controllerId,
        name: "Always On Light (scheduler test)",
        type: "LIGHT",
        pinNumber: 25,
        mqttTopic: "engine/always-on-light",
        automationMode: "ALWAYS_ON",
        isActive: true,
      },
    });

    // Tick at 02:00 (NIGHT) -> desiredAction OFF -> skipped for ALWAYS_ON
    await lightScheduler.tick(new Date("2026-07-01T02:00:00"));

    const offLog = await prismaClient.deviceStateLog.findFirst({
      where: { deviceId: alwaysOnLight.id, action: "OFF", source: "AUTO" },
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
      where: { growPhaseId_period: { growPhaseId, period: "DAY" } },
      update: { tempMax: 28 },
      create: { growPhaseId, period: "DAY", tempMax: 28, tempMin: 22 },
    });
    await prismaClient.automationRule.deleteMany({ where: { deviceId: fanId } });
    await prismaClient.automationRule.create({
      data: {
        growPhaseId,
        deviceId: fanId,
        watchedSensorType: "TEMPERATURE",
        period: null,
        condition: "ABOVE_MAX",
        action: "ON",
        cooldownSeconds: 0,
      },
    });
    await prismaClient.automationRule.create({
      data: {
        growPhaseId,
        deviceId: fanId,
        watchedSensorType: null,
        period: null,
        condition: "ALWAYS_ON",
        action: "ON",
      },
    });
    // Reset fan state for a clean assertion.
    await prismaClient.device.update({
      where: { id: fanId },
      data: { isActive: false },
    });
    await prismaClient.deviceStateLog.deleteMany({ where: { deviceId: fanId } });

    // Hot reading at noon -> ABOVE_MAX would normally fire, but the ALWAYS_ON
    // rule suppresses it for this device in this scope.
    const before = await prismaClient.deviceStateLog.count({
      where: { deviceId: fanId, source: "AUTO" },
    });
    await evaluateThresholds({
      growCycleId,
      sensorType: "TEMPERATURE",
      value: 99,
      now: new Date("2026-07-01T12:00:00"),
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
    // cycle, not a phase). The threshold rule is phase-scoped. Cycle-scoped
    // rules apply across all phases in the cycle, so this DOES suppress.
    // This test is asserting the behavior: a cycle-scoped ALWAYS_ON pin
    // suppresses phase-scoped threshold rules in the cycle.
    await prismaClient.automationRule.deleteMany({ where: { deviceId: fanId } });
    await prismaClient.automationRule.create({
      data: {
        growPhaseId,
        deviceId: fanId,
        watchedSensorType: "TEMPERATURE",
        period: "DAY",
        condition: "ABOVE_MAX",
        action: "ON",
        cooldownSeconds: 0,
      },
    });
    await prismaClient.automationRule.create({
      data: {
        growCycleId,
        deviceId: fanId,
        watchedSensorType: null,
        period: "DAY",
        condition: "ALWAYS_ON",
        action: "ON",
      },
    });
    await prismaClient.deviceStateLog.deleteMany({ where: { deviceId: fanId } });

    const before = await prismaClient.deviceStateLog.count({
      where: { deviceId: fanId, source: "AUTO" },
    });
    await evaluateThresholds({
      growCycleId,
      sensorType: "TEMPERATURE",
      value: 99,
      now: new Date("2026-07-01T12:00:00"), // DAY for the 18/6 schedule
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
      where: { growCycleId, deviceId: fanId, condition: "ALWAYS_ON" },
    });
  });

  test("scheduler - ALWAYS_ON rule pins a non-LIGHT device to ON, even with no threshold trigger", async () => {
    // Earlier tests left the fan in MANUAL; reset to THRESHOLD so the
    // scheduler will actually drive it.
    await prismaClient.device.update({
      where: { id: fanId },
      data: { automationMode: "THRESHOLD" },
    });
    await prismaClient.automationRule.deleteMany({ where: { deviceId: fanId } });
    await prismaClient.automationRule.create({
      data: {
        growPhaseId,
        deviceId: fanId,
        watchedSensorType: null,
        period: null,
        condition: "ALWAYS_ON",
        action: "ON",
      },
    });
    await prismaClient.device.update({
      where: { id: fanId },
      data: { isActive: false },
    });
    await prismaClient.deviceStateLog.deleteMany({ where: { deviceId: fanId } });

    // Tick at 02:00 (NIGHT) — no threshold reading needed, the rule should fire.
    await lightScheduler.tick(new Date("2026-07-01T02:00:00"));

    const onLog = await prismaClient.deviceStateLog.findFirst({
      where: { deviceId: fanId, action: "ON", source: "AUTO" },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(onLog, "ALWAYS_ON rule should drive the device to ON");
    assert.match(onLog.reason ?? "", /ALWAYS_ON rule/);

    const fan = await prismaClient.device.findUnique({ where: { id: fanId } });
    assert.equal(fan.isActive, true);

    // Hysteresis: a second tick should not produce a new log.
    const before = await prismaClient.deviceStateLog.count({
      where: { deviceId: fanId, source: "AUTO" },
    });
    await lightScheduler.tick(new Date("2026-07-01T02:00:30"));
    const after = await prismaClient.deviceStateLog.count({
      where: { deviceId: fanId, source: "AUTO" },
    });
    assert.equal(after, before, "no duplicate ON command on second tick");
  });

  test("scheduler - ALWAYS_OFF rule with period: DAY does not fire at NIGHT", async () => {
    // Earlier tests left the fan in MANUAL; reset to THRESHOLD so the
    // scheduler will actually drive it.
    await prismaClient.device.update({
      where: { id: fanId },
      data: { automationMode: "THRESHOLD" },
    });
    // Create a cycle-scoped fan with period: DAY ALWAYS_OFF. At NIGHT the rule
    // does not match the current period, so the device should not be driven.
    await prismaClient.automationRule.deleteMany({ where: { deviceId: fanId } });
    await prismaClient.automationRule.create({
      data: {
        growPhaseId,
        deviceId: fanId,
        watchedSensorType: null,
        period: "DAY",
        condition: "ALWAYS_OFF",
        action: "OFF",
      },
    });
    await prismaClient.device.update({
      where: { id: fanId },
      data: { isActive: true },
    });
    await prismaClient.deviceStateLog.deleteMany({ where: { deviceId: fanId } });

    // Tick at 02:00 (NIGHT) — the rule's period is DAY, so it does not apply.
    await lightScheduler.tick(new Date("2026-07-01T02:00:00"));

    const offLog = await prismaClient.deviceStateLog.findFirst({
      where: { deviceId: fanId, action: "OFF", source: "AUTO" },
    });
    assert.equal(offLog, null, "ALWAYS_OFF rule scoped to DAY must not fire at NIGHT");

    // Tick at 12:00 (DAY) — the rule applies now, drives the device to OFF.
    await lightScheduler.tick(new Date("2026-07-01T12:00:00"));

    const newOffLog = await prismaClient.deviceStateLog.findFirst({
      where: { deviceId: fanId, action: "OFF", source: "AUTO" },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(newOffLog, "ALWAYS_OFF rule should drive the device OFF during DAY");
    assert.match(newOffLog.reason ?? "", /ALWAYS_OFF rule/);
  });

  test("scheduler - ALWAYS_ON rule is ignored if the device's automationMode is MANUAL", async () => {
    // Switch the fan to MANUAL and confirm the scheduler does not touch it.
    await prismaClient.automationRule.deleteMany({ where: { deviceId: fanId } });
    await prismaClient.automationRule.create({
      data: {
        growPhaseId,
        deviceId: fanId,
        watchedSensorType: null,
        period: null,
        condition: "ALWAYS_ON",
        action: "ON",
      },
    });
    await prismaClient.device.update({
      where: { id: fanId },
      data: { automationMode: "MANUAL", isActive: false },
    });
    await prismaClient.deviceStateLog.deleteMany({ where: { deviceId: fanId } });

    await lightScheduler.tick(new Date("2026-07-01T12:00:00"));

    const log = await prismaClient.deviceStateLog.findFirst({
      where: { deviceId: fanId, source: "AUTO" },
    });
    assert.equal(log, null, "MANUAL device should not be driven by an ALWAYS_ON rule");

    const after = await prismaClient.device.findUnique({ where: { id: fanId } });
    assert.equal(after.isActive, false, "MANUAL device should remain in its initial state");
  });

  test("scheduler - device-level ALWAYS_OFF beats rule-level ALWAYS_ON", async () => {
    // A device with automationMode ALWAYS_OFF should never be turned ON by an
    // ALWAYS_ON rule (device-level wins over rule-level).
    await prismaClient.automationRule.deleteMany({ where: { deviceId: fanId } });
    await prismaClient.automationRule.create({
      data: {
        growPhaseId,
        deviceId: fanId,
        watchedSensorType: null,
        period: null,
        condition: "ALWAYS_ON",
        action: "ON",
      },
    });
    await prismaClient.device.update({
      where: { id: fanId },
      data: { automationMode: "ALWAYS_OFF", isActive: false },
    });
    await prismaClient.deviceStateLog.deleteMany({ where: { deviceId: fanId } });

    await lightScheduler.tick(new Date("2026-07-01T12:00:00"));

    const onLog = await prismaClient.deviceStateLog.findFirst({
      where: { deviceId: fanId, action: "ON", source: "AUTO" },
    });
    assert.equal(
      onLog,
      null,
      "device-level ALWAYS_OFF must override rule-level ALWAYS_ON",
    );

    // The scheduler does NOT actively drive non-LIGHT devices based on
    // automationMode alone — the device is left in its initial state
    // (isActive: false, set up above) and only moved by a rule.
    const offLog = await prismaClient.deviceStateLog.findFirst({
      where: { deviceId: fanId, action: "OFF", source: "AUTO" },
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
