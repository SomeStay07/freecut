export interface NativeInferenceHealth {
  service: 'freecut-local'
  version: string
  events_version?: number
  ready: boolean
}

export interface NativeInferenceCapabilities {
  backend: 'native'
  accelerator: 'cuda' | 'mps' | 'cpu' | string
  device_name: string
  operations: string[]
}

export interface NativeInferenceModel {
  id: string
  label: string
  operation: string
  estimated_bytes: number
  default_steps: number
}

export type NativeInferenceJobState =
  | 'queued'
  | 'loading'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface NativeInferenceJob {
  id: string
  operation: string
  model: string
  state: NativeInferenceJobState
  progress: number
  message: string
  created_at: number
  updated_at: number
  result_url: string | null
  error: string | null
}

export interface NativeTextToImageRequest {
  operation: 'text-to-image'
  model: string
  prompt: string
  negative_prompt?: string
  width?: number
  height?: number
  steps?: number
  seed?: number
}

export interface NativeInferenceEventTicket {
  ticket: string
  expires_in_seconds: number
}

export interface NativeInferenceVramTelemetry {
  accelerator: string
  deviceName: string
  vramUsedBytes: number | null
  vramReservedBytes: number | null
  vramTotalBytes: number | null
}

export interface NativeInferenceEvent<T = unknown> {
  version: 1
  sequence: number
  type: string
  timestamp: number
  jobId: string | null
  payload: T
}

export type NativeInferenceConnectionState = 'checking' | 'offline' | 'unpaired' | 'connected'

export interface NativeInferenceConnectionSnapshot {
  state: NativeInferenceConnectionState
  eventChannel: 'disconnected' | 'connecting' | 'connected'
  health: NativeInferenceHealth | null
  capabilities: NativeInferenceCapabilities | null
  models: NativeInferenceModel[]
  vram: NativeInferenceVramTelemetry | null
  lastSequence: number
}
