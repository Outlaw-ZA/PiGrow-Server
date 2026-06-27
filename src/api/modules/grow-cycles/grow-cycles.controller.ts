import { FastifyInstance } from "fastify";

export class SkipPhaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkipPhaseError";
  }
}

export class ControllerBusyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ControllerBusyError";
  }
}

type DeviceTypeLiteral =
  | "LIGHT"
  | "EXHAUST_FAN"
  | "INTAKE_FAN"
  | "CIRCULATION_FAN"
  | "WATER_PUMP"
  | "AIR_CONDITIONER"
  | "HEATER"
  | "HUMIDIFIER"
  | "DEHUMIDIFIER"
  | "CO2_INJECTOR";

interface GrowDeviceItem {
  name: string;
  type: DeviceTypeLiteral;
  pinNumber: number;
  mqttTopic: string;
  isActive?: boolean;
}

export class GrowCyclesController {
  private prisma;

  constructor(server: FastifyInstance) {
    this.prisma = server.prisma;
  }

  private formatDateOnly(date: Date | null): string | null {
    return date ? date.toISOString().slice(0, 10) : null;
  }

  private serializeStartAt<T extends { startAt: Date | null } | { startAt: Date | null }[]>(cycle: T): T {
    if (Array.isArray(cycle)) {
      return cycle.map((c) => ({ ...c, startAt: this.formatDateOnly(c.startAt) })) as T;
    }
    return { ...cycle, startAt: this.formatDateOnly(cycle.startAt) } as T;
  }

  private serializePhaseDates<T extends { startAt: Date | null; endAt: Date | null } | { startAt: Date | null; endAt: Date | null }[]>(phases: T): T {
    if (Array.isArray(phases)) {
      return phases.map((p) => ({
        ...p,
        startAt: this.formatDateOnly(p.startAt),
        endAt: this.formatDateOnly(p.endAt),
      })) as T;
    }
    return {
      ...phases,
      startAt: this.formatDateOnly(phases.startAt),
      endAt: this.formatDateOnly(phases.endAt),
    } as T;
  }

  // Reject if the controller already has an active grow cycle.
  private async assertControllerAvailable(controllerId: string, exceptGrowCycleId?: string) {
    const active = await this.prisma.growCycle.findFirst({
      where: {
        controllerId,
        isActive: true,
        ...(exceptGrowCycleId ? { NOT: { id: exceptGrowCycleId } } : {}),
      },
      select: { id: true },
    });
    if (active) {
      throw new ControllerBusyError(
        "Controller already has an active grow cycle. End the current grow before starting a new one.",
      );
    }
  }

  // 1. READ ALL (Includes assigned Raspberry Pi details)
  async getAllGrowCycles() {
    const cycles = await this.prisma.growCycle.findMany({
      include: {
        controller: {
          select: {
            name: true,
            status: true,
          },
        },
      },
    });
    return this.serializeStartAt(cycles);
  }

  // 2. READ ONE (Deeply fetches related phases and active device rules)
  async getGrowCycleById(id: string) {
    const cycle = await this.prisma.growCycle.findUniqueOrThrow({
      where: { id },
      include: {
        controller: true,
        devices: true,
        phases: {
          orderBy: {
            order: "asc",
          },
          include: {
            deviceConfigs: {
              include: {
                device: true,
              },
            },
          },
        },
      },
    });
    cycle.phases = this.serializePhaseDates(cycle.phases);
    return this.serializeStartAt(cycle);
  }

  // 3. CREATE
  // Atomically provisions: GrowCycle + per-grow Devices + 4 phases + per-phase DeviceConfigs.
  // The devices array is provided in the body so the blueprint can reference the freshly
  // created device IDs when building per-phase DeviceConfig rows.
  async createGrowCycle(body: {
    name: string;
    controllerId: string;
    isActive?: boolean;
    devices: GrowDeviceItem[];
  }) {
    const isActive = body.isActive ?? false;

    // Enforce one-active-grow-per-controller at the application layer for a clean 409.
    // The DB partial unique index is the structural backstop.
    if (isActive) {
      await this.assertControllerAvailable(body.controllerId);
    }

    // 1. Persist the GrowCycle (no phases/devices yet) so we have a stable id.
    const createdCycle = await this.prisma.growCycle.create({
      data: {
        name: body.name,
        controllerId: body.controllerId,
        isActive,
      },
    });

    // 2. Create the per-grow devices linked to the new cycle.
    let createdDevices: Array<{ id: string; type: string }> = [];
    if (body.devices.length > 0) {
      const result = await this.prisma.$transaction(
        body.devices.map((device) =>
          this.prisma.device.create({
            data: {
              growCycleId: createdCycle.id,
              name: device.name,
              type: device.type,
              pinNumber: device.pinNumber,
              mqttTopic: device.mqttTopic,
              isActive: device.isActive ?? true,
            },
            select: { id: true, type: true },
          }),
        ),
      );
      createdDevices = result;
    }

    // 3. Resolve devices by type for blueprint wiring.
    const findDevice = (type: string) => createdDevices.find((d) => d.type === type);
    const lightDevice = findDevice("LIGHT");
    const exhaustFan = findDevice("EXHAUST_FAN");
    const pumpDevice = findDevice("WATER_PUMP");

    // 4. Build the 4-phase structural blueprint with per-phase DeviceConfigs.
    const phaseBlueprints = [
      {
        name: "Seedling / Clone",
        order: 1,
        durationDays: 14,
        isActive: true,
        deviceConfigs: {
          create: [
            ...(lightDevice
              ? [
                  {
                    deviceId: lightDevice.id,
                    triggerType: "SCHEDULE" as const,
                    configData: { onTime: "06:00", durationHours: 18 },
                  },
                ]
              : []),
            ...(exhaustFan
              ? [
                  {
                    deviceId: exhaustFan.id,
                    triggerType: "THRESHOLD" as const,
                    configData: { metric: "TEMP", high: 25.0 },
                  },
                ]
              : []),
          ],
        },
      },
      {
        name: "Vegetative Stage",
        order: 2,
        durationDays: 30,
        isActive: false,
        deviceConfigs: {
          create: [
            ...(lightDevice
              ? [
                  {
                    deviceId: lightDevice.id,
                    triggerType: "SCHEDULE" as const,
                    configData: { onTime: "06:00", durationHours: 22 },
                  },
                ]
              : []),
            ...(exhaustFan
              ? [
                  {
                    deviceId: exhaustFan.id,
                    triggerType: "THRESHOLD" as const,
                    configData: { metric: "TEMP", high: 26.5 },
                  },
                ]
              : []),
          ],
        },
      },
      {
        name: "Flowering / Bloom",
        order: 3,
        durationDays: 60,
        isActive: false,
        deviceConfigs: {
          create: [
            ...(lightDevice
              ? [
                  {
                    deviceId: lightDevice.id,
                    triggerType: "SCHEDULE" as const,
                    configData: { onTime: "06:00", durationHours: 12 },
                  },
                ]
              : []),
            ...(exhaustFan
              ? [
                  {
                    deviceId: exhaustFan.id,
                    triggerType: "THRESHOLD" as const,
                    configData: { metric: "TEMP", high: 26.0 },
                  },
                ]
              : []),
          ],
        },
      },
      {
        name: "Curing / Harvest",
        order: 4,
        durationDays: 7,
        isActive: false,
        deviceConfigs: {
          create: [
            ...(lightDevice
              ? [
                  {
                    deviceId: lightDevice.id,
                    triggerType: "ALWAYS_OFF" as const,
                    configData: {},
                  },
                ]
              : []),
            ...(pumpDevice
              ? [
                  {
                    deviceId: pumpDevice.id,
                    triggerType: "ALWAYS_OFF" as const,
                    configData: {},
                  },
                ]
              : []),
          ],
        },
      },
    ];

    // 5. Create the 4 phases in order with their per-phase DeviceConfigs.
    await this.prisma.$transaction(
      phaseBlueprints.map((phase) =>
        this.prisma.growPhase.create({
          data: {
            growCycleId: createdCycle.id,
            name: phase.name,
            order: phase.order,
            durationDays: phase.durationDays,
            isActive: phase.isActive,
            deviceConfigs: phase.deviceConfigs,
          },
        }),
      ),
    );

    return this.getGrowCycleById(createdCycle.id);
  }

  // 4. UPDATE
  async updateGrowCycle(
    id: string,
    body: {
      name?: string;
      isActive?: boolean;
      startAt?: string;
    },
  ) {
    const { startAt, isActive, ...rest } = body;

    if (isActive === true) {
      const cycle = await this.prisma.growCycle.findUniqueOrThrow({
        where: { id },
        select: { controllerId: true },
      });
      await this.assertControllerAvailable(cycle.controllerId, id);
    }

    const updated = await this.prisma.growCycle.update({
      where: { id },
      data: {
        ...rest,
        isActive: isActive,
        startAt: startAt ? new Date(startAt) : undefined,
      },
    });
    return this.serializeStartAt(updated);
  }

  // 5. DELETE
  async deleteGrowCycle(id: string) {
    await this.prisma.growCycle.delete({
      where: { id },
    });
  }

  // 6. SKIP ACTIVE PHASE
  // Trims the active phase's remaining days, cascades the date shift across
  // all subsequent phases, and activates the next phase — atomically.
  async skipPhase(id: string, todayOverride?: string) {
    const cycle = await this.prisma.growCycle.findUniqueOrThrow({
      where: { id },
      include: {
        phases: {
          orderBy: { order: "asc" },
        },
      },
    });

    if (!cycle.startAt) {
      throw new SkipPhaseError("Grow cycle has not started yet");
    }

    const today = todayOverride ?? this.formatDateOnly(new Date());
    if (!today) {
      throw new SkipPhaseError("Server could not determine today's date");
    }

    // Canonicalize every phase's startAt/endAt from cycle.startAt + cumulative durations
    this.recalculatePhaseDates(cycle.phases, cycle.startAt);

    // Find the active phase: today >= startAt && today < endAt (lex on YYYY-MM-DD)
    const activeIdx = cycle.phases.findIndex(
      (p) =>
        p.startAt &&
        p.endAt &&
        today >= this.formatDateOnly(p.startAt)! &&
        today < this.formatDateOnly(p.endAt)!,
    );

    if (activeIdx < 0) {
      throw new SkipPhaseError("No active phase to skip");
    }

    if (activeIdx === cycle.phases.length - 1) {
      throw new SkipPhaseError("Cannot skip the final grow phase");
    }

    const active = cycle.phases[activeIdx];
    const elapsed = this.daysBetween(active.startAt!, today);
    active.durationDays = elapsed; // 0 allowed when phase started today

    // Re-cascade with the new duration so every phase gets shifted startAt/endAt
    this.recalculatePhaseDates(cycle.phases, cycle.startAt);

    const next = cycle.phases[activeIdx + 1];

    await this.prisma.$transaction([
      // Clear isActive on all phases in the cycle
      this.prisma.growPhase.updateMany({
        where: { growCycleId: id },
        data: { isActive: false },
      }),
      // Activate the next phase (the one immediately after the skipped one)
      this.prisma.growPhase.update({
        where: { id: next.id },
        data: { isActive: true },
      }),
      // Persist every phase's canonicalized startAt/endAt + the active phase's
      // new durationDays. Writing all phases makes this endpoint the single
      // source of truth for phase date derivation.
      ...cycle.phases.map((p) =>
        this.prisma.growPhase.update({
          where: { id: p.id },
          data: {
            durationDays:
              p.id === active.id ? elapsed : p.durationDays,
            startAt: p.startAt,
            endAt: p.endAt,
          },
        }),
      ),
    ]);

    return this.getGrowCycleById(id);
  }

  // 7. END GROW
  // Trims the active phase's remaining days, canonicalizes all dates, marks
  // the cycle inactive, and deactivates all phases — atomically. Works from
  // any active phase; the FE chooses when to expose the option.
  async endGrow(id: string, todayOverride?: string) {
    const cycle = await this.prisma.growCycle.findUniqueOrThrow({
      where: { id },
      include: {
        phases: {
          orderBy: { order: "asc" },
        },
      },
    });

    if (!cycle.startAt) {
      throw new SkipPhaseError("Grow cycle has not started yet");
    }

    const today = todayOverride ?? this.formatDateOnly(new Date());
    if (!today) {
      throw new SkipPhaseError("Server could not determine today's date");
    }

    this.recalculatePhaseDates(cycle.phases, cycle.startAt);

    const activeIdx = cycle.phases.findIndex(
      (p) =>
        p.startAt &&
        p.endAt &&
        today >= this.formatDateOnly(p.startAt)! &&
        today < this.formatDateOnly(p.endAt)!,
    );

    if (activeIdx < 0) {
      throw new SkipPhaseError("No active phase to end");
    }

    const active = cycle.phases[activeIdx];
    const elapsed = this.daysBetween(active.startAt!, today);
    active.durationDays = elapsed; // 0 allowed when phase started today

    // Re-cascade with the new duration so every phase gets the canonical dates
    this.recalculatePhaseDates(cycle.phases, cycle.startAt);

    await this.prisma.$transaction([
      // Deactivate every phase in the cycle
      this.prisma.growPhase.updateMany({
        where: { growCycleId: id },
        data: { isActive: false },
      }),
      // Mark the grow cycle as inactive — this frees the controller for the next grow.
      this.prisma.growCycle.update({
        where: { id },
        data: { isActive: false },
      }),
      // Persist every phase's canonicalized startAt/endAt + the active phase's
      // new durationDays.
      ...cycle.phases.map((p) =>
        this.prisma.growPhase.update({
          where: { id: p.id },
          data: {
            durationDays:
              p.id === active.id ? elapsed : p.durationDays,
            startAt: p.startAt,
            endAt: p.endAt,
          },
        }),
      ),
    ]);

    return this.getGrowCycleById(id);
  }

  // Recompute every phase's startAt/endAt from cycle.startAt + cumulative durations.
  // Mutates the passed array in place (matches FE's recalculatePhaseDates).
  private recalculatePhaseDates(
    phases: { startAt: Date | null; endAt: Date | null; durationDays: number }[],
    growStart: Date,
  ): void {
    const cursor = new Date(growStart);
    cursor.setUTCHours(0, 0, 0, 0);
    for (const phase of phases) {
      phase.startAt = new Date(cursor);
      cursor.setUTCDate(cursor.getUTCDate() + phase.durationDays);
      phase.endAt = new Date(cursor);
    }
  }

  // Whole-day difference between two dates (date-only, UTC).
  private daysBetween(from: Date, todayStr: string): number {
    const fromDate = new Date(from);
    fromDate.setUTCHours(0, 0, 0, 0);
    const toDate = new Date(`${todayStr}T00:00:00Z`);
    toDate.setUTCHours(0, 0, 0, 0);
    const diffMs = toDate.getTime() - fromDate.getTime();
    return Math.max(0, Math.floor(diffMs / 86_400_000));
  }
}
