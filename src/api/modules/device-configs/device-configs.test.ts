import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestApp } from "../test-helper.js";

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
    await prismaClient.controller.deleteMany({
      where: { macAddress: "dc:cf:cf:cf:cf:cf" },
    });
    await prismaClient.$disconnect();
    await app.close();
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
