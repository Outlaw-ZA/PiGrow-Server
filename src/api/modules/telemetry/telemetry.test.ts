import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestApp } from "../test-helper.js";

describe("Telemetry API Feature Module", () => {
  let app: any;
  let prismaClient: any;
  let testGrowCycleId: string;
  let testControllerMac = "ee:ee:ee:ee:ee:ee";

  before(async () => {
    const { server, prisma } = await createTestApp();
    app = server;
    prismaClient = prisma;

    const controller = await prismaClient.controller.create({
      data: {
        macAddress: testControllerMac,
        name: "Telemetry Test Pi",
        ipAddress: "192.168.1.100",
        growCycles: {
          create: {
            name: "Telemetry Test Cycle",
            isActive: false,
          },
        },
      },
      include: { growCycles: true },
    });

    testGrowCycleId = controller.growCycles[0].id;
  });

  after(async () => {
    // Delete in FK-safe order: grow cycles first, then the controller.
    await prismaClient.growCycle.deleteMany({
      where: { controller: { macAddress: testControllerMac } },
    });
    await prismaClient.controller.deleteMany({
      where: { macAddress: testControllerMac },
    });
    await prismaClient.$disconnect();
    await app.close();
  });

  test("POST /telemetry - Should ingest a new sensor reading", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/telemetry",
      payload: {
        growCycleId: testGrowCycleId,
        sensorType: "TEMPERATURE",
        value: 24.7,
      },
    });

    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 201);
    assert.equal(body.sensorType, "TEMPERATURE");
    assert.equal(body.value, 24.7);
  });

  test("GET /telemetry/grow-cycle/:id/latest - Should return latest reading per sensor type", async () => {
    await app.inject({
      method: "POST",
      url: "/api/telemetry",
      payload: {
        growCycleId: testGrowCycleId,
        sensorType: "HUMIDITY",
        value: 60,
      },
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/telemetry/grow-cycle/${testGrowCycleId}/latest`,
    });

    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 200);
    assert.ok(Array.isArray(body));
    const sensorTypes = body.map((r: any) => r.sensorType);
    assert.ok(sensorTypes.includes("TEMPERATURE"));
    assert.ok(sensorTypes.includes("HUMIDITY"));
  });
});
