// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { NativeInferenceClient } from './client'
import { NativeInferenceConnection } from './connection'
import type { NativeInferenceEvent, NativeInferenceJob } from './types'

class FakeWebSocket extends EventTarget {
  static instances: FakeWebSocket[] = []

  constructor(readonly url: string) {
    super()
    FakeWebSocket.instances.push(this)
  }

  open(): void {
    this.dispatchEvent(new Event('open'))
  }

  message(event: NativeInferenceEvent): void {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(event) }))
  }

  close(): void {
    this.dispatchEvent(new Event('close'))
  }
}

class FakeClient {
  online = true
  paired = true
  readonly getJob = vi.fn<() => Promise<NativeInferenceJob>>()

  health = vi.fn(async () =>
    this.online
      ? { service: 'freecut-local' as const, version: '0.1.0', events_version: 1, ready: true }
      : null,
  )

  hasPairingToken(): boolean {
    return this.paired
  }

  capabilities = vi.fn(async () => ({
    backend: 'native' as const,
    accelerator: 'cuda',
    device_name: 'Test GPU',
    operations: ['text-to-image'],
  }))

  models = vi.fn(async () => [
    {
      id: 'sd-turbo',
      label: 'Stable Diffusion Turbo',
      operation: 'text-to-image',
      estimated_bytes: 1,
      default_steps: 2,
    },
  ])

  createEventsTicket = vi.fn(async () => ({ ticket: 'one-time-ticket', expires_in_seconds: 30 }))

  eventsUrl(ticket: string): string {
    return `ws://127.0.0.1/events?ticket=${ticket}`
  }

  subscribePairingChange(): () => void {
    return () => undefined
  }

  clearPairing(): void {
    this.paired = false
  }

  cancelJob = vi.fn(async () => createJob('cancelled'))
}

function createJob(state: NativeInferenceJob['state']): NativeInferenceJob {
  return {
    id: 'job-1',
    operation: 'text-to-image',
    model: 'sd-turbo',
    state,
    progress: state === 'completed' ? 1 : 0.5,
    message: state,
    created_at: 1,
    updated_at: 2,
    result_url: state === 'completed' ? '/result' : null,
    error: null,
  }
}

function event(type: string, sequence: number, payload: object): NativeInferenceEvent {
  return {
    version: 1,
    sequence,
    type,
    timestamp: Date.now(),
    jobId: type.startsWith('job.') ? 'job-1' : null,
    payload,
  }
}

describe('NativeInferenceConnection', () => {
  afterEach(() => {
    FakeWebSocket.instances = []
    vi.unstubAllGlobals()
    vi.clearAllTimers()
  })

  it('shares health, websocket telemetry, and job events', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const client = new FakeClient()
    const connection = new NativeInferenceConnection(client as unknown as NativeInferenceClient)
    const unsubscribe = connection.subscribe(vi.fn())

    await vi.waitFor(() => expect(connection.getSnapshot().state).toBe('connected'))
    const socket = FakeWebSocket.instances[0]
    expect(socket?.url).toContain('one-time-ticket')
    socket?.open()
    socket?.message(
      event('runtime.vram_updated', 1, {
        accelerator: 'cuda',
        deviceName: 'Test GPU',
        vramUsedBytes: 4,
        vramReservedBytes: 5,
        vramTotalBytes: 8,
      }),
    )

    expect(connection.getSnapshot()).toMatchObject({
      eventChannel: 'connected',
      lastSequence: 1,
      vram: { vramUsedBytes: 4, vramTotalBytes: 8 },
    })

    const completed = createJob('completed')
    const waiting = connection.waitForJob(createJob('running'), {
      isCancelled: () => false,
      cancellationMessage: 'cancelled',
      onUpdate: vi.fn(),
    })
    socket?.message(event('job.completed', 2, completed))
    await expect(waiting).resolves.toEqual(completed)
    expect(client.getJob).not.toHaveBeenCalled()

    client.online = false
    await connection.checkNow()
    expect(connection.getSnapshot().state).toBe('connected')
    await connection.checkNow()
    expect(connection.getSnapshot().state).toBe('offline')
    unsubscribe()
  })
})
