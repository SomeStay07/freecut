import type {
  NativeInferenceCapabilities,
  NativeInferenceHealth,
  NativeInferenceEventTicket,
  NativeInferenceJob,
  NativeInferenceModel,
  NativeTextToImageRequest,
} from './types'

const NATIVE_INFERENCE_BASE_URL = 'http://127.0.0.1:43117'
const TOKEN_STORAGE_KEY = 'freecut-native-inference-token'
const DEFAULT_TIMEOUT_MS = 2000

export class NativeInferenceError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'NativeInferenceError'
  }
}

export class NativeInferenceClient {
  private readonly pairingListeners = new Set<() => void>()

  constructor(
    private readonly baseUrl = NATIVE_INFERENCE_BASE_URL,
    private readonly storage: Pick<
      Storage,
      'getItem' | 'setItem' | 'removeItem'
    > | null = typeof localStorage === 'undefined' ? null : localStorage,
  ) {}

  hasPairingToken(): boolean {
    return Boolean(this.getToken())
  }

  clearPairing(): void {
    const hadPairingToken = this.hasPairingToken()
    this.storage?.removeItem(TOKEN_STORAGE_KEY)
    if (hadPairingToken) this.notifyPairingChange()
  }

  subscribePairingChange(listener: () => void): () => void {
    this.pairingListeners.add(listener)
    return () => this.pairingListeners.delete(listener)
  }

  async health(): Promise<NativeInferenceHealth | null> {
    try {
      return await this.request<NativeInferenceHealth>('/v1/health', {
        authenticated: false,
        timeoutMs: DEFAULT_TIMEOUT_MS,
      })
    } catch {
      return null
    }
  }

  async pair(code: string): Promise<void> {
    const response = await this.request<{ token: string }>('/v1/pair', {
      authenticated: false,
      method: 'POST',
      body: JSON.stringify({ code: code.trim().toUpperCase() }),
    })
    this.storage?.setItem(TOKEN_STORAGE_KEY, response.token)
    this.notifyPairingChange()
  }

  capabilities(): Promise<NativeInferenceCapabilities> {
    return this.request('/v1/capabilities')
  }

  async models(): Promise<NativeInferenceModel[]> {
    const response = await this.request<{ models: NativeInferenceModel[] }>('/v1/models')
    return response.models
  }

  createEventsTicket(): Promise<NativeInferenceEventTicket> {
    return this.request('/v1/events/ticket', { method: 'POST' })
  }

  eventsUrl(ticket: string): string {
    const url = new URL('/v1/events', this.baseUrl)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.searchParams.set('ticket', ticket)
    return url.toString()
  }

  createJob(request: NativeTextToImageRequest): Promise<NativeInferenceJob> {
    return this.request('/v1/jobs', {
      method: 'POST',
      body: JSON.stringify(request),
    })
  }

  getJob(jobId: string): Promise<NativeInferenceJob> {
    return this.request(`/v1/jobs/${encodeURIComponent(jobId)}`)
  }

  cancelJob(jobId: string): Promise<NativeInferenceJob> {
    return this.request(`/v1/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' })
  }

  async getResult(jobId: string): Promise<Blob> {
    return this.requestBlob(`/v1/jobs/${encodeURIComponent(jobId)}/result`)
  }

  async unloadRuntime(): Promise<void> {
    await this.request('/v1/runtime/unload', { method: 'POST' })
  }

  private getToken(): string | null {
    return this.storage?.getItem(TOKEN_STORAGE_KEY) ?? null
  }

  private notifyPairingChange(): void {
    for (const listener of this.pairingListeners) listener()
  }

  private async request<T>(
    path: string,
    options: {
      authenticated?: boolean
      method?: 'GET' | 'POST' | 'DELETE'
      body?: string
      timeoutMs?: number
    } = {},
  ): Promise<T> {
    const response = await this.fetchResponse(path, options)
    return (await response.json()) as T
  }

  private async requestBlob(path: string): Promise<Blob> {
    const response = await this.fetchResponse(path)
    return response.blob()
  }

  private async fetchResponse(
    path: string,
    options: {
      authenticated?: boolean
      method?: 'GET' | 'POST' | 'DELETE'
      body?: string
      timeoutMs?: number
    } = {},
  ): Promise<Response> {
    const authenticated = options.authenticated ?? true
    const token = this.getToken()
    if (authenticated && !token) {
      throw new NativeInferenceError('FreeCut Local is not paired', 401)
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers: createRequestHeaders(options.body, authenticated ? token : null),
      body: options.body,
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
    })
    if (!response.ok) {
      throw new NativeInferenceError(await getResponseErrorMessage(response), response.status)
    }
    return response
  }
}

function createRequestHeaders(body: string | undefined, token: string | null): Headers {
  const headers = new Headers()
  if (body) headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return headers
}

async function getResponseErrorMessage(response: Response): Promise<string> {
  const fallback = `FreeCut Local request failed (${response.status})`
  try {
    const payload = (await response.json()) as { detail?: string }
    return payload.detail || fallback
  } catch {
    return fallback
  }
}

export const nativeInferenceClient = new NativeInferenceClient()
