import { NativeInferenceError, NativeInferenceClient, nativeInferenceClient } from './client'
import type {
  NativeInferenceConnectionSnapshot,
  NativeInferenceEvent,
  NativeInferenceJob,
  NativeInferenceVramTelemetry,
} from './types'

const ONLINE_CHECK_INTERVAL_MS = 5_000
const OFFLINE_CHECK_INTERVAL_MS = 3_000
const JOB_POLL_FALLBACK_MS = 3_000
const MAX_RECONNECT_DELAY_MS = 15_000

type SnapshotListener = () => void
type EventListener = (event: NativeInferenceEvent) => void

interface WaitForJobOptions {
  isCancelled: () => boolean
  cancellationMessage: string
  onUpdate: (job: NativeInferenceJob) => void
}

const INITIAL_SNAPSHOT: NativeInferenceConnectionSnapshot = {
  state: 'checking',
  eventChannel: 'disconnected',
  health: null,
  capabilities: null,
  models: [],
  vram: null,
  lastSequence: 0,
}

export class NativeInferenceConnection {
  private snapshot = INITIAL_SNAPSHOT
  private readonly snapshotListeners = new Set<SnapshotListener>()
  private readonly eventListeners = new Set<EventListener>()
  private checkTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private checkPromise: Promise<void> | null = null
  private socket: WebSocket | null = null
  private started = false
  private consecutiveFailures = 0
  private reconnectAttempts = 0

  constructor(private readonly client: NativeInferenceClient = nativeInferenceClient) {}

  getSnapshot = (): NativeInferenceConnectionSnapshot => this.snapshot

  subscribe = (listener: SnapshotListener): (() => void) => {
    this.snapshotListeners.add(listener)
    this.startMonitoring()
    return () => this.snapshotListeners.delete(listener)
  }

  subscribeEvents = (listener: EventListener): (() => void) => {
    this.eventListeners.add(listener)
    this.startMonitoring()
    return () => this.eventListeners.delete(listener)
  }

  checkNow = async (): Promise<void> => {
    if (this.checkPromise) return this.checkPromise
    this.checkPromise = this.inspect().finally(() => {
      this.checkPromise = null
    })
    return this.checkPromise
  }

  startMonitoring(): void {
    if (this.started || typeof window === 'undefined') return
    this.started = true
    this.client.subscribePairingChange(() => void this.checkNow())
    window.addEventListener('focus', this.handleForeground)
    document.addEventListener('visibilitychange', this.handleForeground)
    void this.checkNow()
  }

  async waitForJob(
    initialJob: NativeInferenceJob,
    options: WaitForJobOptions,
  ): Promise<NativeInferenceJob> {
    let latestJob = initialJob
    let queuedEvent: NativeInferenceJob | null = null
    let resolveEvent: ((job: NativeInferenceJob) => void) | null = null
    const unsubscribe = this.subscribeEvents((event) => {
      if (event.jobId !== initialJob.id || !event.type.startsWith('job.')) return
      const job = event.payload as unknown as NativeInferenceJob
      if (resolveEvent) {
        const resolve = resolveEvent
        resolveEvent = null
        resolve(job)
      } else {
        queuedEvent = job
      }
    })

    try {
      while (!isTerminalJob(latestJob)) {
        if (options.isCancelled()) {
          await this.client.cancelJob(initialJob.id)
          throw new Error(options.cancellationMessage)
        }

        let nextJob: NativeInferenceJob | null = queuedEvent
        queuedEvent = null
        if (!nextJob) {
          nextJob = await waitForJobEvent(JOB_POLL_FALLBACK_MS, (resolve) => {
            if (queuedEvent) {
              const pendingJob = queuedEvent
              queuedEvent = null
              resolve(pendingJob)
              return
            }
            resolveEvent = resolve
          })
          resolveEvent = null
        }
        latestJob = nextJob ?? (await this.client.getJob(initialJob.id))
        options.onUpdate(latestJob)
      }
      return latestJob
    } finally {
      resolveEvent = null
      unsubscribe()
    }
  }

  private readonly handleForeground = (): void => {
    if (document.visibilityState === 'visible') void this.checkNow()
  }

  private async inspect(): Promise<void> {
    this.clearCheckTimer()
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      this.scheduleCheck(ONLINE_CHECK_INTERVAL_MS)
      return
    }

    const health = await this.client.health()
    if (!health?.ready) {
      this.handleHealthFailure()
      return
    }

    this.consecutiveFailures = 0
    if (!this.client.hasPairingToken()) {
      this.handleUnpaired(health)
      return
    }

    await this.inspectPaired(health)
  }

  private handleHealthFailure(): void {
    this.consecutiveFailures += 1
    if (this.consecutiveFailures >= 2 || this.snapshot.state === 'checking') {
      this.closeSocket()
      this.setSnapshot({
        ...INITIAL_SNAPSHOT,
        state: 'offline',
      })
    }
    this.scheduleCheck(OFFLINE_CHECK_INTERVAL_MS)
  }

  private handleUnpaired(health: NativeInferenceConnectionSnapshot['health']): void {
    this.closeSocket()
    this.setSnapshot({ ...INITIAL_SNAPSHOT, state: 'unpaired', health })
    this.scheduleCheck(OFFLINE_CHECK_INTERVAL_MS)
  }

  private async inspectPaired(
    health: NonNullable<NativeInferenceConnectionSnapshot['health']>,
  ): Promise<void> {
    try {
      const [capabilities, models] = await Promise.all([
        this.client.capabilities(),
        this.client.models(),
      ])
      this.setSnapshot({
        ...this.snapshot,
        state: 'connected',
        health,
        capabilities,
        models,
      })
      void this.ensureEventChannel()
      this.scheduleCheck(ONLINE_CHECK_INTERVAL_MS)
    } catch (error) {
      if (error instanceof NativeInferenceError && error.status === 401) {
        this.client.clearPairing()
        return
      }
      this.closeSocket()
      this.setSnapshot({ ...INITIAL_SNAPSHOT, state: 'offline' })
      this.scheduleCheck(OFFLINE_CHECK_INTERVAL_MS)
    }
  }

  private async ensureEventChannel(): Promise<void> {
    if (typeof WebSocket === 'undefined' || this.socket || this.snapshot.state !== 'connected') {
      return
    }
    this.setSnapshot({ ...this.snapshot, eventChannel: 'connecting' })
    try {
      const { ticket } = await this.client.createEventsTicket()
      const socket = new WebSocket(this.client.eventsUrl(ticket))
      this.socket = socket
      socket.addEventListener('open', () => {
        this.reconnectAttempts = 0
        this.setSnapshot({ ...this.snapshot, eventChannel: 'connected' })
      })
      socket.addEventListener('message', (message) => this.handleEventMessage(message.data))
      socket.addEventListener('close', () => this.handleSocketClose(socket))
      socket.addEventListener('error', () => socket.close())
    } catch {
      this.setSnapshot({ ...this.snapshot, eventChannel: 'disconnected' })
      this.scheduleReconnect()
    }
  }

  private handleEventMessage(data: unknown): void {
    if (typeof data !== 'string') return
    try {
      const event = JSON.parse(data) as NativeInferenceEvent
      if (event.version !== 1 || event.sequence <= this.snapshot.lastSequence) return
      if (this.snapshot.lastSequence > 0 && event.sequence > this.snapshot.lastSequence + 1) {
        void this.checkNow()
      }
      const vram =
        event.type === 'runtime.vram_updated'
          ? (event.payload as unknown as NativeInferenceVramTelemetry)
          : this.snapshot.vram
      this.setSnapshot({ ...this.snapshot, lastSequence: event.sequence, vram })
      for (const listener of this.eventListeners) listener(event)
    } catch {
      // Ignore malformed companion events; HTTP resync remains authoritative.
    }
  }

  private handleSocketClose(socket: WebSocket): void {
    if (this.socket !== socket) return
    this.socket = null
    this.setSnapshot({ ...this.snapshot, eventChannel: 'disconnected' })
    void this.checkNow()
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.snapshot.state !== 'connected') return
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, MAX_RECONNECT_DELAY_MS)
    this.reconnectAttempts += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.ensureEventChannel()
    }, delay)
  }

  private closeSocket(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    const socket = this.socket
    this.socket = null
    socket?.close()
  }

  private scheduleCheck(delay: number): void {
    this.clearCheckTimer()
    this.checkTimer = setTimeout(() => void this.checkNow(), delay)
  }

  private clearCheckTimer(): void {
    if (this.checkTimer) clearTimeout(this.checkTimer)
    this.checkTimer = null
  }

  private setSnapshot(snapshot: NativeInferenceConnectionSnapshot): void {
    this.snapshot = snapshot
    for (const listener of this.snapshotListeners) listener()
  }
}

function isTerminalJob(job: NativeInferenceJob): boolean {
  return ['completed', 'failed', 'cancelled'].includes(job.state)
}

function waitForJobEvent(
  timeoutMs: number,
  register: (resolve: (job: NativeInferenceJob) => void) => void,
): Promise<NativeInferenceJob | null> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (job: NativeInferenceJob | null) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(job)
    }
    const timeout = setTimeout(() => finish(null), timeoutMs)
    register((job) => finish(job))
  })
}

export const nativeInferenceConnection = new NativeInferenceConnection()
