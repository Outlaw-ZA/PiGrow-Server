import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestApp } from "../test-helper.js";

describe("Devices API Feature Module", () => {
  let app: any;
  let prismaClient: any;
  let testControllerId: string;

  before(async () => {
    const { server, prisma } = await createTestApp();
    app = server;
    prismaClient = prisma;

    // Provision a unique hub parent identity to bypass relational foreign-key blockers
    const controller = await prismaClient.controller.create({
      data: {
        macAddress: "00:1a:2b:3c:4d:5e",
        name: "Hardware Module Test Pi",
        ipAddress: "192.168.1.100",
      },
    });
    testControllerId = controller.id;
  });

  after(async () => {
    await prismaClient.controller.delete({ where: { id: testControllerId } });
    await prismaClient.$disconnect();
    await app.close();
  });

  test("POST /devices - Should provision a relay channel assignment", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/devices",
      payload: {
        controllerId: testControllerId,
        name: "SpiderFarmer LED Panel",
        type: "LIGHT",
        pinNumber: 4,
        mqttTopic: "tent1/device/light/cmd",
      },
    });

    const body = JSON.parse(response.body);

    assert.equal(response.statusCode, 201);
    assert.equal(body.controllerId, testControllerId);
    assert.equal(body.pinNumber, 4);
    assert.equal(body.isActive, true); // Validates schema-defined dynamic default value fallback
  });
});
