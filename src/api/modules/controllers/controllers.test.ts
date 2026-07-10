import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestApp, teardownTestApp } from '../test-helper.js'

describe('Controllers API Feature Module', () => {
  let app: any
  let prismaClient: any

  before(async () => {
    const { server, prisma } = await createTestApp()
    app = server
    prismaClient = prisma
  })

  after(async () => {
    // Clean up test records using the exact hardware mac footprint
    await prismaClient.controller.deleteMany({
      where: { macAddress: 'b8:27:eb:bf:d3:42' },
    })
    await teardownTestApp(app)
  })

  test('POST /controller - Should register a new Raspberry Pi hardware hub', async () => {
    const response = await app.inject({
      method: 'POST',
      payload: {
        ipAddress: '192.168.1.100',
        macAddress: 'b8:27:eb:bf:d3:42',
        name: 'Main Research Tent Pi Layer',
      },
      url: '/api/controllers',
    })

    const body = JSON.parse(response.body)

    assert.equal(response.statusCode, 201)
    assert.equal(body.macAddress, 'b8:27:eb:bf:d3:42')
    assert.equal(body.status, 'OFFLINE') // Base status default validation
    assert.equal(body.ipAddress, '192.168.1.100')
    assert.ok(body.id, 'Expected controller to return a generated database UUID')
  })

  test('GET /controllers - Should return list of all active hubs', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/controllers',
    })

    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 200)
    assert.ok(Array.isArray(body), 'Expected response endpoint to return index collection')
  })
})
