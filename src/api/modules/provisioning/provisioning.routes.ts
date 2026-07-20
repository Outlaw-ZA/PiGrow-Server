import type { FastifyInstance } from 'fastify'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { discoveryService } from '../../../services/DiscoveryService.js'
import { ProvisioningController, ProvisioningError } from './provisioning.controller.js'
import {
  ClaimBodySchema,
  ClaimResponseSchema,
  ErrorSchema,
  ScanResponseSchema,
} from './provisioning.schema.js'
import { cast } from '../../shared/cast.js'

export default async function provisioningRoutes(server: FastifyInstance) {
  const router = server.withTypeProvider<TypeBoxTypeProvider>()
  const controller = new ProvisioningController(server)

  router.get(
    '/api/controllers/scan',
    {
      schema: {
        response: { 200: ScanResponseSchema },
        summary: 'Scan for unclaimed controllers',
        tags: ['Controllers'],
      },
    },
    async () =>
      cast<typeof ScanResponseSchema.static>({
        controllers: discoveryService.getAll(),
      }),
  )

  router.post(
    '/api/controllers/claim',
    {
      schema: {
        body: ClaimBodySchema,
        response: {
          200: ClaimResponseSchema,
          201: ClaimResponseSchema,
          400: ErrorSchema,
          401: ErrorSchema,
          404: ErrorSchema,
        },
        summary: 'Claim and provision a discovered controller',
        tags: ['Controllers'],
      },
    },
    async (request, reply) => {
      try {
        const result = await controller.claim(request.body)
        const statusCode = result.created ? 201 : 200
        return reply
          .code(statusCode)
          .send(cast<typeof ClaimResponseSchema.static>({ controller: result.controller }))
      } catch (error) {
        if (error instanceof ProvisioningError) {
          return reply.code(error.statusCode).send({ error: error.message })
        }
        server.log.error(error)
        return reply.code(400).send({ error: 'Failed to provision controller' })
      }
    },
  )
}
