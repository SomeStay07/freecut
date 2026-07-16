use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
#[cfg(target_os = "windows")]
use std::{os::windows::process::CommandExt, process::Command};
use tauri::menu::{Menu, MenuItem};
use tauri::path::BaseDirectory;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_updater::UpdaterExt;
use uuid::Uuid;

const SERVICE_PORT: u16 = 43117;
const FREECUT_URL: &str = "https://freecut.net";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Credentials {
    token: String,
    pairing_code: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManagerStatus {
    installed: bool,
    running: bool,
    busy: bool,
    pairing_code: String,
    service_url: String,
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateStatus {
    available: bool,
    current_version: String,
    version: Option<String>,
    notes: Option<String>,
}

struct ManagerState {
    credentials: Credentials,
    child: Mutex<Option<CommandChild>>,
    busy: Mutex<bool>,
    error: Mutex<Option<String>>,
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    Ok(path)
}

fn runtime_project_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resolve("runtime", BaseDirectory::Resource)
        .map_err(|error| error.to_string())
}

fn runtime_environment_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("runtime"))
}

fn python_install_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("python"))
}

fn runtime_python_path(app: &AppHandle) -> Result<PathBuf, String> {
    let environment = runtime_environment_dir(app)?;
    #[cfg(target_os = "windows")]
    return Ok(environment.join("Scripts").join("python.exe"));
    #[cfg(not(target_os = "windows"))]
    return Ok(environment.join("bin").join("python"));
}

fn output_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app_data_dir(app)?.join("data");
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    Ok(path)
}

fn service_running() -> bool {
    let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), SERVICE_PORT);
    TcpStream::connect_timeout(&address, Duration::from_millis(150)).is_ok()
}

fn credentials_path(data_dir: &Path) -> PathBuf {
    data_dir.join("credentials.json")
}

fn load_or_create_credentials(data_dir: &Path) -> Result<Credentials, String> {
    let path = credentials_path(data_dir);
    if path.exists() {
        let source = fs::read_to_string(path).map_err(|error| error.to_string())?;
        return serde_json::from_str(&source).map_err(|error| error.to_string());
    }

    let token = Uuid::new_v4().simple().to_string() + &Uuid::new_v4().simple().to_string();
    let pairing_code = Uuid::new_v4().simple().to_string()[..6].to_uppercase();
    let credentials = Credentials {
        token,
        pairing_code,
    };
    let source = serde_json::to_string_pretty(&credentials).map_err(|error| error.to_string())?;
    fs::write(path, source).map_err(|error| error.to_string())?;
    Ok(credentials)
}

fn set_error(state: &ManagerState, error: Option<String>) {
    *state.error.lock().expect("error mutex poisoned") = error;
}

fn set_busy(state: &ManagerState, busy: bool) {
    *state.busy.lock().expect("busy mutex poisoned") = busy;
}

fn show_manager_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn request_service_shutdown(token: &str) -> Result<(), String> {
    let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), SERVICE_PORT);
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(1))
        .map_err(|error| error.to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_secs(1)))
        .map_err(|error| error.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(1)))
        .map_err(|error| error.to_string())?;

    let request = format!(
        "POST /v1/runtime/shutdown HTTP/1.1\r\nHost: 127.0.0.1:{SERVICE_PORT}\r\nAuthorization: Bearer {token}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|error| error.to_string())?;
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|error| error.to_string())?;
    let status_line = response.lines().next().unwrap_or_default();
    if !status_line.contains(" 200 ") {
        return Err(format!("Service rejected shutdown request: {status_line}"));
    }
    Ok(())
}

fn wait_for_service_stop(timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while service_running() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(100));
    }
    !service_running()
}

#[cfg(target_os = "windows")]
fn stop_legacy_service(app: &AppHandle) -> Result<(), String> {
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let expected_python = runtime_python_path(app)?;
    let script = r#"
$connection = Get-NetTCPConnection -LocalPort 43117 -State Listen -ErrorAction Stop | Select-Object -First 1
$listener = Get-CimInstance Win32_Process -Filter "ProcessId = $($connection.OwningProcess)"
$parent = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.ParentProcessId)"
$expected = [IO.Path]::GetFullPath($env:FREECUT_EXPECTED_PYTHON)
$actual = if ($parent.ExecutablePath) { [IO.Path]::GetFullPath($parent.ExecutablePath) } else { '' }
if (-not $listener.CommandLine -or $listener.CommandLine -notmatch '-m\s+freecut_sidecar') { exit 12 }
if (-not $actual.Equals($expected, [StringComparison]::OrdinalIgnoreCase)) { exit 13 }
Stop-Process -Id $listener.ProcessId -Force -ErrorAction Stop
Start-Sleep -Milliseconds 200
if (Get-Process -Id $parent.ProcessId -ErrorAction SilentlyContinue) {
  Stop-Process -Id $parent.ProcessId -Force -ErrorAction Stop
}
"#;
    let output = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .env("FREECUT_EXPECTED_PYTHON", expected_python)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|error| error.to_string())?;
    if output.status.success() && wait_for_service_stop(Duration::from_secs(3)) {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if stderr.is_empty() {
        format!(
            "Refused to stop an unverified process using the inference port (exit code {:?})",
            output.status.code()
        )
    } else {
        stderr
    })
}

#[cfg(not(target_os = "windows"))]
fn stop_legacy_service(_app: &AppHandle) -> Result<(), String> {
    Err("The running inference service belongs to another app instance".to_string())
}

fn stop_managed_server(app: &AppHandle, state: &ManagerState) -> Result<(), String> {
    let child = state.child.lock().expect("child mutex poisoned").take();
    if !service_running() {
        return Ok(());
    }

    let shutdown_result = request_service_shutdown(&state.credentials.token);
    if wait_for_service_stop(Duration::from_secs(3)) {
        return Ok(());
    }

    if let Some(child) = child {
        child.kill().map_err(|error| error.to_string())?;
        if wait_for_service_stop(Duration::from_secs(3)) {
            return Ok(());
        }
    }

    let legacy_result = stop_legacy_service(app);
    if legacy_result.is_ok() {
        return Ok(());
    }

    Err(legacy_result
        .err()
        .or_else(|| shutdown_result.err())
        .unwrap_or_else(|| "The inference service did not stop before the timeout".to_string()))
}

fn build_status(app: &AppHandle, state: &ManagerState) -> ManagerStatus {
    let installed = runtime_python_path(app).is_ok_and(|path| path.exists());
    ManagerStatus {
        installed,
        running: service_running(),
        busy: *state.busy.lock().expect("busy mutex poisoned"),
        pairing_code: state.credentials.pairing_code.clone(),
        service_url: format!("http://127.0.0.1:{SERVICE_PORT}"),
        error: state.error.lock().expect("error mutex poisoned").clone(),
    }
}

#[tauri::command]
fn get_status(app: AppHandle, state: State<'_, ManagerState>) -> ManagerStatus {
    build_status(&app, &state)
}

#[tauri::command]
async fn install_runtime(
    app: AppHandle,
    state: State<'_, ManagerState>,
) -> Result<ManagerStatus, String> {
    set_busy(&state, true);
    set_error(&state, None);

    let project = runtime_project_dir(&app)?;
    let environment = runtime_environment_dir(&app)?;
    let python_dir = python_install_dir(&app)?;
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("uv");
    fs::create_dir_all(&cache_dir).map_err(|error| error.to_string())?;

    let result = app
        .shell()
        .sidecar("uv")
        .map_err(|error| error.to_string())?
        .args([
            "sync",
            "--project",
            project.to_string_lossy().as_ref(),
            "--locked",
            "--no-dev",
            "--python",
            "3.11",
        ])
        .env("UV_PROJECT_ENVIRONMENT", &environment)
        .env("UV_PYTHON_INSTALL_DIR", &python_dir)
        .env("UV_CACHE_DIR", &cache_dir)
        .output()
        .await
        .map_err(|error| error.to_string());

    set_busy(&state, false);
    match result {
        Ok(output) if output.status.success() => Ok(build_status(&app, &state)),
        Ok(output) => {
            let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let message = if message.is_empty() {
                "Runtime installation failed".to_string()
            } else {
                message
            };
            set_error(&state, Some(message.clone()));
            Err(message)
        }
        Err(error) => {
            set_error(&state, Some(error.clone()));
            Err(error)
        }
    }
}

#[tauri::command]
fn start_server(app: AppHandle, state: State<'_, ManagerState>) -> Result<ManagerStatus, String> {
    start_server_inner(&app, &state)
}

fn start_server_inner(app: &AppHandle, state: &ManagerState) -> Result<ManagerStatus, String> {
    if service_running() {
        return Ok(build_status(app, state));
    }
    if !runtime_python_path(app)?.exists() {
        return Err("Install the inference runtime first".to_string());
    }

    set_error(state, None);
    let python = runtime_python_path(app)?;
    let data_dir = output_dir(app)?;
    let port = SERVICE_PORT.to_string();
    let (mut events, child) = app
        .shell()
        .command(python)
        .args(["-m", "freecut_sidecar", "--port", &port])
        .env("FREECUT_SIDECAR_TOKEN", &state.credentials.token)
        .env(
            "FREECUT_SIDECAR_PAIRING_CODE",
            &state.credentials.pairing_code,
        )
        .env("FREECUT_SIDECAR_DATA_DIR", &data_dir)
        .spawn()
        .map_err(|error| error.to_string())?;

    tauri::async_runtime::spawn(async move { while events.recv().await.is_some() {} });
    *state.child.lock().expect("child mutex poisoned") = Some(child);
    Ok(build_status(app, state))
}

#[tauri::command]
fn stop_server(app: AppHandle, state: State<'_, ManagerState>) -> Result<ManagerStatus, String> {
    stop_managed_server(&app, &state)?;
    Ok(build_status(&app, &state))
}

#[tauri::command]
async fn check_for_updates(app: AppHandle) -> Result<UpdateStatus, String> {
    let current_version = app.package_info().version.to_string();
    let update = app
        .updater()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?;

    Ok(match update {
        Some(update) => UpdateStatus {
            available: true,
            current_version,
            version: Some(update.version),
            notes: update.body,
        },
        None => UpdateStatus {
            available: false,
            current_version,
            version: None,
            notes: None,
        },
    })
}

#[tauri::command]
async fn install_update(app: AppHandle, state: State<'_, ManagerState>) -> Result<(), String> {
    let update = app
        .updater()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "FreeCut Local is already up to date".to_string())?;

    stop_managed_server(&app, &state)?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn open_freecut() -> Result<(), String> {
    open::that(FREECUT_URL).map_err(|error| error.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let data_dir = app_data_dir(app.handle())?;
            let credentials = load_or_create_credentials(&data_dir)?;
            app.manage(ManagerState {
                credentials,
                child: Mutex::new(None),
                busy: Mutex::new(false),
                error: Mutex::new(None),
            });

            let open_manager =
                MenuItem::with_id(app, "open_manager", "Open manager", true, None::<&str>)?;
            let open_freecut =
                MenuItem::with_id(app, "open_freecut", "Open FreeCut", true, None::<&str>)?;
            let check_updates = MenuItem::with_id(
                app,
                "check_updates",
                "Check for updates",
                true,
                None::<&str>,
            )?;
            let quit = MenuItem::with_id(app, "quit", "Quit FreeCut Local", true, None::<&str>)?;
            let menu =
                Menu::with_items(app, &[&open_manager, &open_freecut, &check_updates, &quit])?;

            TrayIconBuilder::with_id("freecut-local")
                .icon(
                    app.default_window_icon()
                        .expect("application icon missing")
                        .clone(),
                )
                .tooltip("FreeCut Local")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open_manager" => show_manager_window(app),
                    "open_freecut" => {
                        let _ = open::that(FREECUT_URL);
                    }
                    "check_updates" => {
                        show_manager_window(app);
                        let _ = app.emit("request-update-check", ());
                    }
                    "quit" => {
                        let state = app.state::<ManagerState>();
                        let _ = stop_managed_server(app, &state);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_manager_window(tray.app_handle());
                    }
                })
                .build(app)?;

            let state = app.state::<ManagerState>();
            if runtime_python_path(app.handle()).is_ok_and(|path| path.exists()) {
                if let Err(error) = start_server_inner(app.handle(), &state) {
                    set_error(&state, Some(error));
                    show_manager_window(app.handle());
                }
            } else {
                show_manager_window(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main"
                && let WindowEvent::CloseRequested { api, .. } = event
            {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_status,
            install_runtime,
            start_server,
            stop_server,
            open_freecut,
            check_for_updates,
            install_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running FreeCut Local");
}
