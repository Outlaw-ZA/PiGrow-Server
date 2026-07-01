import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestApp, teardownTestApp } from "../test-helper.js";

describe("Automation Rules API Feature Module", () => {
  let app: any;
  let prismaClient: any;
  let controllerId: string;
  let growCycleId: string;
  let growPhaseId: string;
  let lightId: string;
  let fanId: string;
  let heaterId: string;

  const mac = `66:77:88:99:aa:${Date.now().toString(16).slice(-2)}`;

  before(async () => {
    const { server, prisma } = await createTestApp();
    app = server;
    prismaClient = prisma;

    const controller = await prismaClient.controller.create({
      data: {
        macAddress: mac,
        name: "Automation Test Pi",
        ipAddress: "192.168.1.120",
        growCycles: {
          create: {
            name: "Auto Cycle",
            isActive: true,
            phases: {
              create: {
                name: "Veg",
                order: 1,
                durationDays: 30,
                isActive: true,
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

    const light = await prismaClient.device.create({
      data: {
        controllerId,
        name: "Light",
        type: "LIGHT",
        pinNumber: 4,
        mqttTopic: "tent1/light",
        automationMode: "SCHEDULED",
      },
    });
    const fan = await prismaClient.device.create({
      data: {
        controllerId,
        name: "Exhaust Fan",
        type: "EXHAUST_FAN",
        pinNumber: 17,
        mqttTopic: "tent1/fan",
        automationMode: "THRESHOLD",
      },
    });
    const heater = await prismaClient.device.create({
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
    await prismaClient.device.deleteMany({ where: { controllerId } });
    await prismaClient.growCycle.deleteMany({
      where: { controller: { macAddress: mac } },
    });
    await prismaClient.controller.deleteMany({ where: { macAddress: mac } });
    await teardownTestApp(app);
  });

  test("POST /api/automation-rules - Should reject a rule targeting a LIGHT device", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/automation-rules",
      payload: {
        growPhaseId,
        deviceId: lightId,
        watchedSensorType: "TEMPERATURE",
        period: "DAY",
        condition: "ABOVE_MAX",
        action: "ON",
      },
    });

    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 400);
    assert.match(body.error, /LIGHT devices are not eligible/);
  });

  test("POST /api/automation-rules - Should reject SCHEDULE_ON condition on any device", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/automation-rules",
      payload: {
        growPhaseId,
        deviceId: fanId,
        watchedSensorType: "TEMPERATURE",
        period: "DAY",
        condition: "SCHEDULE_ON",
        action: "ON",
      },
    });

    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 400);
    assert.match(body.error, /SCHEDULE_ON\/SCHEDULE_OFF conditions are no longer supported/);
  });

  test("POST /api/automation-rules - Should reject SCHEDULE_OFF condition on any device", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/automation-rules",
      payload: {
        growPhaseId,
        deviceId: fanId,
        watchedSensorType: "TEMPERATURE",
        period: "NIGHT",
        condition: "SCHEDULE_OFF",
        action: "OFF",
      },
    });

    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 400);
    assert.match(body.error, /SCHEDULE_ON\/SCHEDULE_OFF conditions are no longer supported/);
  });

  test("POST /api/automation-rules - Should reject when both growCycleId and growPhaseId are set", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/automation-rules",
      payload: {
        growPhaseId,
        growCycleId,
        deviceId: fanId,
        watchedSensorType: "TEMPERATURE",
        condition: "ABOVE_MAX",
        action: "ON",
      },
    });

    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 400);
    assert.match(body.error, /Exactly one/);
  });

  test("POST /api/automation-rules - Should reject when neither scope is set", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/automation-rules",
      payload: {
        deviceId: fanId,
        watchedSensorType: "TEMPERATURE",
        condition: "ABOVE_MAX",
        action: "ON",
      },
    });

    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 400);
    assert.match(body.error, /Exactly one/);
  });

  test("POST /api/automation-rules - Should create a phase-scoped threshold rule (fan ABOVE_MAX on temp)", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/automation-rules",
      payload: {
        growPhaseId,
        deviceId: fanId,
        watchedSensorType: "TEMPERATURE",
        period: "DAY",
        condition: "ABOVE_MAX",
        action: "ON",
      },
    });

    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 201);
    assert.equal(body.condition, "ABOVE_MAX");
  });

  test("POST /api/automation-rules - Should create a phase-scoped threshold rule (heater BELOW_MIN on temp)", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/automation-rules",
      payload: {
        growPhaseId,
        deviceId: heaterId,
        watchedSensorType: "TEMPERATURE",
        period: "NIGHT",
        condition: "BELOW_MIN",
        action: "ON",
      },
    });

    assert.equal(response.statusCode, 201);
  });

  test("GET /api/automation-rules/grow-phase/:id - Should list rules for a phase", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/automation-rules/grow-phase/${growPhaseId}`,
    });
    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 200);
    assert.equal(body.length, 2);
  });

  test("GET /api/automation-rules/grow-cycle/:id - Should list cycle-scoped rules (none in this suite)", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/automation-rules/grow-cycle/${growCycleId}`,
    });
    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 200);
    assert.equal(body.length, 0);
  });

  test("GET /api/automation-rules/device/:id - Should list rules for a device", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/automation-rules/device/${fanId}`,
    });
    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 200);
    assert.equal(body.length, 1);
    assert.equal(body[0].deviceId, fanId);
  });

  test("PATCH /api/automation-rules/:id/toggle - Should flip the enabled flag", async () => {
    const list = await prismaClient.automationRule.findFirst({
      where: { deviceId: fanId },
    });

    const response = await app.inject({
      method: "PATCH",
      url: `/api/automation-rules/${list.id}/toggle`,
    });
    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 200);
    assert.equal(body.id, list.id);
    assert.equal(body.enabled, false);

    // Toggle back
    const response2 = await app.inject({
      method: "PATCH",
      url: `/api/automation-rules/${list.id}/toggle`,
    });
    const body2 = JSON.parse(response2.body);
    assert.equal(body2.enabled, true);
  });

  test("PUT /api/automation-rules/:id - Should update a rule's cooldown", async () => {
    const list = await prismaClient.automationRule.findFirst({
      where: { deviceId: heaterId },
    });

    const response = await app.inject({
      method: "PUT",
      url: `/api/automation-rules/${list.id}`,
      payload: { cooldownSeconds: 600 },
    });
    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 200);
    assert.equal(body.cooldownSeconds, 600);
  });

  test("PUT /api/automation-rules/:id - Should reject updating deviceId to a LIGHT device", async () => {
    const list = await prismaClient.automationRule.findFirst({
      where: { deviceId: heaterId },
    });

    const response = await app.inject({
      method: "PUT",
      url: `/api/automation-rules/${list.id}`,
      payload: { deviceId: lightId },
    });
    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 400);
    assert.match(body.error, /LIGHT devices are not eligible/);

    // Confirm the rule was not mutated.
    const after = await prismaClient.automationRule.findUnique({
      where: { id: list.id },
    });
    assert.equal(after.deviceId, heaterId);
  });

  test("PUT /api/automation-rules/:id - Should reject updating condition to SCHEDULE_OFF", async () => {
    const list = await prismaClient.automationRule.findFirst({
      where: { deviceId: fanId },
    });

    const response = await app.inject({
      method: "PUT",
      url: `/api/automation-rules/${list.id}`,
      payload: { condition: "SCHEDULE_OFF" },
    });
    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 400);
    assert.match(body.error, /SCHEDULE_ON\/SCHEDULE_OFF conditions are no longer supported/);

    // Confirm the rule's condition was not mutated.
    const after = await prismaClient.automationRule.findUnique({
      where: { id: list.id },
    });
    assert.equal(after.condition, "ABOVE_MAX");
  });

  // ---------- ALWAYS_ON / ALWAYS_OFF rule conditions ----------

  test("POST /api/automation-rules - Should create an ALWAYS_ON rule (no sensor type, action ON)", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/automation-rules",
      payload: {
        growPhaseId,
        deviceId: heaterId,
        watchedSensorType: null,
        period: null,
        condition: "ALWAYS_ON",
        action: "ON",
      },
    });

    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 201);
    assert.equal(body.condition, "ALWAYS_ON");
    assert.equal(body.action, "ON");
    assert.equal(body.watchedSensorType, null);
    assert.equal(body.period, null);
  });

  test("POST /api/automation-rules - Should create an ALWAYS_OFF rule scoped to NIGHT", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/automation-rules",
      payload: {
        growPhaseId,
        deviceId: fanId,
        watchedSensorType: null,
        period: "NIGHT",
        condition: "ALWAYS_OFF",
        action: "OFF",
      },
    });

    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 201);
    assert.equal(body.condition, "ALWAYS_OFF");
    assert.equal(body.action, "OFF");
    assert.equal(body.period, "NIGHT");
  });

  test("POST /api/automation-rules - Should reject ALWAYS_ON with a mismatched action", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/automation-rules",
      payload: {
        growPhaseId,
        deviceId: fanId,
        watchedSensorType: null,
        condition: "ALWAYS_ON",
        action: "OFF",
      },
    });

    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 400);
    assert.match(body.error, /action must be ON for condition ALWAYS_ON/);
  });

  test("POST /api/automation-rules - Should reject ALWAYS_OFF with a mismatched action", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/automation-rules",
      payload: {
        growPhaseId,
        deviceId: fanId,
        watchedSensorType: null,
        condition: "ALWAYS_OFF",
        action: "ON",
      },
    });

    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 400);
    assert.match(body.error, /action must be OFF for condition ALWAYS_OFF/);
  });

  test("POST /api/automation-rules - Should reject ALWAYS_ON with a watchedSensorType set", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/automation-rules",
      payload: {
        growPhaseId,
        deviceId: fanId,
        watchedSensorType: "TEMPERATURE",
        condition: "ALWAYS_ON",
        action: "ON",
      },
    });

    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 400);
    assert.match(body.error, /watchedSensorType must be null for ALWAYS_ON \/ ALWAYS_OFF rules/);
  });

  test("POST /api/automation-rules - Should reject ABOVE_MAX with a null watchedSensorType", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/automation-rules",
      payload: {
        growPhaseId,
        deviceId: fanId,
        watchedSensorType: null,
        condition: "ABOVE_MAX",
        action: "ON",
      },
    });

    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 400);
    assert.match(body.error, /watchedSensorType is required for ABOVE_MAX \/ BELOW_MIN rules/);
  });

  test("POST /api/automation-rules - Should reject an ALWAYS_ON rule targeting a LIGHT device", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/automation-rules",
      payload: {
        growPhaseId,
        deviceId: lightId,
        watchedSensorType: null,
        condition: "ALWAYS_ON",
        action: "ON",
      },
    });

    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 400);
    assert.match(body.error, /LIGHT devices are not eligible/);
  });

  test("PUT /api/automation-rules/:id - Should reject changing a threshold rule to ALWAYS_OFF without clearing watchedSensorType", async () => {
    const list = await prismaClient.automationRule.findFirst({
      where: { deviceId: heaterId, condition: "BELOW_MIN" },
    });
    assert.ok(list, "heater BELOW_MIN rule should exist from earlier test");

    const response = await app.inject({
      method: "PUT",
      url: `/api/automation-rules/${list.id}`,
      payload: { condition: "ALWAYS_OFF", action: "OFF" },
    });
    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 400);
    assert.match(body.error, /watchedSensorType must be null for ALWAYS_ON \/ ALWAYS_OFF rules/);

    // Confirm the rule was not mutated.
    const after = await prismaClient.automationRule.findUnique({
      where: { id: list.id },
    });
    assert.equal(after.condition, "BELOW_MIN");
  });

  test("PUT /api/automation-rules/:id - Should allow converting a threshold rule to ALWAYS_ON (clearing watchedSensorType)", async () => {
    const list = await prismaClient.automationRule.findFirst({
      where: { deviceId: heaterId, condition: "BELOW_MIN" },
    });
    assert.ok(list, "heater BELOW_MIN rule should still exist from earlier test");

    const response = await app.inject({
      method: "PUT",
      url: `/api/automation-rules/${list.id}`,
      payload: {
        condition: "ALWAYS_ON",
        action: "ON",
        watchedSensorType: null,
      },
    });
    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 200);
    assert.equal(body.condition, "ALWAYS_ON");
    assert.equal(body.action, "ON");
    assert.equal(body.watchedSensorType, null);
  });

  test("DELETE /api/automation-rules/:id - Should remove a rule", async () => {
    const list = await prismaClient.automationRule.findFirst({
      where: { deviceId: heaterId },
    });
    assert.ok(list);

    const response = await app.inject({
      method: "DELETE",
      url: `/api/automation-rules/${list.id}`,
    });
    assert.equal(response.statusCode, 204);
  });
});
