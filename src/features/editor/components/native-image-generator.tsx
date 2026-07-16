import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, ImagePlus, Loader2, Save, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  nativeInferenceConnection,
  nativeInferenceClient,
  type NativeInferenceJob,
  type NativeInferenceModel,
} from '@/infrastructure/native-inference'
import { createLogger } from '@/shared/logging/logger'
import {
  localInferenceRuntimeRegistry,
  LOCAL_INFERENCE_UNLOADED_MESSAGE,
} from '@/shared/state/local-inference'
import {
  importMediaLibraryService,
  useMediaLibraryStore,
} from '@/features/editor/deps/media-library'

const log = createLogger('NativeImageGenerator')
const RUNTIME_ID = 'native:text-to-image'

type Availability = 'checking' | 'offline' | 'unpaired' | 'ready'

interface GeneratedImage {
  file: File
  objectUrl: string
  width: number
  height: number
  saved: boolean
}

function registerNativeRuntime(
  model: NativeInferenceModel,
  featureLabel: string,
  cancelledRef: { current: boolean },
): void {
  localInferenceRuntimeRegistry.registerRuntime(
    {
      id: RUNTIME_ID,
      feature: 'native-image-generation',
      featureLabel,
      modelKey: model.id,
      modelLabel: model.label,
      backend: 'native',
      state: 'loading',
      loadingPhase: 'preparing',
      estimatedBytes: model.estimated_bytes,
      activeJobs: 1,
      loadedAt: Date.now(),
      lastUsedAt: Date.now(),
      unloadable: true,
    },
    {
      unload: async () => {
        cancelledRef.current = true
        await nativeInferenceClient.unloadRuntime()
        localInferenceRuntimeRegistry.unregisterRuntime(RUNTIME_ID)
      },
    },
  )
}

async function generateNativeImage(
  model: NativeInferenceModel,
  prompt: string,
  cancelledRef: { current: boolean },
  onUpdate: (job: NativeInferenceJob) => void,
): Promise<GeneratedImage> {
  const initialJob = await nativeInferenceClient.createJob({
    operation: 'text-to-image',
    model: model.id,
    prompt,
    width: 512,
    height: 512,
  })
  onUpdate(initialJob)
  const completedJob = await nativeInferenceConnection.waitForJob(initialJob, {
    isCancelled: () => cancelledRef.current,
    cancellationMessage: LOCAL_INFERENCE_UNLOADED_MESSAGE,
    onUpdate: (job) => {
      onUpdate(job)
      localInferenceRuntimeRegistry.updateRuntime(RUNTIME_ID, {
        state: job.state === 'queued' || job.state === 'loading' ? 'loading' : 'running',
        activeJobs: 1,
        lastUsedAt: Date.now(),
      })
    },
  })
  if (completedJob.state !== 'completed') {
    throw new Error(completedJob.error || completedJob.message)
  }
  const blob = await nativeInferenceClient.getResult(completedJob.id)
  return {
    file: new File([blob], `freecut-ai-${Date.now()}.png`, { type: 'image/png' }),
    objectUrl: URL.createObjectURL(blob),
    width: 512,
    height: 512,
    saved: false,
  }
}

function markNativeRuntimeError(error: unknown): void {
  localInferenceRuntimeRegistry.updateRuntime(RUNTIME_ID, {
    state: 'error',
    activeJobs: 0,
    errorMessage: error instanceof Error ? error.message : 'Native generation failed',
  })
}

function getUnavailableMessage(
  availability: Availability,
  translate: (key: string) => string,
): string | null {
  if (availability === 'offline') return translate('editor.aiPanel.nativeImage.offline')
  if (availability === 'unpaired') return translate('editor.aiPanel.nativeImage.unpaired')
  return null
}

export function NativeImageGenerator() {
  const { t } = useTranslation()
  const connection = useSyncExternalStore(
    nativeInferenceConnection.subscribe,
    nativeInferenceConnection.getSnapshot,
  )
  const currentProjectId = useMediaLibraryStore((state) => state.currentProjectId)
  const loadMediaItems = useMediaLibraryStore((state) => state.loadMediaItems)
  const selectMedia = useMediaLibraryStore((state) => state.selectMedia)
  const [modelId, setModelId] = useState('')
  const [prompt, setPrompt] = useState('')
  const [job, setJob] = useState<NativeInferenceJob | null>(null)
  const [generation, setGeneration] = useState<GeneratedImage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const cancelledRef = useRef(false)
  const generationRef = useRef<GeneratedImage | null>(null)
  generationRef.current = generation

  const availability: Availability = connection.state === 'connected' ? 'ready' : connection.state
  const models = connection.models

  useEffect(() => {
    setModelId((current) => current || models[0]?.id || '')
  }, [models])

  useEffect(
    () => () => {
      cancelledRef.current = true
      if (generationRef.current) URL.revokeObjectURL(generationRef.current.objectUrl)
    },
    [],
  )

  const selectedModel = models.find((model) => model.id === modelId) ?? null
  const isGenerating = job != null && !['completed', 'failed', 'cancelled'].includes(job.state)

  const handleGenerate = useCallback(async () => {
    if (!selectedModel || !prompt.trim() || !currentProjectId) return
    cancelledRef.current = false
    setError(null)
    if (generationRef.current) URL.revokeObjectURL(generationRef.current.objectUrl)
    setGeneration(null)

    registerNativeRuntime(selectedModel, t('editor.aiPanel.nativeImage.title'), cancelledRef)

    try {
      setGeneration(await generateNativeImage(selectedModel, prompt.trim(), cancelledRef, setJob))
      localInferenceRuntimeRegistry.updateRuntime(RUNTIME_ID, {
        state: 'ready',
        activeJobs: 0,
        lastUsedAt: Date.now(),
      })
    } catch (generationError) {
      if (
        !(generationError instanceof Error) ||
        generationError.message !== LOCAL_INFERENCE_UNLOADED_MESSAGE
      ) {
        log.warn('Native image generation failed', { error: generationError })
        setError(
          generationError instanceof Error
            ? generationError.message
            : t('editor.aiPanel.nativeImage.generateFailed'),
        )
      }
      markNativeRuntimeError(generationError)
    }
  }, [currentProjectId, prompt, selectedModel, t])

  const handleCancel = useCallback(async () => {
    cancelledRef.current = true
    if (job) await nativeInferenceClient.cancelJob(job.id)
  }, [job])

  const handleSave = useCallback(async () => {
    if (!generation || !currentProjectId || generation.saved) return
    setSaving(true)
    try {
      const { mediaLibraryService } = await importMediaLibraryService()
      const media = await mediaLibraryService.importGeneratedImage(
        generation.file,
        currentProjectId,
        {
          width: generation.width,
          height: generation.height,
          codec: 'png',
          tags: ['ai-generated', 'freecut-local', `model:${modelId}`],
        },
      )
      await loadMediaItems()
      selectMedia([media.id])
      setGeneration((current) => (current ? { ...current, saved: true } : current))
      toast.success(t('editor.aiPanel.nativeImage.savedToLibrary'))
    } catch (saveError) {
      log.error('Failed to save native generated image', saveError)
      toast.error(t('editor.aiPanel.nativeImage.saveFailed'))
    } finally {
      setSaving(false)
    }
  }, [currentProjectId, generation, loadMediaItems, modelId, selectMedia, t])

  const unavailableMessage = getUnavailableMessage(availability, t)

  return (
    <section className="space-y-3">
      <div className="-mx-3 -mt-3 bg-secondary/50 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium">{t('editor.aiPanel.nativeImage.title')}</h2>
          <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            Native
          </span>
        </div>
      </div>

      <NativeImageBody
        availability={availability}
        unavailableMessage={unavailableMessage}
        models={models}
        modelId={modelId}
        prompt={prompt}
        job={job}
        generation={generation}
        error={error}
        saving={saving}
        isGenerating={isGenerating}
        canGenerate={Boolean(prompt.trim() && modelId && currentProjectId)}
        onModelChange={setModelId}
        onPromptChange={setPrompt}
        onGenerate={() => void handleGenerate()}
        onCancel={() => void handleCancel()}
        onSave={() => void handleSave()}
      />
    </section>
  )
}

interface NativeImageBodyProps {
  availability: Availability
  unavailableMessage: string | null
  models: NativeInferenceModel[]
  modelId: string
  prompt: string
  job: NativeInferenceJob | null
  generation: GeneratedImage | null
  error: string | null
  saving: boolean
  isGenerating: boolean
  canGenerate: boolean
  onModelChange: (modelId: string) => void
  onPromptChange: (prompt: string) => void
  onGenerate: () => void
  onCancel: () => void
  onSave: () => void
}

function NativeImageBody(props: NativeImageBodyProps) {
  const { t } = useTranslation()
  if (props.availability === 'checking') {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {t('editor.aiPanel.nativeImage.checking')}
      </p>
    )
  }
  if (props.unavailableMessage) {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
        {props.unavailableMessage}
      </div>
    )
  }
  if (props.availability !== 'ready') return null

  return <NativeImageReadyBody {...props} />
}

function NativeImageReadyBody(props: NativeImageBodyProps) {
  const { t } = useTranslation()

  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="native-image-prompt">{t('editor.aiPanel.nativeImage.prompt')}</Label>
        <Textarea
          id="native-image-prompt"
          value={props.prompt}
          onChange={(event) => props.onPromptChange(event.target.value)}
          placeholder={t('editor.aiPanel.nativeImage.promptPlaceholder')}
          className="min-h-24 resize-y bg-secondary/30 text-sm"
          disabled={props.isGenerating}
        />
      </div>
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1 space-y-2">
          <Label>{t('editor.aiPanel.nativeImage.model')}</Label>
          <Select
            value={props.modelId}
            onValueChange={props.onModelChange}
            disabled={props.isGenerating}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {props.models.map((model) => (
                <SelectItem key={model.id} value={model.id} className="text-xs">
                  {model.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <NativeGenerationAction {...props} />
      </div>

      <NativeJobProgress isGenerating={props.isGenerating} job={props.job} />
      <NativeGenerationError error={props.error} />
      <NativeGenerationResult {...props} />
    </>
  )
}

function NativeGenerationAction(props: NativeImageBodyProps) {
  const { t } = useTranslation()
  if (props.isGenerating) {
    return (
      <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={props.onCancel}>
        <X className="h-3.5 w-3.5" />
        {t('common.cancel')}
      </Button>
    )
  }
  return (
    <Button
      size="sm"
      className="h-8 gap-1.5"
      onClick={props.onGenerate}
      disabled={!props.canGenerate}
    >
      <ImagePlus className="h-3.5 w-3.5" />
      {t('editor.aiPanel.nativeImage.generate')}
    </Button>
  )
}

function NativeJobProgress({
  isGenerating,
  job,
}: {
  isGenerating: boolean
  job: NativeInferenceJob | null
}) {
  if (!isGenerating || !job) return null
  return (
    <div className="space-y-2 rounded-lg border border-border bg-secondary/20 p-3">
      <p className="text-xs text-muted-foreground">{job.message}</p>
      <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${Math.round(job.progress * 100)}%` }}
        />
      </div>
    </div>
  )
}

function NativeGenerationError({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
      {error}
    </div>
  )
}

function getSaveState(saving: boolean, saved: boolean) {
  if (saving) return { Icon: Loader2, key: 'editor.aiPanel.nativeImage.saving', spin: true }
  if (saved) return { Icon: CheckCircle2, key: 'editor.aiPanel.nativeImage.saved', spin: false }
  return { Icon: Save, key: 'editor.aiPanel.nativeImage.saveToLibrary', spin: false }
}

function NativeGenerationResult(props: NativeImageBodyProps) {
  const { t } = useTranslation()
  if (!props.generation) return null
  const saveState = getSaveState(props.saving, props.generation.saved)
  const SaveStateIcon = saveState.Icon
  return (
    <div className="space-y-2 rounded-lg border border-border bg-secondary/20 p-3">
      <img
        src={props.generation.objectUrl}
        alt={props.prompt}
        className="aspect-square w-full rounded-md object-cover"
      />
      <Button
        variant="secondary"
        size="sm"
        className="h-7 w-full gap-1.5"
        onClick={props.onSave}
        disabled={props.saving || props.generation.saved}
      >
        <SaveStateIcon className={`h-3.5 w-3.5 ${saveState.spin ? 'animate-spin' : ''}`} />
        {t(saveState.key)}
      </Button>
    </div>
  )
}
