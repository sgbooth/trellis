use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tauri::{Emitter, State};

mod close_watch;

#[derive(Default)]
struct CloseWatchRegistry(Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>);

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CloseWatchError {
    watch_id: String,
    message: String,
}

/// Backs `FilesApi.onClosed`. Spawns a background thread that blocks on
/// `close_watch::wait_for_write_close` and emits a `files:closed-event`
/// window event with the path once it returns — fire-once, not a
/// resubscribable stream, matching the "editor finished with this file"
/// use case rather than general watching (that's `FilesApi.watch`).
/// `close_watch` is implemented for Linux (inotify) and macOS (libproc
/// polling); other platforms fail fast here rather than spawning a thread
/// that would panic in `unimplemented!()`.
#[tauri::command]
fn watch_file_closed(
    app: tauri::AppHandle,
    registry: State<'_, CloseWatchRegistry>,
    path: String,
    watch_id: String,
) -> Result<(), String> {
    if !cfg!(any(target_os = "linux", target_os = "macos")) {
        return Err("files:closed-event is not implemented on this platform yet".to_string());
    }

    std::fs::metadata(&path).map_err(|err| format!("cannot watch {path}: {err}"))?;
    let cancelled = Arc::new(AtomicBool::new(false));
    let watches = Arc::clone(&registry.0);
    {
        let mut watches = watches
            .lock()
            .map_err(|_| "close-watch registry is unavailable".to_string())?;
        if watches.contains_key(&watch_id) {
            return Err("watch id is already active".to_string());
        }
        watches.insert(watch_id.clone(), Arc::clone(&cancelled));
    }

    std::thread::spawn(move || {
        let result = close_watch::wait_for_write_close(Path::new(&path), &cancelled);
        if let Ok(mut watches) = watches.lock() {
            watches.remove(&watch_id);
        }
        match result {
            Ok(true) => {
                let _ = app.emit("files:closed-event", &path);
            }
            Ok(false) => {}
            Err(err) => {
                eprintln!("[files:closed-event] watch failed for {path}: {err}");
                let _ = app.emit(
                    "files:closed-error",
                    CloseWatchError {
                        watch_id,
                        message: err.to_string(),
                    },
                );
            }
        }
    });

    Ok(())
}

#[tauri::command]
fn cancel_watch_file_closed(registry: State<'_, CloseWatchRegistry>, watch_id: String) {
    if let Ok(mut watches) = registry.0.lock() {
        if let Some(cancelled) = watches.remove(&watch_id) {
            cancelled.store(true, Ordering::Relaxed);
        }
    }
}

/// OS-reported identity for audit-trail logging only — unverified, not a
/// security boundary, trivially spoofable by anyone with local shell access.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct OsIdentity {
    username: String,
    display_name: String,
}

#[tauri::command]
fn get_os_identity() -> OsIdentity {
    OsIdentity {
        username: whoami::username(),
        display_name: whoami::realname(),
    }
}

/// OS/device info for demonstrating userspace access — purely informational,
/// not a security signal.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DeviceInfo {
    device_name: String,
    hostname: String,
    platform: String,
    distro: String,
    arch: String,
    desktop_env: String,
}

#[tauri::command]
fn get_device_info() -> DeviceInfo {
    DeviceInfo {
        device_name: whoami::devicename(),
        hostname: whoami::fallible::hostname().unwrap_or_else(|_| "unknown".to_string()),
        platform: whoami::platform().to_string(),
        distro: whoami::distro(),
        arch: whoami::arch().to_string(),
        desktop_env: whoami::desktop_env().to_string(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .manage(CloseWatchRegistry::default())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_os_identity,
            get_device_info,
            watch_file_closed,
            cancel_watch_file_closed
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
