import { useCallback, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, Link2, Loader2, Unplug } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { nativeInferenceConnection, nativeInferenceClient } from '@/infrastructure/native-inference'
import { createLogger } from '@/shared/logging/logger'
import { formatEstimatedBytes } from '@/shared/state/local-inference'

const log = createLogger('NativeInferenceControl')
const DOWNLOAD_URL = 'https://github.com/walterlow/freecut/releases/latest'

type ConnectionState = 'checking' | 'offline' | 'unpaired' | 'pairing' | 'connected'

export function NativeInferenceControl() {
  const { t } = useTranslation()
  const connection = useSyncExternalStore(
    nativeInferenceConnection.subscribe,
    nativeInferenceConnection.getSnapshot,
  )
  const [pairing, setPairing] = useState(false)
  const [pairingCode, setPairingCode] = useState('')
  const connectionState: ConnectionState = pairing ? 'pairing' : connection.state
  const capabilities = connection.capabilities

  const handlePair = useCallback(async () => {
    if (pairingCode.trim().length < 6) return
    setPairing(true)
    try {
      await nativeInferenceClient.pair(pairingCode)
      setPairingCode('')
      await nativeInferenceConnection.checkNow()
      toast.success(t('projects.settings.localInference.nativePaired'))
    } catch (error) {
      log.warn('Failed to pair with FreeCut Local', { error })
      toast.error(t('projects.settings.localInference.nativePairFailed'))
    } finally {
      setPairing(false)
    }
  }, [pairingCode, t])

  const handleDisconnect = useCallback(() => {
    nativeInferenceClient.clearPairing()
    void nativeInferenceConnection.checkNow()
  }, [])

  const description = (() => {
    if (connectionState === 'checking') {
      return t('projects.settings.localInference.nativeChecking')
    }
    if (connectionState === 'offline') {
      return t('projects.settings.localInference.nativeOffline')
    }
    if (connectionState === 'connected' && capabilities) {
      const device = t('projects.settings.localInference.nativeConnectedDevice', {
        device: capabilities.device_name,
      })
      const vram = connection.vram
      return vram?.vramUsedBytes != null && vram.vramTotalBytes != null
        ? `${device} · ${formatEstimatedBytes(vram.vramUsedBytes)} / ${formatEstimatedBytes(vram.vramTotalBytes)} VRAM`
        : device
    }
    return t('projects.settings.localInference.nativeUnpaired')
  })()

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">{t('projects.settings.localInference.nativeTitle')}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
        {connectionState === 'offline' && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-28 shrink-0 gap-1.5"
            onClick={() => window.open(DOWNLOAD_URL, '_blank', 'noopener,noreferrer')}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t('projects.settings.localInference.nativeDownload')}
          </Button>
        )}
        {connectionState === 'connected' && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-28 shrink-0 gap-1.5"
            onClick={handleDisconnect}
          >
            <Unplug className="h-3.5 w-3.5" />
            {t('projects.settings.localInference.nativeDisconnect')}
          </Button>
        )}
        {connectionState === 'checking' && (
          <Loader2 className="mt-1 h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
        )}
      </div>
      {(connectionState === 'unpaired' || connectionState === 'pairing') && (
        <div className="flex gap-2">
          <Input
            value={pairingCode}
            onChange={(event) => setPairingCode(event.target.value.toUpperCase().slice(0, 6))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handlePair()
            }}
            placeholder={t('projects.settings.localInference.nativePairingPlaceholder')}
            aria-label={t('projects.settings.localInference.nativePairingPlaceholder')}
            className="h-8 font-mono uppercase tracking-widest"
            disabled={connectionState === 'pairing'}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-28 shrink-0 gap-1.5"
            onClick={() => void handlePair()}
            disabled={pairingCode.trim().length < 6 || connectionState === 'pairing'}
          >
            {connectionState === 'pairing' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Link2 className="h-3.5 w-3.5" />
            )}
            {connectionState === 'pairing'
              ? t('projects.settings.localInference.nativePairing')
              : t('projects.settings.localInference.nativePair')}
          </Button>
        </div>
      )}
    </div>
  )
}
