import { FastifyInstance } from "fastify";

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

  // 3. CREATE (Fetches hardware devices, then generates phases and rules dynamically)
  async createGrowCycle(body: {
    name: string;
    controllerId: string;
    isActive?: boolean;
  }) {
    // 1. Fetch the physical hardware channels already assigned to this Pi
    const controllerDevices = await this.prisma.device.findMany({
      where: { controllerId: body.controllerId, isActive: true },
    });

    // Helper to find a specific device type on this controller
    const findDevice = (type: string) =>
      controllerDevices.find((d) => d.type === type);

    const lightDevice = findDevice("LIGHT");
    const exhaustFan = findDevice("EXHAUST_FAN");
    const pumpDevice = findDevice("WATER_PUMP");

    // 2. Build the phase structures inline, embedding dynamic device config targets
    const defaultPhasesBlueprint = [
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
              : []), // Drops to 12/12 cycle
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
              : []), // Kill pumps for final flush dry-down
          ],
        },
      },
    ];

    // 3. Execute the single unified atomic transaction in Postgres
    const created = await this.prisma.growCycle.create({
      data: {
        name: body.name,
        controllerId: body.controllerId,
        isActive: body.isActive ?? false,
        phases: {
          create: defaultPhasesBlueprint,
        },
      },
      include: {
        phases: {
          orderBy: { order: "asc" },
          include: {
            deviceConfigs: {
              include: { device: true },
            },
          },
        },
      },
    });
    created.phases = this.serializePhaseDates(created.phases);
    return this.serializeStartAt(created);
  }

  // 4. UPDATE
  async updateGrowCycle(
    id: string,
    body: {
      name?: string;
      controllerId?: string;
      isActive?: boolean;
      startAt?: string;
    },
  ) {
    const { startAt, ...rest } = body;

    const updated = await this.prisma.growCycle.update({
      where: { id },
      data: {
        ...rest,
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
}
