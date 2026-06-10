import { FastifyInstance } from "fastify";
import { CycleType } from "../../../generated/client/enums.js";
import { prisma } from "../../../prisma.js";

// --- TypeScript Interfaces for Request Validation ---

interface IdParam {
  id: string;
}

interface CreateCycleBody {
  name: string;
  description: string;
  type: CycleType;
  start_date: string | Date; // Accepts ISO string from JSON, Prisma handles conversion
  end_date: string | Date;
  plant_type: string;
}

// Partial allows all fields to be optional for updates
type UpdateCycleBody = Partial<CreateCycleBody>;

// --- Fastify Routes ---

export default async function routes(fastify: FastifyInstance) {
  /**
   * 1. READ (Get a single cycle by ID)
   * GET /cycle/:id
   */
  fastify.get<{ Params: IdParam }>("/cycle/:id", async (request, reply) => {
    const { id } = request.params;

    const cycle = await prisma.cycles.findUnique({
      where: { id },
    });

    if (!cycle) {
      return reply
        .code(404)
        .send({ success: false, message: "Cycle not found" });
    }

    return { success: true, data: cycle };
  });

  /**
   * 2. CREATE
   * POST /cycle
   */
  fastify.post<{ Body: CreateCycleBody }>("/cycle", async (request, reply) => {
    const { name, description, type, start_date, end_date, plant_type } =
      request.body;

    const newCycle = await prisma.cycles.create({
      data: {
        name,
        description,
        type,
        start_date: new Date(start_date),
        end_date: new Date(end_date),
        plant_type,
      },
    });

    return reply.code(201).send({ success: true, data: newCycle });
  });

  /**
   * 3. UPDATE
   * PUT /cycle/:id
   */
  fastify.put<{ Params: IdParam; Body: UpdateCycleBody }>(
    "/cycle/:id",
    async (request, reply) => {
      const { id } = request.params;
      const { name, description, type, start_date, end_date, plant_type } =
        request.body;

      // Build update object dynamically to avoid overriding with undefined
      const updateData: any = {};
      if (name) updateData.name = name;
      if (description) updateData.description = description;
      if (type) updateData.type = type;
      if (start_date) updateData.start_date = new Date(start_date);
      if (end_date) updateData.end_date = new Date(end_date);
      if (plant_type) updateData.plant_type = plant_type;

      try {
        const updatedCycle = await prisma.cycles.update({
          where: { id },
          data: updateData,
        });

        return { success: true, data: updatedCycle };
      } catch (error) {
        // Prisma throws an error if the record to update doesn't exist
        return reply.code(404).send({
          success: false,
          message: "Cycle not found or update failed",
        });
      }
    },
  );

  /**
   * 4. DELETE
   * DELETE /cycle/:id
   */
  fastify.delete<{ Params: IdParam }>("/cycle/:id", async (request, reply) => {
    const { id } = request.params;

    try {
      await prisma.cycles.delete({
        where: { id },
      });

      return { success: true, message: "Cycle deleted successfully" };
    } catch (error) {
      return reply
        .code(404)
        .send({ success: false, message: "Cycle not found" });
    }
  });
}
