# FreeCut Local

FreeCut Local is the optional, tray-first native inference companion for the browser editor. It packages a small Tauri manager as a normal desktop installer and provisions an app-owned Python runtime on first launch. Users do not need Python, Git, a terminal, or a separately configured virtual environment.

## User flow

1. Install `FreeCut Local Setup.exe`.
2. On first launch, select **Install and start** in the manager.
3. Copy the six-character pairing code.
4. In FreeCut, open **Settings -> Storage -> Local AI** and pair the companion.
5. Close the manager; FreeCut Local remains available in the system tray.
6. Use **AI -> Native Image Generation**. Completed images can be saved directly to the project's media library.

After setup, startup is silent: the inference service starts in the background and the manager stays hidden. Left-click the tray icon to open the manager. Right-click provides **Open manager**, **Open FreeCut**, **Check for updates**, and **Quit**. Closing the manager hides it back to the tray.

The initial runtime setup is intentionally separate from the installer. PyTorch and Diffusers are large, and keeping them out of the bootstrapper allows runtime packages to evolve without replacing the desktop manager. The runtime is isolated under the app's local-data directory and never mutates the user's system Python.

## Architecture

```text
FreeCut browser UI
  -> authenticated HTTP commands on 127.0.0.1:43117
  -> origin-bound WebSocket event channel
     -> FastAPI job service
        -> Diffusers + PyTorch
           -> CUDA / MPS / CPU

FreeCut Local (Tauri)
  -> tray-first lifecycle and on-demand manager UI
  -> NSIS installer and signed in-app updater
  -> persistent pairing credentials
  -> bundled uv runtime manager
  -> install/start/stop lifecycle for FastAPI
```

The service binds only to loopback, accepts CORS requests only from FreeCut's production and local development origins, and requires a bearer token after pairing. Model definitions are allowlisted; the public API does not accept arbitrary Python modules or `trust_remote_code`.

The browser keeps HTTP health checks as the availability authority and uses one shared WebSocket for versioned job/runtime events. WebSocket access uses a short-lived, one-time ticket issued by an authenticated HTTP request; the persistent bearer token is never placed in the socket URL. Sequence gaps trigger an HTTP state refresh, and job polling remains as a fallback.

## Development

Prerequisites are Node.js, Rust, and `uv`.

```powershell
npm install
npm run sidecar:dev
```

Run focused checks:

```powershell
npm run sidecar:prepare
cargo check --manifest-path sidecar/src-tauri/Cargo.toml
npm run sidecar:test
npx vp test run src/infrastructure/native-inference/client.test.ts
```

## Build and release

Build an ordinary Windows NSIS installer:

```powershell
npm run sidecar:build
```

The installer is emitted under `sidecar/src-tauri/target/release/bundle/nsis/`.

### Signed updates

The updater trusts the public key in `tauri.conf.json` and reads `latest.json` from the stable `freecut-local-updater` GitHub release. Tagged `sidecar-v*` builds create a signed updater installer, publish the versioned release assets, and replace the stable manifest.

Add the contents of the ignored `sidecar/src-tauri/updater.key` file to the GitHub Actions secret `TAURI_SIGNING_PRIVATE_KEY`, and the contents of `sidecar/src-tauri/updater.key.password` to `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Back up both securely: losing them prevents existing installations from accepting future updates.

To build updater artifacts locally:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw 'sidecar/src-tauri/updater.key'
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = Get-Content -Raw 'sidecar/src-tauri/updater.key.password'
npm run sidecar:release
```

Public releases should additionally use an Authenticode certificate so Windows can identify the publisher and avoid unsigned-app warnings.

## Runtime contract

The versioned API currently exposes:

- `GET /v1/health`
- `POST /v1/pair`
- `GET /v1/capabilities`
- `GET /v1/models`
- `POST /v1/jobs`
- `GET /v1/jobs/{id}`
- `DELETE /v1/jobs/{id}`
- `GET /v1/jobs/{id}/result`
- `POST /v1/runtime/unload`
- `POST /v1/runtime/shutdown`
- `POST /v1/events/ticket`
- `WS /v1/events`

Long-running work is serialized by the service to protect VRAM. The browser polls job state and updates FreeCut's existing local-inference runtime indicator.
