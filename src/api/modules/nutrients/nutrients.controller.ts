import type { PrismaClient } from '../../../generated/client/client.js'
import type { CreateNutrientPayload, UpdateNutrientPayload } from './nutrients.schema.js'

export class NutrientsError extends Error {
  constructor(
    message: string,
    readonly statusCode: 404 | 409,
    readonly referencing?: number,
  ) {
    super(message)
    this.name = 'NutrientsError'
  }
}

export class NutrientsController {
  constructor(private readonly prisma: PrismaClient) {}

  async list() {
    return await this.prisma.nutrient.findMany({ orderBy: { createdAt: 'asc' } })
  }

  async create(payload: CreateNutrientPayload) {
    const brand = payload.brand ?? null
    const existing = await this.prisma.nutrient.findFirst({
      select: { id: true },
      where: { brand, name: payload.name },
    })
    if (existing) {
      return { error: 'NUTRIENT_CONFLICT' as const, existingId: existing.id }
    }

    return await this.prisma.nutrient.create({
      data: { brand, name: payload.name, notes: payload.notes ?? null },
    })
  }

  async update(id: string, payload: UpdateNutrientPayload) {
    const existing = await this.prisma.nutrient.findUnique({ where: { id } })
    if (!existing) {
      throw new NutrientsError('Nutrient not found', 404)
    }
    return await this.prisma.nutrient.update({ data: payload, where: { id } })
  }

  async remove(id: string) {
    const existing = await this.prisma.nutrient.findUnique({ where: { id } })
    if (!existing) {
      throw new NutrientsError('Nutrient not found', 404)
    }
    const referencing = await this.prisma.phaseNutrient.count({ where: { nutrientId: id } })
    if (referencing > 0) {
      throw new NutrientsError('Nutrient is referenced by phase nutrients', 409, referencing)
    }
    await this.prisma.nutrient.delete({ where: { id } })
  }
}
