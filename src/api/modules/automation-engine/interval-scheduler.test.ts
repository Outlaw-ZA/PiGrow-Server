import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestApp, teardownTestApp } from "../test-helper.js";
import { intervalScheduler } from "../../../automation/interval-scheduler.js";

describe("Interval scheduler (duty-cycle schedules)", () => {
  let prismaClient: any;
  let testApp: any;
  let controllerId: string;
  let growCycleId: string;
  let growPhaseId: string;
  let lightId: string;
  let fanId: string;

  const mac = `88:99:aa:bb:cc:${Date.now().toString(16).slice(-2)}`;

  before(async () => {
    const { server, prisma } = await createTestApp();
    prismaClient = prisma;
    testApp = server;

    const controller = await prisma.controller.create({
      data: {
        macAddress: mac,
        name: "Interval Scheduler Test Pi",
        ipAddress: "192.168.1.140",
        growCycles: {
          create: {
            name: "Interval Test Cycle",
            isActive: true,
            phases: {
              create: {
                name: "Veg",
                order: 1,
                durationDays: 30,
                isActive: true,
                // DAY window 06:00..24:00 (default 18/6).
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
    lightId = light.id;
    fanId = fan.id;
  });

  after(async () => {
    await prismaClient.automationRule.deleteMany({
      where: { device: { controllerId } },
    });
    await prismaClient.deviceStateLog.deleteMany({
      where: { device: { controllerId } },
    });
    await prismaClient.deviceThresholdHold.deleteMany({
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

  // Reset per-test state so each test starts with a clean slate.
  beforeEach(async () => {
    await prismaClient.automationRule.deleteMany({
      where: { device: { controllerId } },
    });
    await prismaClient.deviceStateLog.deleteMany({
      where: { device: { controllerId } },
    });
    await prismaClient.deviceThresholdHold.deleteMany({
      where: { device: { controllerId } },
    });
    // Restore default device automationMode in case a previous test changed it.
    await prismaClient.device.updateMany({
      where: { controllerId, type: "EXHAUST_FAN" },
      data: { automationMode: "THRESHOLD" },
    });
  });

  test("interval scheduler - drives a fan ON at the start of the duty cycle (position 0)", async () => {
    const rule = await prismaClient.automationRule.create({
      data: {
        growPhaseId,
        deviceId: fanId,
        watchedSensorType: null,
        period: null,
        condition: "INTERVAL",
        action: "ON",
        intervalOnSeconds: 1,
        intervalCycleSeconds: 4,
        cooldownSeconds: 0,
      },
    });
    const epoch = rule.createdAt;

    // Position 0 (elapsed=0) < onSeconds(1) -> ON.
    await intervalScheduler.tick(epoch);

    const log = await prismaClient.deviceStateLog.findFirst({
      where: { deviceId: fanId },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(log, "DeviceStateLog should be written for the ON pulse");
    assert.equal(log.action, "ON");
    assert.equal(log.source, "AUTO");
    assert.match(log.reason ?? "", /INTERVAL rule/);
  });

  test("interval scheduler - drives a fan OFF during the OFF window", async () => {
    const rule = await prismaClient.automationRule.create({
      data: {
        growPhaseId,
        deviceId: fanId,
        watchedSensorType: null,
        period: null,
        condition: "INTERVAL",
        action: "ON",
        intervalOnSeconds: 1,
        intervalCycleSeconds: 4,
        cooldownSeconds: 0,
      },
    });
    const epoch = rule.createdAt;

    // ON at position 0.
    await intervalScheduler.tick(epoch);
    // 1500ms in -> position 1500ms mod 4000ms = 1500, in OFF window -> OFF.
    await intervalScheduler.tick(new Date(epoch.getTime() + 1500));

    const log = await prismaClient.deviceStateLog.findFirst({
      where: { deviceId: fanId },
      orderBy: { createdAt: "desc" },
    });
    assert.equal(log.action, "OFF");
  });

  test("interval scheduler - wraps the cycle (ON at createdAt + cycle)", async () => {
    const rule = await prismaClient.automationRule.create({
      data: {
        growPhaseId,
        deviceId: fanId,
        watchedSensorType: null,
        period: null,
        condition: "INTERVAL",
        action: "ON",
        intervalOnSeconds: 1,
        intervalCycleSeconds: 4,
        cooldownSeconds: 0,
      },
    });
    const epoch = rule.createdAt;

    // ON, then OFF.
    await intervalScheduler.tick(epoch);
    await intervalScheduler.tick(new Date(epoch.getTime() + 1500));
    // At +4000ms the cycle wraps: position 0 -> ON.
    await intervalScheduler.tick(new Date(epoch.getTime() + 4000));

    const log = await prismaClient.deviceStateLog.findFirst({
      where: { deviceId: fanId },
      orderBy: { createdAt: "desc" },
    });
    assert.equal(log.action, "ON");
  });

  test("interval scheduler - hysteresis: two ticks in the same window produce one log row", async () => {
    const rule = await prismaClient.automationRule.create({
      data: {
        growPhaseId,
        deviceId: fanId,
        watchedSensorType: null,
        period: null,
        condition: "INTERVAL",
        action: "ON",
        intervalOnSeconds: 1,
        intervalCycleSeconds: 4,
        cooldownSeconds: 0,
      },
    });
    const epoch = rule.createdAt;

    await intervalScheduler.tick(epoch);
    // Second tick in the same ON window -> no-op (device already ON).
    await intervalScheduler.tick(new Date(epoch.getTime() + 10));

    const count = await prismaClient.deviceStateLog.count({
      where: { deviceId: fanId },
    });
    assert.equal(count, 1, "Hysteresis: only one log row for the ON transition");
  });

  test("interval scheduler - skips a device with automationMode MANUAL", async () => {
    await prismaClient.device.update({
      where: { id: fanId },
      data: { automationMode: "MANUAL" },
    });
    await prismaClient.automationRule.create({
      data: {
        growPhaseId,
        deviceId: fanId,
        watchedSensorType: null,
        period: null,
        condition: "INTERVAL",
        action: "ON",
        intervalOnSeconds: 1,
        intervalCycleSeconds: 4,
        cooldownSeconds: 0,
      },
    });

    await intervalScheduler.tick(new Date());

    const count = await prismaClient.deviceStateLog.count({
      where: { deviceId: fanId },
    });
    assert.equal(count, 0, "MANUAL device should not be auto-driven by the interval scheduler");
  });

  test("interval scheduler - suspends a device with an active DeviceThresholdHold (threshold overrides interval)", async () => {
    const rule = await prismaClient.automationRule.create({
      data: {
        growPhaseId,
        deviceId: fanId,
        watchedSensorType: null,
        period: null,
        condition: "INTERVAL",
        action: "ON",
        intervalOnSeconds: 1,
        intervalCycleSeconds: 4,
        cooldownSeconds: 0,
      },
    });
    const epoch = rule.createdAt;

    // ON pulse.
    await intervalScheduler.tick(epoch);
    // Threshold hold is asserted (e.g. by a temp spike).
    await prismaClient.deviceThresholdHold.create({
      data: {
        deviceId: fanId,
        heldUntil: new Date(Date.now() + 60_000),
        ruleId: null,
      },
    });
    // Now in the OFF window — interval would normally flip to OFF, but the
    // hold suspends the device entirely.
    await intervalScheduler.tick(new Date(epoch.getTime() + 1500));

    const log = await prismaClient.deviceStateLog.findFirst({
      where: { deviceId: fanId },
      orderBy: { createdAt: "desc" },
    });
    assert.equal(log.action, "ON", "Hold should prevent the interval from issuing OFF");
  });

  test("interval scheduler - deletes expired DeviceThresholdHold rows on tick", async () => {
    // Stale hold (heldUntil in the past).
    await prismaClient.deviceThresholdHold.create({
      data: {
        deviceId: fanId,
        heldUntil: new Date(Date.now() - 1000),
        ruleId: null,
      },
    });

    await intervalScheduler.tick(new Date());

    const hold = await prismaClient.deviceThresholdHold.findUnique({
      where: { deviceId: fanId },
    });
    assert.equal(hold, null, "Expired hold should be deleted by the scheduler");
  });

  test("interval scheduler - period: DAY rule does not fire at NIGHT", async () => {
    await prismaClient.automationRule.create({
      data: {
        growPhaseId,
        deviceId: fanId,
        watchedSensorType: null,
        period: "DAY",
        condition: "INTERVAL",
        action: "ON",
        intervalOnSeconds: 1,
        intervalCycleSeconds: 4,
        cooldownSeconds: 0,
      },
    });

    // 02:00 is NIGHT for the 06:00..24:00 DAY window.
    await intervalScheduler.tick(new Date("2026-07-01T02:00:00"));

    const count = await prismaClient.deviceStateLog.count({
      where: { deviceId: fanId },
    });
    assert.equal(count, 0, "DAY-scoped rule should not fire at NIGHT");
  });

  test("interval scheduler - period: null rule fires at NIGHT", async () => {
    // Anchor createdAt to a known NIGHT time so the duty-cycle position
    // is deterministic (position 0 -> ON) and the resolved period is NIGHT.
    const nightEpoch = new Date("2026-07-01T02:00:00");
    await prismaClient.automationRule.create({
      data: {
        growPhaseId,
        deviceId: fanId,
        watchedSensorType: null,
        period: null,
        condition: "INTERVAL",
        action: "ON",
        intervalOnSeconds: 1,
        intervalCycleSeconds: 4,
        cooldownSeconds: 0,
        createdAt: nightEpoch,
      },
    });

    await intervalScheduler.tick(nightEpoch);

    const log = await prismaClient.deviceStateLog.findFirst({
      where: { deviceId: fanId },
    });
    assert.ok(log, "period:null rule should fire at NIGHT");
    assert.equal(log.action, "ON");
  });

  test("interval scheduler - no-op when there is no active grow cycle", async () => {
    // Deactivate the grow cycle.
    await prismaClient.growCycle.update({
      where: { id: growCycleId },
      data: { isActive: false },
    });
    await prismaClient.automationRule.create({
      data: {
        growPhaseId,
        deviceId: fanId,
        watchedSensorType: null,
        period: null,
        condition: "INTERVAL",
        action: "ON",
        intervalOnSeconds: 1,
        intervalCycleSeconds: 4,
        cooldownSeconds: 0,
      },
    });

    await intervalScheduler.tick(new Date());

    const count = await prismaClient.deviceStateLog.count({
      where: { deviceId: fanId },
    });
    assert.equal(count, 0, "No active cycle -> no commands");

    // Restore for subsequent tests.
    await prismaClient.growCycle.update({
      where: { id: growCycleId },
      data: { isActive: true },
    });
  });

  test("interval scheduler - defensively skips LIGHT devices", async () => {
    // Bypass the API: create an INTERVAL rule on the light directly in the DB.
    await prismaClient.automationRule.create({
      data: {
        growPhaseId,
        deviceId: lightId,
        watchedSensorType: null,
        period: null,
        condition: "INTERVAL",
        action: "ON",
        intervalOnSeconds: 1,
        intervalCycleSeconds: 4,
        cooldownSeconds: 0,
      },
    });

    await intervalScheduler.tick(new Date());

    const count = await prismaClient.deviceStateLog.count({
      where: { deviceId: lightId },
    });
    assert.equal(count, 0, "LIGHT devices should be skipped by the interval scheduler");
  });
});
