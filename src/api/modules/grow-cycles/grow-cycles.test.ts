import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestApp } from "../test-helper.js";

describe("Grow Cycles API Feature Module", () => {
  let app: any;
  let prismaClient: any;
  let testControllerId: string;

  before(async () => {
    const { server, prisma } = await createTestApp();
    app = server;
    prismaClient = prisma;

    // Provision a physical hub layout complete with default devices to verify our transaction logic
    const controller = await prismaClient.controller.create({
      data: {
        macAddress: "aa:bb:cc:dd:ee:ff",
        name: "Cycle Automation Test Pi Setup",
        ipAddress: "192.168.1.100",
        devices: {
          create: [
            {
              name: "LED Grow Panel",
              type: "LIGHT",
              pinNumber: 5,
              mqttTopic: "test/light",
            },
            {
              name: "Exhaust Extractor Fan",
              type: "EXHAUST_FAN",
              pinNumber: 16,
              mqttTopic: "test/fan",
            },
          ],
        },
      },
    });
    testControllerId = controller.id;
  });

  after(async () => {
    await prismaClient.controller.delete({ where: { id: testControllerId } });
    await prismaClient.$disconnect();
    await app.close();
  });

  test("POST /grow-cycles - Should initialize cycle and auto-generate 4 structural phases with hardware configurations embedded", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/grow-cycles",
      payload: {
        name: "Blue Dream Automated Crop Run",
        controllerId: testControllerId,
        isActive: true,
      },
    });

    const body = JSON.parse(response.body);

    assert.equal(response.statusCode, 201);
    assert.equal(body.name, "Blue Dream Automated Crop Run");
    assert.equal(body.isActive, true);

    // CRITICAL CORE INTEGRITY ASSERTIONS
    assert.ok(
      Array.isArray(body.phases),
      "Response payload data should expose standard sub-phase array data",
    );
    assert.equal(
      body.phases.length,
      4,
      "Grow cycles must explicitly initialize with exactly 4 stages matching the structural blueprint rules",
    );
    assert.equal(body.phases[0].name, "Seedling / Clone");

    // Validates that our nested write script successfully discovered the parent hardware profile and generated operational constraints
    assert.ok(
      body.phases[0].deviceConfigs.length > 0,
      "Phase mappings must include pre-populated automated device rule configurations",
    );
  });
});
