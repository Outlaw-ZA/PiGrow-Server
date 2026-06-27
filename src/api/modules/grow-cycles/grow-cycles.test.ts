import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestApp } from "../test-helper.js";

describe("Grow Cycles API Feature Module", () => {
  let app: any;
  let prismaClient: any;

  // Per-run unique MAC base so this suite can run repeatedly without colliding
  // with rows from previous runs.
  const macBase = `${Date.now().toString(16)}`.padStart(8, "0");
  const macPrefix = `aa:bb:cc:${macBase.slice(0, 2)}:${macBase.slice(2, 4)}`;

  before(async () => {
    const { server, prisma } = await createTestApp();
    app = server;
    prismaClient = prisma;
  });

  after(async () => {
    // Clean up all controllers this run created (any MAC matching our prefix).
    // Delete grow cycles first so the controller FK is no longer referenced.
    await prismaClient.growCycle.deleteMany({
      where: { controller: { macAddress: { startsWith: macPrefix } } },
    });
    await prismaClient.controller.deleteMany({
      where: { macAddress: { startsWith: macPrefix } },
    });
    await prismaClient.$disconnect();
    await app.close();
  });

  // Helper: provision a fresh controller + grow cycle pair, each with its own
  // unique mac address. This is required because the schema enforces at most
  // ONE active grow per controller, so every test that needs an active grow
  // must get a dedicated controller.
  const macCounter = { n: 0 };
  async function seedControllerAndCycle(options: {
    name: string;
    isActive?: boolean;
    startAt?: string;
    devices?: Array<{
      name: string;
      type: "LIGHT" | "EXHAUST_FAN" | "INTAKE_FAN" | "CIRCULATION_FAN" | "WATER_PUMP" | "AIR_CONDITIONER" | "HEATER" | "HUMIDIFIER" | "DEHUMIDIFIER" | "CO2_INJECTOR";
      pinNumber: number;
      mqttTopic: string;
    }>;
  }) {
    const mac = `aa:bb:cc:${macBase.slice(0, 2)}:${macBase.slice(2, 4)}:${(macCounter.n++).toString(16).padStart(2, "0")}`;
    const controller = await prismaClient.controller.create({
      data: {
        macAddress: mac,
        name: options.name,
        ipAddress: "192.168.1.100",
      },
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/grow-cycles",
      payload: {
        name: options.name,
        controllerId: controller.id,
        isActive: options.isActive ?? true,
        devices: options.devices ?? [],
      },
    });
    const created = JSON.parse(createResponse.body);
    assert.equal(createResponse.statusCode, 201);

    if (options.startAt) {
      await app.inject({
        method: "PUT",
        url: `/api/grow-cycles/${created.id}`,
        payload: { startAt: options.startAt },
      });
    }

    return { controllerId: controller.id, growCycleId: created.id, body: created };
  }

  test("POST /grow-cycles - Should initialize cycle and auto-generate 4 structural phases with hardware configurations embedded", async () => {
    const { body } = await seedControllerAndCycle({
      name: "Blue Dream Automated Crop Run",
      isActive: true,
      devices: [
        { name: "LED Grow Panel", type: "LIGHT", pinNumber: 5, mqttTopic: "test/light" },
        { name: "Exhaust Extractor Fan", type: "EXHAUST_FAN", pinNumber: 16, mqttTopic: "test/fan" },
      ],
    });

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

    // Validates that the nested write successfully wired the per-grow devices
    // into operational constraints across every phase.
    assert.ok(
      body.phases[0].deviceConfigs.length > 0,
      "Phase mappings must include pre-populated automated device rule configurations",
    );
  });

  test("PUT /grow-cycles/:id - Should accept a date-only startAt (YYYY-MM-DD) and return it without a timestamp", async () => {
    const { growCycleId } = await seedControllerAndCycle({
      name: "Date Only Start Run",
      isActive: true,
    });

    const updateResponse = await app.inject({
      method: "PUT",
      url: `/api/grow-cycles/${growCycleId}`,
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
      url: `/api/grow-cycles/${growCycleId}`,
    });
    const fetched = JSON.parse(getResponse.body);
    assert.equal(getResponse.statusCode, 200);
    assert.equal(fetched.startAt, "2026-06-16");

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/grow-cycles",
    });
    const list = JSON.parse(listResponse.body);
    const listed = list.find((c: { id: string }) => c.id === growCycleId);
    assert.equal(listed.startAt, "2026-06-16");
  });

  test("PUT /grow-cycles/:id - Should reject a full date-time string (timestamp is no longer accepted)", async () => {
    const { growCycleId } = await seedControllerAndCycle({
      name: "Reject DateTime Run",
      isActive: false,
    });

    const updateResponse = await app.inject({
      method: "PUT",
      url: `/api/grow-cycles/${growCycleId}`,
      payload: { startAt: "2026-06-16T00:00:00.000Z" },
    });

    assert.equal(
      updateResponse.statusCode,
      400,
      "Validation must reject date-time strings now that startAt is date-only",
    );
  });

  test("POST /grow-cycles - Should reject 409 when the controller already has an active grow cycle", async () => {
    const { controllerId } = await seedControllerAndCycle({
      name: "First Active Cycle",
      isActive: true,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/grow-cycles",
      payload: {
        name: "Second Active Cycle Attempt",
        controllerId,
        isActive: true,
        devices: [],
      },
    });

    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 409);
    assert.match(body.error, /active grow cycle/i);
  });

  test("POST /grow-cycles - Should allow a second (inactive) grow cycle on a controller that already has an active one", async () => {
    const { controllerId } = await seedControllerAndCycle({
      name: "Primary Active Cycle",
      isActive: true,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/grow-cycles",
      payload: {
        name: "Secondary Inactive Cycle",
        controllerId,
        isActive: false,
        devices: [],
      },
    });

    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 201);
    assert.equal(body.isActive, false);
  });

  test("POST /grow-cycles/:id/skip-phase - Happy path: trims active phase and cascades shift to subsequent phases", async () => {
    const { growCycleId } = await seedControllerAndCycle({
      name: "Skip Happy Path",
      isActive: true,
      startAt: "2026-01-01",
    });

    await overridePhaseDurations(growCycleId, [10, 20, 15, 5]);

    // today = 2026-01-16 lands in P2's range [2026-01-11, 2026-01-31)
    const skipResponse = await app.inject({
      method: "POST",
      url: `/api/grow-cycles/${growCycleId}/skip-phase?today=2026-01-16`,
    });
    const body = JSON.parse(skipResponse.body);

    assert.equal(skipResponse.statusCode, 200);
    assert.equal(body.id, growCycleId);
    assert.ok(Array.isArray(body.phases));

    const phases = body.phases;
    const p1 = phases[0];
    const p2 = phases[1];
    const p3 = phases[2];
    const p4 = phases[3];

    assert.equal(p2.durationDays, 5, "Active phase trimmed to elapsed days (16 - 11 = 5)");
    assert.equal(p2.endAt, "2026-01-16", "Active phase endAt set to today");
    assert.equal(p2.isActive, false, "Skipped phase deactivated");

    assert.equal(p3.startAt, "2026-01-16", "Next phase startAt equals today (= previous endAt)");
    assert.equal(p3.durationDays, 15, "Next phase duration unchanged");
    assert.equal(p3.endAt, "2026-01-31", "Next phase endAt = today + its duration");
    assert.equal(p3.isActive, true, "Next phase is now active");

    assert.equal(p4.startAt, "2026-01-31", "Phase 4 startAt shifted earlier by 15 days");
    assert.equal(p4.endAt, "2026-02-05", "Phase 4 endAt shifted earlier by 15 days");
    assert.equal(p4.durationDays, 5, "Phase 4 duration unchanged");

    assert.equal(p1.startAt, "2026-01-01", "Earlier phase startAt unchanged");
    assert.equal(p1.endAt, "2026-01-11", "Earlier phase endAt unchanged");
    assert.equal(p1.isActive, false, "Earlier phase remains inactive");
  });

  test("POST /grow-cycles/:id/skip-phase - Should reject when cycle has not started (startAt null)", async () => {
    const { growCycleId } = await seedControllerAndCycle({
      name: "Skip Not Started",
      isActive: false,
    });

    const skipResponse = await app.inject({
      method: "POST",
      url: `/api/grow-cycles/${growCycleId}/skip-phase?today=2026-06-01`,
    });
    const body = JSON.parse(skipResponse.body);

    assert.equal(skipResponse.statusCode, 400);
    assert.equal(body.error, "Grow cycle has not started yet");
  });

  test("POST /grow-cycles/:id/skip-phase - Should reject when no phase is active (before startAt)", async () => {
    const { growCycleId } = await seedControllerAndCycle({
      name: "Skip Before Start",
      isActive: true,
      startAt: "2030-01-01",
    });
    await overridePhaseDurations(growCycleId, [10, 20, 15, 5]);

    const skipResponse = await app.inject({
      method: "POST",
      url: `/api/grow-cycles/${growCycleId}/skip-phase?today=2025-12-31`,
    });
    const body = JSON.parse(skipResponse.body);

    assert.equal(skipResponse.statusCode, 400);
    assert.equal(body.error, "No active phase to skip");
  });

  test("POST /grow-cycles/:id/skip-phase - Should reject when the last phase is active", async () => {
    const { growCycleId } = await seedControllerAndCycle({
      name: "Skip Last Phase",
      isActive: true,
      startAt: "2026-01-01",
    });
    await overridePhaseDurations(growCycleId, [10, 20, 15, 5]);

    // today = 2026-02-17 lands in P4's range [2026-02-15, 2026-02-20)
    const skipResponse = await app.inject({
      method: "POST",
      url: `/api/grow-cycles/${growCycleId}/skip-phase?today=2026-02-17`,
    });
    const body = JSON.parse(skipResponse.body);

    assert.equal(skipResponse.statusCode, 400);
    assert.equal(body.error, "Cannot skip the final grow phase");
  });

  test("POST /grow-cycles/:id/skip-phase - Should allow 0-day skipped phase when active started today", async () => {
    const { growCycleId } = await seedControllerAndCycle({
      name: "Skip Day 1",
      isActive: true,
      startAt: "2026-01-01",
    });
    await overridePhaseDurations(growCycleId, [10, 20, 15, 5]);

    // today = 2026-01-01 = P1 startAt, so P1 is active with elapsed = 0
    const skipResponse = await app.inject({
      method: "POST",
      url: `/api/grow-cycles/${growCycleId}/skip-phase?today=2026-01-01`,
    });
    const body = JSON.parse(skipResponse.body);
    assert.equal(skipResponse.statusCode, 200);

    const phases = body.phases;
    assert.equal(phases[0].durationDays, 0, "Skipped phase has 0 days when started today");
    assert.equal(phases[0].endAt, "2026-01-01", "Skipped phase endAt is today");
    assert.equal(phases[1].startAt, "2026-01-01", "Next phase startAt is today");
    assert.equal(phases[1].isActive, true, "Next phase is now active");
  });

  test("POST /grow-cycles/:id/skip-phase - Should accept the today query parameter and use it for computation", async () => {
    const { growCycleId } = await seedControllerAndCycle({
      name: "Skip Today Override",
      isActive: true,
      startAt: "2026-01-01",
    });
    await overridePhaseDurations(growCycleId, [10, 20, 15, 5]);

    // today = 2026-01-21 lands in P2's range [2026-01-11, 2026-01-31)
    // elapsed = 21 - 11 = 10, leftover = 20 - 10 = 10
    const skipResponse = await app.inject({
      method: "POST",
      url: `/api/grow-cycles/${growCycleId}/skip-phase?today=2026-01-21`,
    });
    assert.equal(skipResponse.statusCode, 200);

    const body = JSON.parse(skipResponse.body);
    const p2 = body.phases[1];
    assert.equal(
      p2.durationDays,
      10,
      "Elapsed days match the override (21 - 11 = 10)",
    );
    assert.equal(p2.endAt, "2026-01-21");
    assert.equal(
      body.phases[3].endAt,
      "2026-02-10",
      "Last phase endAt shifted earlier by exactly the leftover (10 days)",
    );
  });

  test("POST /grow-cycles/:id/skip-phase - Calling twice should advance the active phase by one each time", async () => {
    const { growCycleId } = await seedControllerAndCycle({
      name: "Skip Double Advance",
      isActive: true,
      startAt: "2026-01-01",
    });
    await overridePhaseDurations(growCycleId, [10, 20, 15, 5]);

    // First skip: today = 2026-01-16 → skip P2, P3 becomes active
    const first = await app.inject({
      method: "POST",
      url: `/api/grow-cycles/${growCycleId}/skip-phase?today=2026-01-16`,
    });
    assert.equal(first.statusCode, 200);
    const firstBody = JSON.parse(first.body);
    assert.equal(firstBody.phases[2].isActive, true, "After first skip, phase 3 active");
    assert.equal(firstBody.phases[1].endAt, "2026-01-16");

    // Second skip: today = 2026-01-26 → P3 active (range [2026-01-16, 2026-01-31))
    // elapsed = 26 - 16 = 10, leftover = 15 - 10 = 5
    const second = await app.inject({
      method: "POST",
      url: `/api/grow-cycles/${growCycleId}/skip-phase?today=2026-01-26`,
    });
    assert.equal(second.statusCode, 200);
    const secondBody = JSON.parse(second.body);
    assert.equal(secondBody.phases[3].isActive, true, "After second skip, phase 4 active");
    assert.equal(secondBody.phases[2].endAt, "2026-01-26");
    assert.equal(secondBody.phases[2].durationDays, 10, "Phase 3 trimmed to its elapsed days");
    assert.equal(secondBody.phases[3].startAt, "2026-01-26", "Phase 4 startAt = today");
  });

  test("POST /grow-cycles/:id/skip-phase - Should return 404 when the cycle does not exist", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const skipResponse = await app.inject({
      method: "POST",
      url: `/api/grow-cycles/${fakeId}/skip-phase?today=2026-01-01`,
    });
    assert.equal(skipResponse.statusCode, 404);
  });

  test("POST /grow-cycles/:id/end-grow - Happy path: trims active phase, marks cycle inactive, deactivates all phases", async () => {
    const { growCycleId } = await seedControllerAndCycle({
      name: "End Grow Happy Path",
      isActive: true,
      startAt: "2026-01-01",
    });
    await overridePhaseDurations(growCycleId, [10, 20, 15, 5]);

    // today = 2026-02-17 lands in P4's range [2026-02-15, 2026-02-20)
    // elapsed = 17 - 15 = 2, leftover = 5 - 2 = 3
    const endResponse = await app.inject({
      method: "POST",
      url: `/api/grow-cycles/${growCycleId}/end-grow?today=2026-02-17`,
    });
    const body = JSON.parse(endResponse.body);

    assert.equal(endResponse.statusCode, 200);
    assert.equal(body.isActive, false, "Cycle marked inactive");
    assert.ok(Array.isArray(body.phases));

    const phases = body.phases;
    const lastPhase = phases[3];

    assert.equal(
      lastPhase.durationDays,
      2,
      "Last phase trimmed to elapsed days (17 - 15 = 2)",
    );
    assert.equal(
      lastPhase.endAt,
      "2026-02-17",
      "Last phase endAt set to today",
    );
    assert.equal(lastPhase.isActive, false, "Last phase deactivated");
    assert.equal(
      phases[0].isActive,
      false,
      "Earlier phase 1 deactivated",
    );
    assert.equal(
      phases[1].isActive,
      false,
      "Earlier phase 2 deactivated",
    );
    assert.equal(
      phases[2].isActive,
      false,
      "Earlier phase 3 deactivated",
    );
    assert.equal(
      phases[2].endAt,
      "2026-02-15",
      "Phase 3 endAt unchanged (only the active phase shifts)",
    );
  });

  test("POST /grow-cycles/:id/end-grow - Should reject when cycle has not started (startAt null)", async () => {
    const { growCycleId } = await seedControllerAndCycle({
      name: "End Grow Not Started",
      isActive: false,
    });

    const endResponse = await app.inject({
      method: "POST",
      url: `/api/grow-cycles/${growCycleId}/end-grow?today=2026-06-01`,
    });
    const body = JSON.parse(endResponse.body);

    assert.equal(endResponse.statusCode, 400);
    assert.equal(body.error, "Grow cycle has not started yet");
  });

  test("POST /grow-cycles/:id/end-grow - Should reject when no phase is active (today past last endAt)", async () => {
    const { growCycleId } = await seedControllerAndCycle({
      name: "End Grow No Active",
      isActive: true,
      startAt: "2026-01-01",
    });
    await overridePhaseDurations(growCycleId, [10, 20, 15, 5]);

    // today = 2026-03-01 is past the last phase's endAt (2026-02-20)
    const endResponse = await app.inject({
      method: "POST",
      url: `/api/grow-cycles/${growCycleId}/end-grow?today=2026-03-01`,
    });
    const body = JSON.parse(endResponse.body);

    assert.equal(endResponse.statusCode, 400);
    assert.equal(body.error, "No active phase to end");
  });

  test("POST /grow-cycles/:id/end-grow - Should accept the today query parameter and use it for computation", async () => {
    const { growCycleId } = await seedControllerAndCycle({
      name: "End Grow Today Override",
      isActive: true,
      startAt: "2026-01-01",
    });
    await overridePhaseDurations(growCycleId, [10, 20, 15, 5]);

    // today = 2026-02-18 lands in P4's range [2026-02-15, 2026-02-20)
    // elapsed = 18 - 15 = 3, leftover = 5 - 3 = 2
    const endResponse = await app.inject({
      method: "POST",
      url: `/api/grow-cycles/${growCycleId}/end-grow?today=2026-02-18`,
    });
    assert.equal(endResponse.statusCode, 200);

    const body = JSON.parse(endResponse.body);
    const lastPhase = body.phases[3];
    assert.equal(
      lastPhase.durationDays,
      3,
      "Elapsed days match the override (18 - 15 = 3)",
    );
    assert.equal(lastPhase.endAt, "2026-02-18");
    assert.equal(body.isActive, false);
  });

  test("POST /grow-cycles/:id/end-grow - Should return 404 when the cycle does not exist", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const endResponse = await app.inject({
      method: "POST",
      url: `/api/grow-cycles/${fakeId}/end-grow?today=2026-01-01`,
    });
    assert.equal(endResponse.statusCode, 404);
  });

  test("POST /grow-cycles/:id/end-grow - After end, the controller can start a new active grow", async () => {
    const { controllerId, growCycleId } = await seedControllerAndCycle({
      name: "Cycle Then End Then Restart",
      isActive: true,
      startAt: "2026-01-01",
    });
    await overridePhaseDurations(growCycleId, [10, 20, 15, 5]);

    const endResponse = await app.inject({
      method: "POST",
      url: `/api/grow-cycles/${growCycleId}/end-grow?today=2026-02-17`,
    });
    assert.equal(endResponse.statusCode, 200);

    const restartResponse = await app.inject({
      method: "POST",
      url: "/api/grow-cycles",
      payload: {
        name: "Sequential Next Grow",
        controllerId,
        isActive: true,
        devices: [],
      },
    });
    const restartBody = JSON.parse(restartResponse.body);
    assert.equal(restartResponse.statusCode, 201);
    assert.equal(restartBody.isActive, true);
    assert.equal(restartBody.controllerId, controllerId);
  });

  // Helper: override the auto-generated 4 phase durations for a given cycle.
  async function overridePhaseDurations(
    growCycleId: string,
    durations: [number, number, number, number],
  ) {
    const fetched = await prismaClient.growCycle.findUniqueOrThrow({
      where: { id: growCycleId },
      include: { phases: { orderBy: { order: "asc" } } },
    });

    for (let i = 0; i < durations.length; i++) {
      await prismaClient.growPhase.update({
        where: { id: fetched.phases[i].id },
        data: { durationDays: durations[i] },
      });
    }
  }
});
