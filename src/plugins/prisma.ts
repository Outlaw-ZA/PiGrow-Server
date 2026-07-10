import fp from 'fastify-plugin'
import type { FastifyPluginAsync } from 'fastify'
import pg from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/client/client.js'

// 1. Extend the FastifyInstance interface to declare the global .prisma property
declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient
  }
}

const prismaPlugin: FastifyPluginAsync = fp(async (server) => {
  // 2. Initialize a standard PostgreSQL connection pool using node-postgres
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
  })

  // 3. Bind the pool to Prisma 7's required PostgreSQL driver adapter
  const adapter = new PrismaPg(pool)

  // 4. Instantiate the Prisma Client EXACTLY ONCE with the adapter object
  const prisma = new PrismaClient({ adapter })

  // 5. Open the connection pool
  await prisma.$connect()

  // 6. Decorate the server instance so routes can access it via server.prisma
  server.decorate('prisma', prisma)

  // 7. Gracefully disconnect Prisma and clean up connection pools on shutdown
  server.addHook('onClose', async (instance) => {
    await instance.prisma.$disconnect()
    await pool.end()
  })
})

export default prismaPlugin
