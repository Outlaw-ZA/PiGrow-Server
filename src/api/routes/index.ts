import { join } from 'path'
import { readdir, stat } from 'fs/promises'
import { FastifyPluginAsync, FastifyPluginCallback } from 'fastify'

/**
 * Scans a directory and returns an array of folder names.
 */
const getAllRouteDirectories = async (path: string): Promise<string[]> => {
  let dirs: string[] = []
  for (const file of await readdir(path)) {
    if ((await stat(join(path, file))).isDirectory()) {
      dirs = [...dirs, file]
    }
  }
  return dirs
}

/**
 * Main route setup plugin. 
 * Using FastifyPluginCallback if you use the 'next' parameter, 
 * or FastifyPluginAsync if you prefer async/await without 'next'.
 */
export const setupRoutes: FastifyPluginCallback = (fastify, options, next) => {
  
  fastify.get('/', async (request, reply) => {
    return { root: true }
  })

  // We wrap the dynamic loading in an async block since setupRoutes is a callback
  const loadRoutes = async () => {
    const routesPath = `${process.env.APP_ROOT}/src/api/routes`
    const routes = await getAllRouteDirectories(routesPath)

    for (const route of routes) {
      // Dynamic import type: asserting the expected shape of the module
      const routeModule = await import(`./${route}`) as { routes: FastifyPluginAsync }
      fastify.register(routeModule.routes)
    }
  }

  loadRoutes()
    .then(() => {
      fastify.setNotFoundHandler((request, reply) => {
        reply.code(404).send({ 
          success: false, 
          error: { name: 'NotFound', message: 'Not Found' } 
        })
      })
      next()
    })
    .catch(err => next(err))
}