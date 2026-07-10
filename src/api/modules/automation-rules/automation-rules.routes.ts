import type { FastifyInstance } from 'fastify'
import { Type } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { AutomationRulesController, AutomationRulesError } from './automation-rules.controller.js'
import {
  AutomationRuleArrayResponseSchema,
  AutomationRuleDeviceParamsSchema,
  AutomationRuleGrowCycleParamsSchema,
  AutomationRuleGrowPhaseParamsSchema,
  AutomationRuleIdParamsSchema,
  AutomationRuleResponseSchema,
  AutomationRuleToggleResponseSchema,
  CreateAutomationRuleSchema,
  ErrorSchema,
  UpdateAutomationRuleSchema,
} from './automation-rules.schema.js'
import { cast } from '../../shared/cast.js'

export default async function automationRuleRoutes(server: FastifyInstance) {
  const router = server.withTypeProvider<TypeBoxTypeProvider>()
  const controller = new AutomationRulesController(server)

  // 1. LIST by grow cycle
  router.get(
    '/api/automation-rules/grow-cycle/:growCycleId',
    {
      schema: {
        params: AutomationRuleGrowCycleParamsSchema,
        response: { 200: AutomationRuleArrayResponseSchema, 400: ErrorSchema },
        summary: 'List cycle-scoped automation rules',
        tags: ['AutomationRules'],
      },
    },
    async (request, reply) => {
      try {
        return cast<typeof AutomationRuleArrayResponseSchema.static>(
          await controller.getByGrowCycleId(request.params.growCycleId),
        )
      } catch {
        return reply.code(400).send({ error: 'Failed to load automation rules' })
      }
    },
  )

  // 2. LIST by grow phase
  router.get(
    '/api/automation-rules/grow-phase/:growPhaseId',
    {
      schema: {
        params: AutomationRuleGrowPhaseParamsSchema,
        response: { 200: AutomationRuleArrayResponseSchema, 400: ErrorSchema },
        summary: 'List phase-scoped automation rules',
        tags: ['AutomationRules'],
      },
    },
    async (request, reply) => {
      try {
        return cast<typeof AutomationRuleArrayResponseSchema.static>(
          await controller.getByGrowPhaseId(request.params.growPhaseId),
        )
      } catch {
        return reply.code(400).send({ error: 'Failed to load automation rules' })
      }
    },
  )

  // 3. LIST by device
  router.get(
    '/api/automation-rules/device/:deviceId',
    {
      schema: {
        params: AutomationRuleDeviceParamsSchema,
        response: { 200: AutomationRuleArrayResponseSchema, 400: ErrorSchema },
        summary: 'List automation rules attached to a device',
        tags: ['AutomationRules'],
      },
    },
    async (request, reply) => {
      try {
        return cast<typeof AutomationRuleArrayResponseSchema.static>(
          await controller.getByDeviceId(request.params.deviceId),
        )
      } catch {
        return reply.code(400).send({ error: 'Failed to load automation rules' })
      }
    },
  )

  // 4. CREATE
  router.post(
    '/api/automation-rules',
    {
      schema: {
        body: CreateAutomationRuleSchema,
        description:
          'A rule is scoped to exactly one of `growPhaseId` (preferred) or `growCycleId`. SCHEDULE_ON / SCHEDULE_OFF conditions are rejected at the controller.',
        response: {
          201: AutomationRuleResponseSchema,
          400: ErrorSchema,
        },
        summary: 'Create an automation rule',
        tags: ['AutomationRules'],
      },
    },
    async (request, reply) => {
      try {
        const rule = await controller.create(request.body)
        return reply.code(201).send(cast<typeof AutomationRuleResponseSchema.static>(rule))
      } catch (error) {
        if (error instanceof AutomationRulesError) {
          return reply.code(error.statusCode as 400).send({ error: error.message })
        }
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code: string }).code === 'P2003'
        ) {
          return reply
            .code(400)
            .send({ error: 'growCycleId, growPhaseId, or deviceId does not exist' })
        }
        server.log.error(error)
        return reply.code(400).send({ error: 'Failed to create automation rule' })
      }
    },
  )

  // 5. UPDATE
  router.put(
    '/api/automation-rules/:id',
    {
      schema: {
        body: UpdateAutomationRuleSchema,
        params: AutomationRuleIdParamsSchema,
        response: {
          200: AutomationRuleResponseSchema,
          400: ErrorSchema,
          404: ErrorSchema,
        },
        summary: 'Update an automation rule',
        tags: ['AutomationRules'],
      },
    },
    async (request, reply) => {
      try {
        return cast<typeof AutomationRuleResponseSchema.static>(
          await controller.update(request.params.id, request.body),
        )
      } catch (error) {
        if (error instanceof AutomationRulesError) {
          return reply.code(error.statusCode as 400).send({ error: error.message })
        }
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code: string }).code === 'P2025'
        ) {
          return reply.code(404).send({ error: 'Automation rule not found' })
        }
        server.log.error(error)
        return reply.code(400).send({ error: 'Failed to update automation rule' })
      }
    },
  )

  // 6. TOGGLE enabled
  router.patch(
    '/api/automation-rules/:id/toggle',
    {
      schema: {
        params: AutomationRuleIdParamsSchema,
        response: {
          200: AutomationRuleToggleResponseSchema,
          400: ErrorSchema,
          404: ErrorSchema,
        },
        summary: "Toggle an automation rule's enabled flag",
        tags: ['AutomationRules'],
      },
    },
    async (request, reply) => {
      try {
        return cast<typeof AutomationRuleToggleResponseSchema.static>(
          await controller.toggle(request.params.id),
        )
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code: string }).code === 'P2025'
        ) {
          return reply.code(404).send({ error: 'Automation rule not found' })
        }
        return reply.code(400).send({ error: 'Failed to toggle automation rule' })
      }
    },
  )

  // 7. DELETE
  router.delete(
    '/api/automation-rules/:id',
    {
      schema: {
        params: AutomationRuleIdParamsSchema,
        response: {
          204: Type.Null({ description: 'Automation rule deleted (no content)' }),
          400: ErrorSchema,
          404: ErrorSchema,
        },
        summary: 'Delete an automation rule',
        tags: ['AutomationRules'],
      },
    },
    async (request, reply) => {
      try {
        await controller.remove(request.params.id)
        return reply.code(204).send(null)
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code: string }).code === 'P2025'
        ) {
          return reply.code(404).send({ error: 'Automation rule not found' })
        }
        return reply.code(400).send({ error: 'Failed to delete automation rule' })
      }
    },
  )
}
