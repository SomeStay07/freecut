const invoke = window.__TAURI__.core.invoke
const listen = window.__TAURI__.event.listen

const elements = {
  statusDot: document.querySelector('#status-dot'),
  statusTitle: document.querySelector('#status-title'),
  statusBadge: document.querySelector('#status-badge'),
  setupTitle: document.querySelector('#setup-title'),
  setupDescription: document.querySelector('#setup-description'),
  setupButton: document.querySelector('#setup-button'),
  pairingCode: document.querySelector('#pairing-code'),
  error: document.querySelector('#error'),
  notice: document.querySelector('#notice'),
  toggleButton: document.querySelector('#toggle-button'),
  openButton: document.querySelector('#open-button'),
  serviceUrl: document.querySelector('#service-url'),
  updateTitle: document.querySelector('#update-title'),
  updateDescription: document.querySelector('#update-description'),
  updateButton: document.querySelector('#update-button'),
}

let currentStatus = null
let actionInFlight = false
let pendingActionLabel = null
let actionError = null
let availableUpdate = null
let updateInFlight = false
const statusRenderers = {
  '1:1': renderRunning,
  '0:1': renderStopped,
  '0:0': renderMissing,
  '1:0': renderRunning,
}

function render(status) {
  currentStatus = status
  elements.pairingCode.textContent = status.pairingCode
  elements.serviceUrl.textContent = status.serviceUrl
  renderStatusError(status.error)

  const busy = Boolean(Number(status.busy) + Number(actionInFlight))
  elements.setupButton.disabled = busy
  elements.toggleButton.disabled = busy || !status.installed
  statusRenderers[`${Number(status.running)}:${Number(status.installed)}`](busy)
  renderPendingAction()
}

function renderStatusError(statusError) {
  const visibleError = statusError || actionError
  elements.error.hidden = !visibleError
  elements.error.textContent = String(visibleError ?? '')
}

function renderPendingAction() {
  if (actionInFlight && pendingActionLabel) {
    elements.statusTitle.textContent = pendingActionLabel
    elements.statusBadge.textContent = pendingActionLabel.startsWith('Stopping')
      ? 'Stopping'
      : 'Starting'
    elements.statusBadge.className = 'badge'
    elements.toggleButton.textContent = pendingActionLabel
  }
}

function renderRunning() {
  elements.statusDot.className = 'status-dot online'
  elements.statusTitle.textContent = 'Native inference is ready'
  elements.statusBadge.textContent = 'Running'
  elements.statusBadge.className = 'badge online'
  elements.setupTitle.textContent = 'Setup complete'
  elements.setupDescription.textContent = 'FreeCut can now submit local inference jobs.'
  elements.setupButton.textContent = 'Runtime installed'
  elements.setupButton.disabled = true
  elements.toggleButton.textContent = 'Stop service'
}

function renderStopped() {
  elements.statusDot.className = 'status-dot'
  elements.statusTitle.textContent = 'Runtime installed, service stopped'
  elements.statusBadge.textContent = 'Stopped'
  elements.statusBadge.className = 'badge'
  elements.setupTitle.textContent = 'Runtime is installed'
  elements.setupDescription.textContent = 'Start the service to connect FreeCut.'
  elements.setupButton.textContent = 'Start service'
  elements.toggleButton.textContent = 'Start service'
}

function renderMissing(busy) {
  elements.statusDot.className = 'status-dot'
  elements.statusTitle.textContent = busy
    ? 'Installing native inference runtime...'
    : 'Setup required'
  elements.statusBadge.textContent = busy ? 'Installing' : 'Not installed'
  elements.statusBadge.className = 'badge'
  elements.setupTitle.textContent = 'Install the native runtime'
  elements.setupDescription.textContent =
    'Downloads an isolated Python, PyTorch and Diffusers environment. This can take several minutes.'
  elements.setupButton.textContent = busy ? 'Installing...' : 'Install and start'
  elements.toggleButton.textContent = 'Start service'
}

async function refresh() {
  try {
    render(await invoke('get_status'))
  } catch (error) {
    elements.error.hidden = false
    elements.error.textContent = String(error)
  }
}

function showNotice(message) {
  elements.notice.textContent = message
  elements.notice.hidden = false
  window.setTimeout(() => {
    elements.notice.hidden = true
  }, 2500)
}

async function runAction(action, pendingLabel, successMessage) {
  if (actionInFlight) return
  actionInFlight = true
  pendingActionLabel = pendingLabel
  actionError = null
  elements.error.hidden = true
  elements.notice.hidden = true
  if (currentStatus) render(currentStatus)
  try {
    await action()
    showNotice(successMessage)
  } catch (error) {
    actionError = String(error)
    elements.error.hidden = false
    elements.error.textContent = actionError
  } finally {
    actionInFlight = false
    pendingActionLabel = null
    await refresh()
  }
}

async function checkForUpdates() {
  if (updateInFlight) return
  updateInFlight = true
  elements.updateButton.disabled = true
  elements.updateButton.textContent = 'Checking...'
  elements.updateTitle.textContent = 'Checking for updates'
  elements.updateDescription.textContent = 'Contacting the signed FreeCut Local release feed.'
  try {
    renderUpdateStatus(await invoke('check_for_updates'))
  } catch (error) {
    elements.updateTitle.textContent = 'Could not check for updates'
    elements.updateDescription.textContent = String(error)
    elements.updateButton.textContent = 'Try again'
  } finally {
    updateInFlight = false
    elements.updateButton.disabled = false
  }
}

function renderUpdateStatus(status) {
  if (status.available) {
    availableUpdate = status.version
    elements.updateTitle.textContent = `FreeCut Local ${status.version} is available`
    elements.updateDescription.textContent = status.notes || 'Ready to download and install.'
    elements.updateButton.textContent = 'Update and restart'
    return
  }
  availableUpdate = null
  elements.updateTitle.textContent = 'FreeCut Local is up to date'
  elements.updateDescription.textContent = `You are running version ${status.currentVersion}.`
  elements.updateButton.textContent = 'Check again'
}

async function installUpdate() {
  if (updateInFlight) return
  updateInFlight = true
  elements.updateButton.disabled = true
  elements.updateButton.textContent = 'Installing...'
  elements.updateTitle.textContent = `Installing FreeCut Local ${availableUpdate}`
  elements.updateDescription.textContent =
    'The app will restart after the signed update is installed.'
  try {
    await invoke('install_update')
  } catch (error) {
    elements.updateTitle.textContent = 'Update failed'
    elements.updateDescription.textContent = String(error)
    elements.updateButton.textContent = 'Try again'
    updateInFlight = false
    elements.updateButton.disabled = false
  }
}

elements.setupButton.addEventListener('click', () => {
  void runAction(
    async () => {
      if (!currentStatus?.installed) await invoke('install_runtime')
      await invoke('start_server')
    },
    currentStatus?.installed ? 'Starting service...' : 'Installing runtime...',
    'Inference service started.',
  )
})

elements.toggleButton.addEventListener('click', () => {
  const stopping = Boolean(currentStatus?.running)
  void runAction(
    () => invoke(stopping ? 'stop_server' : 'start_server'),
    stopping ? 'Stopping service...' : 'Starting service...',
    stopping ? 'Inference service stopped.' : 'Inference service started.',
  )
})

elements.openButton.addEventListener('click', () => {
  void invoke('open_freecut')
})

elements.updateButton.addEventListener('click', () => {
  void (availableUpdate ? installUpdate() : checkForUpdates())
})

elements.pairingCode.addEventListener('click', async () => {
  await navigator.clipboard.writeText(elements.pairingCode.textContent)
  const original = elements.pairingCode.textContent
  elements.pairingCode.textContent = 'COPIED'
  window.setTimeout(() => {
    elements.pairingCode.textContent = original
  }, 900)
})

void refresh()
void listen('request-update-check', () => void checkForUpdates())
window.setInterval(() => void refresh(), 2000)
