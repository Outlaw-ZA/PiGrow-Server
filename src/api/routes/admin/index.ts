import { FastifyPluginCallback } from 'fastify'

export const routes: FastifyPluginCallback = (fastify, opts, next) => {
  
  fastify.get('/admin', async (request, reply) => {
    // You can either use reply.send() or simply return the object 
    // since this is an async function.
    return {
      success: true,
      data: "Test"
    }
  })

  next()
}