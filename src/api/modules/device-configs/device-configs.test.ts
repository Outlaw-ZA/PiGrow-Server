import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestApp } from "../test-helper.js";
import { mqttClient } from "../../../mqtt/client.js";

async function cleanUpControllers(prisma: any, macAddresses: string[]) {
  await prisma.growCycle.deleteMany({
    where: { controller: { macAddress: { in: macAddresses } } },
  });
  await prisma.device.deleteMany({
    where: { controller: { macAddress: { in: macAddresses } } },
  });
  await prisma.controller.deleteMany({
    where: { macAddress: { in: macAddresses } },
  });
}

describe("Device Configs API Feature Module", () => {
  let app: any;
  let prismaClient: any;
  let testPhaseId: string;
  let testDeviceId: string;
  let testConfigId: string;

  before(async () => {
    const { server, prisma } = await createTestApp();
    app = server;
    prismaClient = prisma;

    await cleanUpControllers(prismaClient, [
      "dc:cf:cf:cf:cf:cf",
      "dc:dc:dc:dc:dc:dc",
    ]);

    const controller = await prismaClient.controller.create({
      data: {
        macAddress: "dc:cf:cf:cf:cf:cf",
        name: "Config Test Pi",
        ipAddress: "192.168.1.100",
        devices: {
          create: {
            name: "Test Light",
            type: "LIGHT",
            pinNumber: 7,
            mqttTopic: "test/config-light",
          },
        },
        growCycles: {
          create: {
            name: "Config Test Cycle",
            isActive: false,
            phases: {
              create: {
                name: "Config Test Phase",
                order: 1,
                durationDays: 14,
              },
            },
          },
        },
      },
      include: {
        devices: true,
        growCycles: { include: { phases: true } },
      },
    });

    testDeviceId = controller.devices[0].id;
    testPhaseId = controller.growCycles[0].phases[0].id;
  });

  after(async () => {
    await cleanUpControllers(prismaClient, [
      "dc:cf:cf:cf:cf:cf",
      "dc:dc:dc:dc:dc:dc",
    ]);
    await prismaClient.$disconnect();
    await app.close();
    mqttClient.end(true);
  });

  test("POST /device-configs - Should create a schedule config", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/device-configs",
      payload: {
        growPhaseId: testPhaseId,
        deviceId: testDeviceId,
        triggerType: "SCHEDULE",
        configData: { onTime: "06:00", offTime: "00:00" },
      },
    });

    const body = JSON.parse(response.body);

    assert.equal(response.statusCode, 201);
    assert.equal(body.triggerType, "SCHEDULE");
    assert.equal(body.device.id, testDeviceId);
    assert.ok(body.configData);
    testConfigId = body.id;
  });

  test("GET /device-configs/phase/:phaseId - Should list configs for a phase", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/device-configs/phase/${testPhaseId}`,
    });

    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 200);
    assert.ok(Array.isArray(body));
    assert.equal(body.length, 1);
  });

  test("DELETE /device-configs/:id - Should remove the config", async () => {
    const response = await app.inject({
      method: "DELETE",
      url: `/api/device-configs/${testConfigId}`,
    });

    assert.equal(response.statusCode, 204);
  });
});

describe("Device Configs - configData validation", () => {
  let app: any;
  let prismaClient: any;
  let phaseId: string;
  let deviceId: string;
  const createdConfigIds: string[] = [];

  before(async () => {
    const { server, prisma } = await createTestApp();
    app = server;
    prismaClient = prisma;

    await cleanUpControllers(prismaClient, [
      "dc:cf:cf:cf:cf:cf",
      "dc:dc:dc:dc:dc:dc",
    ]);

    const controller = await prismaClient.controller.create({
      data: {
        macAddress: "dc:dc:dc:dc:dc:dc",
        name: "Validation Test Pi",
        ipAddress: "192.168.1.101",
        devices: {
          create: {
            name: "Validation Light",
            type: "LIGHT",
            pinNumber: 8,
            mqttTopic: "test/validation-light",
          },
        },
        growCycles: {
          create: {
            name: "Validation Test Cycle",
            isActive: false,
            phases: {
              create: {
                name: "Validation Test Phase",
                order: 1,
                durationDays: 14,
              },
            },
          },
        },
      },
      include: {
        devices: true,
        growCycles: { include: { phases: true } },
      },
    });

    deviceId = controller.devices[0].id;
    phaseId = controller.growCycles[0].phases[0].id;
  });

  after(async () => {
    await cleanUpControllers(prismaClient, [
      "dc:cf:cf:cf:cf:cf",
      "dc:dc:dc:dc:dc:dc",
    ]);
    await prismaClient.$disconnect();
    await app.close();
    mqttClient.end(true);
  });

  function trackId(id: string) {
    createdConfigIds.push(id);
  }

  test("POST - SCHEDULE with { onTime, offTime } succeeds", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/device-configs",
      payload: {
        growPhaseId: phaseId,
        deviceId,
        triggerType: "SCHEDULE",
        configData: { onTime: "06:00", offTime: "00:00" },
      },
    });
    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 201);
    assert.equal(body.triggerType, "SCHEDULE");
    assert.deepEqual(body.configData, { onTime: "06:00", offTime: "00:00" });
    trackId(body.id);
  });

  test("POST - SCHEDULE with { onTime, durationHours } succeeds", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/device-configs",
      payload: {
        growPhaseId: phaseId,
        deviceId,
        triggerType: "SCHEDULE",
        configData: { onTime: "06:00", durationHours: 18 },
      },
    });
    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 201);
    assert.deepEqual(body.configData, { onTime: "06:00", durationHours: 18 });
    trackId(body.id);
  });

  test("POST - THRESHOLD with { metric, high } succeeds", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/device-configs",
      payload: {
        growPhaseId: phaseId,
        deviceId,
        triggerType: "THRESHOLD",
        configData: { metric: "TEMP", high: 26.5 },
      },
    });
    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 201);
    assert.deepEqual(body.configData, { metric: "TEMP", high: 26.5 });
    trackId(body.id);
  });

  test("POST - THRESHOLD with { sensor, condition, value, action } succeeds", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/device-configs",
      payload: {
        growPhaseId: phaseId,
        deviceId,
        triggerType: "THRESHOLD",
        configData: {
          sensor: "TEMPERATURE",
          condition: "GREATER_THAN",
          value: 26.5,
          action: "ON",
        },
      },
    });
    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 201);
    assert.equal(body.configData.condition, "GREATER_THAN");
    assert.equal(body.configData.action, "ON");
    trackId(body.id);
  });

  test("POST - ALWAYS_ON with empty object succeeds", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/device-configs",
      payload: {
        growPhaseId: phaseId,
        deviceId,
        triggerType: "ALWAYS_ON",
        configData: {},
      },
    });
    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 201);
    assert.equal(body.triggerType, "ALWAYS_ON");
    trackId(body.id);
  });

  test("POST - ALWAYS_ON with extra fields is accepted (lenient)", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/device-configs",
      payload: {
        growPhaseId: phaseId,
        deviceId,
        triggerType: "ALWAYS_ON",
        configData: { reason: "circulation fan", pinned: true },
      },
    });
    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 201);
    trackId(body.id);
  });

  test("POST - ALWAYS_OFF with empty object succeeds", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/device-configs",
      payload: {
        growPhaseId: phaseId,
        deviceId,
        triggerType: "ALWAYS_OFF",
        configData: {},
      },
    });
    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 201);
    assert.equal(body.triggerType, "ALWAYS_OFF");
    trackId(body.id);
  });

  test("POST - SCHEDULE with neither durationHours nor offTime is rejected", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/device-configs",
      payload: {
        growPhaseId: phaseId,
        deviceId,
        triggerType: "SCHEDULE",
        configData: { onTime: "06:00" },
      },
    });
    assert.equal(response.statusCode, 400);
  });

  test("POST - THRESHOLD with missing 'high' is rejected", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/device-configs",
      payload: {
        growPhaseId: phaseId,
        deviceId,
        triggerType: "THRESHOLD",
        configData: { metric: "TEMP" },
      },
    });
    assert.equal(response.statusCode, 400);
  });

  test("POST - THRESHOLD condition form missing 'value' is rejected", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/device-configs",
      payload: {
        growPhaseId: phaseId,
        deviceId,
        triggerType: "THRESHOLD",
        configData: {
          sensor: "TEMPERATURE",
          condition: "GREATER_THAN",
          action: "ON",
        },
      },
    });
    assert.equal(response.statusCode, 400);
  });

  test("POST - bad time format is rejected", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/device-configs",
      payload: {
        growPhaseId: phaseId,
        deviceId,
        triggerType: "SCHEDULE",
        configData: { onTime: "6am", durationHours: 18 },
      },
    });
    assert.equal(response.statusCode, 400);
  });

  test("PUT - valid SCHEDULE pair succeeds", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/device-configs",
      payload: {
        growPhaseId: phaseId,
        deviceId,
        triggerType: "SCHEDULE",
        configData: { onTime: "06:00", durationHours: 12 },
      },
    });
    const created = JSON.parse(createRes.body);
    trackId(created.id);

    const updateRes = await app.inject({
      method: "PUT",
      url: `/api/device-configs/${created.id}`,
      payload: {
        triggerType: "SCHEDULE",
        configData: { onTime: "08:00", durationHours: 16 },
      },
    });
    const updated = JSON.parse(updateRes.body);
    assert.equal(updateRes.statusCode, 200);
    assert.deepEqual(updated.configData, { onTime: "08:00", durationHours: 16 });
  });

  test("PUT - changing triggerType requires matching configData", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/device-configs",
      payload: {
        growPhaseId: phaseId,
        deviceId,
        triggerType: "ALWAYS_ON",
        configData: {},
      },
    });
    const created = JSON.parse(createRes.body);
    trackId(created.id);

    const updateRes = await app.inject({
      method: "PUT",
      url: `/api/device-configs/${created.id}`,
      payload: {
        triggerType: "THRESHOLD",
        configData: {}, // wrong shape for THRESHOLD
      },
    });
    assert.equal(updateRes.statusCode, 400);
  });

  test("PUT - missing configData is rejected", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/device-configs",
      payload: {
        growPhaseId: phaseId,
        deviceId,
        triggerType: "ALWAYS_ON",
        configData: {},
      },
    });
    const created = JSON.parse(createRes.body);
    trackId(created.id);

    const updateRes = await app.inject({
      method: "PUT",
      url: `/api/device-configs/${created.id}`,
      payload: { triggerType: "ALWAYS_OFF" },
    });
    assert.equal(updateRes.statusCode, 400);
  });

  test("PUT - missing triggerType is rejected", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/device-configs",
      payload: {
        growPhaseId: phaseId,
        deviceId,
        triggerType: "ALWAYS_ON",
        configData: {},
      },
    });
    const created = JSON.parse(createRes.body);
    trackId(created.id);

    const updateRes = await app.inject({
      method: "PUT",
      url: `/api/device-configs/${created.id}`,
      payload: { configData: {} },
    });
    assert.equal(updateRes.statusCode, 400);
  });
});
