// 1. CHANGE THIS IMPORT: Point directly to your schema output path instead of @prisma/client
import { PrismaClient } from './generated/client/client.js'

import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is missing!')
}

const pool = new pg.Pool({ connectionString })
const adapter = new PrismaPg(pool)

// Instantiate your client using the local module types
export const prisma = new PrismaClient({ adapter })

// Exposed so tests can shut down the underlying pg pool. Prisma's
// `$disconnect()` releases the Prisma client but does not drain the pool,
// Which leaves an idle connection that prevents the test process from
// Exiting within node:test's default 30s grace window.
export const pgPool = pool

export async function closeDatabase(): Promise<void> {
  try {
    await prisma.$disconnect()
  } catch {
    // Ignore — best effort
  }
  try {
    await pool.end()
  } catch {
    // Ignore — best effort
  }
}
