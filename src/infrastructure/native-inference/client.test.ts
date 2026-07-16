// @vitest-environment node

import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vite-plus/test'
import { NativeInferenceClient, NativeInferenceError } from './client'

class MemoryStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

describe('NativeInferenceClient', () => {
  let server: Server
  let baseUrl: string

  beforeAll(async () => {
    server = createServer((request, response) => {
      response.setHeader('Content-Type', 'application/json')
      if (request.url === '/v1/health') {
        response.end(JSON.stringify({ service: 'freecut-local', version: '0.1.0', ready: true }))
        return
      }
      if (request.url === '/v1/pair' && request.method === 'POST') {
        let body = ''
        request.on('data', (chunk) => {
          body += String(chunk)
        })
        request.on('end', () => {
          const payload = JSON.parse(body) as { code: string }
          if (payload.code !== 'ABC123') {
            response.statusCode = 403
            response.end(JSON.stringify({ detail: 'Invalid pairing code' }))
            return
          }
          response.end(JSON.stringify({ token: 'paired-token' }))
        })
        return
      }
      if (request.url === '/v1/capabilities') {
        if (request.headers.authorization !== 'Bearer paired-token') {
          response.statusCode = 401
          response.end(JSON.stringify({ detail: 'Unauthorized' }))
          return
        }
        response.end(
          JSON.stringify({
            backend: 'native',
            accelerator: 'cuda',
            device_name: 'Test GPU',
            operations: ['text-to-image'],
          }),
        )
        return
      }
      if (request.url === '/v1/events/ticket' && request.method === 'POST') {
        if (request.headers.authorization !== 'Bearer paired-token') {
          response.statusCode = 401
          response.end(JSON.stringify({ detail: 'Unauthorized' }))
          return
        }
        response.end(JSON.stringify({ ticket: 'event-ticket', expires_in_seconds: 30 }))
        return
      }
      response.statusCode = 404
      response.end(JSON.stringify({ detail: 'Not found' }))
    })
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server did not bind')
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  })

  it('pairs once and authenticates subsequent companion requests', async () => {
    const storage = new MemoryStorage()
    const client = new NativeInferenceClient(baseUrl, storage)
    const pairingChanged = vi.fn()
    const unsubscribe = client.subscribePairingChange(pairingChanged)

    await expect(client.health()).resolves.toMatchObject({ ready: true })
    await expect(client.capabilities()).rejects.toMatchObject({ status: 401 })

    await client.pair('abc123')

    expect(client.hasPairingToken()).toBe(true)
    expect(pairingChanged).toHaveBeenCalledTimes(1)
    await expect(client.capabilities()).resolves.toMatchObject({
      backend: 'native',
      accelerator: 'cuda',
      device_name: 'Test GPU',
    })
    await expect(client.createEventsTicket()).resolves.toEqual({
      ticket: 'event-ticket',
      expires_in_seconds: 30,
    })
    expect(client.eventsUrl('event-ticket')).toMatch(/^ws:\/\/127\.0\.0\.1:.+ticket=event-ticket$/)

    client.clearPairing()
    expect(pairingChanged).toHaveBeenCalledTimes(2)
    unsubscribe()
    client.clearPairing()
    expect(pairingChanged).toHaveBeenCalledTimes(2)
  })

  it('preserves the service error when pairing is rejected', async () => {
    const client = new NativeInferenceClient(baseUrl, new MemoryStorage())

    await expect(client.pair('wrong1')).rejects.toEqual(
      expect.objectContaining<Partial<NativeInferenceError>>({
        message: 'Invalid pairing code',
        status: 403,
      }),
    )
  })
})
