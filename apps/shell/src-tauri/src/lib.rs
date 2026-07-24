use std::path::Path;

use tauri::Emitter;

mod close_watch;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Backs `FilesApi.onClosed`. Spawns a background thread that blocks on
/// `close_watch::wait_for_write_close` and emits a `files:closed-event`
/// window event with the path once it returns — fire-once, not a
/// resubscribable stream, matching the "editor finished with this file"
/// use case rather than general watching (that's `FilesApi.watch`).
/// `close_watch` is only implemented for Linux today; other platforms fail
/// fast here rather than spawning a thread that would panic in
/// `unimplemented!()`.
#[tauri::command]
fn watch_file_closed(app: tauri::AppHandle, path: String) -> Result<(), String> {
    if !cfg!(target_os = "linux") {
        return Err("files:closed-event is not implemented on this platform yet".to_string());
    }

    std::thread::spawn(move || match close_watch::wait_for_write_close(Path::new(&path)) {
        Ok(()) => {
            let _ = app.emit("files:closed-event", &path);
        }
        Err(err) => {
            eprintln!("[files:closed-event] watch failed for {path}: {err}");
        }
    });

    Ok(())
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
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            get_os_identity,
            get_device_info,
            watch_file_closed
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
