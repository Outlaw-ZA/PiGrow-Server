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

  test("PUT /grow-cycles/:id - Should accept a date-only startAt (YYYY-MM-DD) and return it without a timestamp", async () => {
    // Create a fresh cycle to update
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/grow-cycles",
      payload: {
        name: "Date Only Start Run",
        controllerId: testControllerId,
        isActive: true,
      },
    });
    const created = JSON.parse(createResponse.body);
    assert.equal(createResponse.statusCode, 201);
    assert.equal(created.startAt, null, "Freshly created cycle should have null startAt");

    // Update with a date-only string — no timestamp component
    const updateResponse = await app.inject({
      method: "PUT",
      url: `/api/grow-cycles/${created.id}`,
      payload: { startAt: "2026-06-16" },
    });
    const updated = JSON.parse(updateResponse.body);
    assert.equal(updateResponse.statusCode, 200);
    assert.equal(
      updated.startAt,
      "2026-06-16",
      "PUT response should expose startAt as a date-only YYYY-MM-DD string",
    );

    // Confirm the same shape on subsequent reads (GET by id and via the list)
    const getResponse = await app.inject({
      method: "GET",
      url: `/api/grow-cycles/${created.id}`,
    });
    const fetched = JSON.parse(getResponse.body);
    assert.equal(getResponse.statusCode, 200);
    assert.equal(fetched.startAt, "2026-06-16");

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/grow-cycles",
    });
    const list = JSON.parse(listResponse.body);
    const listed = list.find((c: { id: string }) => c.id === created.id);
    assert.equal(listed.startAt, "2026-06-16");
  });

  test("PUT /grow-cycles/:id - Should reject a full date-time string (timestamp is no longer accepted)", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/grow-cycles",
      payload: {
        name: "Reject DateTime Run",
        controllerId: testControllerId,
        isActive: false,
      },
    });
    const created = JSON.parse(createResponse.body);

    const updateResponse = await app.inject({
      method: "PUT",
      url: `/api/grow-cycles/${created.id}`,
      payload: { startAt: "2026-06-16T00:00:00.000Z" },
    });

    assert.equal(
      updateResponse.statusCode,
      400,
      "Validation must reject date-time strings now that startAt is date-only",
    );
  });
});
