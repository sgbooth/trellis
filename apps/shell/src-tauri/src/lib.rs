use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
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

/// Where `plugin://` reads files from — dev-time-only simplification,
/// resolved relative to this crate. Stage 5 (real distribution) replaces
/// this with an actual installed-plugins directory; this only covers local
/// dynamic loading during development. Targets macOS/Linux's URI
/// convention (`plugin://<host>/<path>`) — Windows/Android use a different
/// convention (`http://plugin.localhost/<path>`) and aren't handled here.
fn plugin_dist_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../client/dist")
}

/// Compiled into the shell binary, not read from disk at runtime — unlike
/// `plugin_dist_dir()`, this is policy, not the untrusted/swappable thing
/// being gated. If it were just a sidecar file next to the built app,
/// anyone with local file access could edit it and grant themselves
/// everything. This is the artifact of "IT reviewed and approved these."
const ALLOWED_CAPABILITIES_JSON: &str = include_str!("../allowed-capabilities.json");

fn allowed_capabilities() -> HashSet<String> {
    serde_json::from_str::<Vec<String>>(ALLOWED_CAPABILITIES_JSON)
        .unwrap_or_default()
        .into_iter()
        .collect()
}

/// Filters a plugin's self-declared `manifest.json` capabilities down to
/// the allowlist intersection — the plugin doesn't get to grant itself
/// more than the shell allows just by asking. Returns `None` if the
/// manifest can't be parsed, so the caller fails closed (serves nothing)
/// rather than ever passing through an unfiltered manifest.
fn filter_manifest_capabilities(data: &[u8]) -> Option<Vec<u8>> {
    let mut manifest: serde_json::Value = serde_json::from_slice(data).ok()?;
    let allowed = allowed_capabilities();

    if let Some(requested) = manifest.get("capabilities").and_then(|c| c.as_array()) {
        let requested: Vec<String> = requested
            .iter()
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect();
        let granted: Vec<String> = requested
            .iter()
            .filter(|c| allowed.contains(*c))
            .cloned()
            .collect();

        if granted.len() != requested.len() {
            let denied: Vec<&String> = requested.iter().filter(|c| !allowed.contains(*c)).collect();
            eprintln!(
                "[capabilities] plugin requested {requested:?}, denied {denied:?} (not in allowed-capabilities.json)"
            );
        }

        manifest["capabilities"] =
            serde_json::Value::Array(granted.into_iter().map(serde_json::Value::String).collect());
    }

    serde_json::to_vec(&manifest).ok()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, get_os_identity, get_device_info])
        .register_uri_scheme_protocol("plugin", |_ctx, request| {
            let not_found = || {
                tauri::http::Response::builder()
                    .status(tauri::http::StatusCode::NOT_FOUND)
                    .body(Vec::new())
                    .unwrap()
            };

            let dist_dir = plugin_dist_dir();
            let Ok(canonical_dist) = dist_dir.canonicalize() else {
                return not_found();
            };

            let requested_path = request.uri().path().trim_start_matches('/');
            let Ok(resolved) = dist_dir.join(requested_path).canonicalize() else {
                return not_found();
            };
            // Basic path-traversal guard — no signing yet (that's Stage 4),
            // but this shouldn't serve files outside the plugin's own dir.
            if !resolved.starts_with(&canonical_dist) {
                return not_found();
            }

            match fs::read(&resolved) {
                Ok(raw_data) => {
                    // Stage 3: the plugin's self-declared capabilities in
                    // manifest.json don't get trusted as-is — filter them
                    // down to what allowed-capabilities.json permits before
                    // the shell ever sees them. Fail closed if the manifest
                    // can't be parsed, rather than ever serving it unfiltered.
                    let data = if requested_path == "manifest.json" {
                        match filter_manifest_capabilities(&raw_data) {
                            Some(filtered) => filtered,
                            None => return not_found(),
                        }
                    } else {
                        raw_data
                    };

                    // Module scripts need a correct JS MIME type or a
                    // strict webview can reject the import outright.
                    let content_type = if requested_path.ends_with(".js") {
                        "text/javascript"
                    } else if requested_path.ends_with(".json") {
                        "application/json"
                    } else {
                        "application/octet-stream"
                    };
                    tauri::http::Response::builder()
                        .header(tauri::http::header::CONTENT_TYPE, content_type)
                        // The requesting page (dev server / bundled frontend) is a
                        // different origin than the plugin:// scheme.
                        .header(tauri::http::header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                        .body(data)
                        .unwrap()
                }
                Err(_) => not_found(),
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_capabilities_outside_the_allowlist() {
        let manifest = br#"{"id":"client","capabilities":["chat:invoke","llm:invoke","files:write"]}"#;
        let filtered = filter_manifest_capabilities(manifest).expect("valid manifest should parse");
        let value: serde_json::Value = serde_json::from_slice(&filtered).unwrap();
        assert_eq!(value["capabilities"], serde_json::json!(["chat:invoke"]));
    }

    #[test]
    fn leaves_fully_allowed_manifests_unchanged() {
        let manifest = br#"{"id":"client","capabilities":["chat:invoke","identity:read"]}"#;
        let filtered = filter_manifest_capabilities(manifest).expect("valid manifest should parse");
        let value: serde_json::Value = serde_json::from_slice(&filtered).unwrap();
        assert_eq!(value["capabilities"], serde_json::json!(["chat:invoke", "identity:read"]));
    }

    #[test]
    fn fails_closed_on_invalid_json() {
        assert!(filter_manifest_capabilities(b"not json").is_none());
    }
}
