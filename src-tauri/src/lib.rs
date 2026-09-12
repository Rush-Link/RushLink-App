use futures_util::StreamExt;
use reqwest::{Client, Method};
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::RwLock;
use tokio_tungstenite::connect_async;
use url::{Host, Url};

#[derive(Clone)]
struct DeviceSession {
    base_url: Url,
    client: Client,
}

#[derive(Default)]
struct AppState {
    session: Arc<RwLock<Option<DeviceSession>>>,
    event_generation: Arc<AtomicU64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeviceInfo {
    id: String,
    name: String,
    model: String,
    host: String,
    firmware: String,
    product_code: String,
    status: String,
    latency_ms: u128,
    capabilities: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeviceCapabilities {
    product: String,
    firmware: String,
    object_count: usize,
    property_count: usize,
    method_count: usize,
    flags: Map<String, Value>,
    raw_objects: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectResult {
    device: DeviceInfo,
    capabilities: DeviceCapabilities,
}

#[derive(Debug, Serialize)]
struct ApiResponse {
    status: u16,
    body: Value,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DeviceEvent {
    received_at: u128,
    payload: Value,
}

fn http_client(timeout: Duration) -> Result<Client, String> {
    Client::builder()
        .timeout(timeout)
        .connect_timeout(timeout)
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("RushLink/0.1")
        .build()
        .map_err(|error| error.to_string())
}

fn normalize_address(address: &str) -> Result<Url, String> {
    let trimmed = address.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("Enter a device hostname or private IP address".into());
    }
    let candidate = if trimmed.contains("://") {
        trimmed.to_owned()
    } else {
        format!("http://{trimmed}")
    };
    let mut url =
        Url::parse(&candidate).map_err(|_| "The device address is not valid".to_string())?;
    if url.scheme() != "http" {
        return Err("HeadRush device connections must use local HTTP".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Credentials are not allowed in a device address".into());
    }
    let allowed = match url.host() {
        Some(Host::Domain(host)) => {
            host.eq_ignore_ascii_case("localhost") || host.to_ascii_lowercase().ends_with(".local")
        }
        Some(Host::Ipv4(address)) => {
            address.is_private() || address.is_loopback() || address.is_link_local()
        }
        Some(Host::Ipv6(address)) => {
            address.is_loopback() || address.is_unique_local() || address.is_unicast_link_local()
        }
        None => return Err("The device address has no hostname".into()),
    };
    if !allowed {
        return Err(
            "RushLink only connects to .local, loopback, or private-LAN device addresses".into(),
        );
    }
    url.set_path("");
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

fn route_url(base: &Url, route: &str) -> Result<Url, String> {
    if !route.starts_with('/') || route.starts_with("//") || route.contains("..") {
        return Err("Invalid device API route".into());
    }
    base.join(route.trim_start_matches('/'))
        .map_err(|error| error.to_string())
}

fn raw_request_method(method: &str) -> Result<Method, String> {
    match method {
        "GET" => Ok(Method::GET),
        "POST" => Ok(Method::POST),
        "PUT" => Ok(Method::PUT),
        _ => Err("Only GET, POST and PUT device requests are allowed".into()),
    }
}

fn raw_route_allowed(method: &Method, route: &str) -> bool {
    route.starts_with("/api/")
        || (*method == Method::GET
            && (route == "/static"
                || route.starts_with("/static/")
                || route == "/files/Evil/Web"
                || route.starts_with("/files/Evil/Web/")))
}

fn object_value<'a>(subtree: &'a Value, path: &str) -> Option<&'a Map<String, Value>> {
    subtree.get(path)?.get("value")?.as_object()
}

fn text_property(subtree: &Value, path: &str, key: &str) -> Option<String> {
    object_value(subtree, path)?
        .get(key)?
        .as_str()
        .map(str::to_owned)
}

fn build_profile(
    subtree: &Value,
    base: &Url,
    latency_ms: u128,
) -> (DeviceInfo, DeviceCapabilities) {
    let objects = subtree.as_object().cloned().unwrap_or_default();
    let name = text_property(subtree, "/Evil/Gui", "DeviceName")
        .unwrap_or_else(|| "HeadRush device".into());
    let firmware =
        text_property(subtree, "/Evil/Gui", "AppVersion").unwrap_or_else(|| "Unknown".into());
    let lower = name.to_ascii_lowercase();
    let model = if lower.contains("flex") {
        "Prime Flex"
    } else if lower.contains("core") {
        "Core"
    } else {
        "Prime"
    }
    .to_string();
    let product_code = if model == "Prime Flex" {
        "HG12"
    } else if model == "Core" {
        "CORE"
    } else {
        "PRIME"
    }
    .to_string();
    let property_count = objects
        .values()
        .filter_map(|object| object.pointer("/meta/properties")?.as_object())
        .map(Map::len)
        .sum();
    let method_count = objects
        .values()
        .filter_map(|object| object.pointer("/meta/x-methods")?.as_object())
        .map(Map::len)
        .sum();
    let has = |path: &str| objects.contains_key(path);
    let mut flags = Map::new();
    for (key, value) in [
        ("tone3000", has("/Evil/API/Tone3000")),
        ("cloud", has("/Evil/Cloud/Master")),
        (
            "vocals",
            objects
                .keys()
                .any(|key| key.to_ascii_lowercase().contains("vocal")),
        ),
        (
            "drums",
            objects
                .keys()
                .any(|key| key.to_ascii_lowercase().contains("drum")),
        ),
        (
            "looper",
            objects
                .keys()
                .any(|key| key.to_ascii_lowercase().contains("looper")),
        ),
        ("scenes", has("/Evil/Engine/FootSwitch")),
        ("bluetoothMidi", false),
        ("externalStorage", has("/Evil/Engine/Settings/StorageInfo")),
    ] {
        flags.insert(key.into(), Value::Bool(value));
    }
    let raw_objects = [
        "/Evil/API/Rigs",
        "/Evil/API/Setlists",
        "/Evil/API/Tone3000",
        "/Evil/Cloud/Master",
        "/Evil/Engine/Patch/Rig",
        "/Evil/Engine/FootSwitch",
        "/Evil/Engine/Settings/Midi",
    ]
    .into_iter()
    .filter(|path| has(path))
    .map(str::to_owned)
    .collect();
    let features = flags
        .iter()
        .filter_map(|(key, value)| {
            value
                .as_bool()
                .filter(|enabled| *enabled)
                .map(|_| key.clone())
        })
        .collect();
    let host = base.host_str().unwrap_or("unknown").to_string();
    let device = DeviceInfo {
        id: format!("{}-{}", model.to_ascii_lowercase().replace(' ', "-"), host),
        name: model.clone(),
        model: model.clone(),
        host,
        firmware: firmware.clone(),
        product_code: product_code.clone(),
        status: "ready".into(),
        latency_ms,
        capabilities: features,
    };
    let capabilities = DeviceCapabilities {
        product: format!("{product_code} / {model}"),
        firmware,
        object_count: objects.len(),
        property_count,
        method_count,
        flags,
        raw_objects,
    };
    (device, capabilities)
}

async fn request_json(
    client: &Client,
    method: Method,
    url: Url,
    body: Option<Value>,
) -> Result<ApiResponse, String> {
    let mut request = client
        .request(method, url)
        .header("Accept", "application/json");
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request.send().await.map_err(|error| error.to_string())?;
    let status = response.status().as_u16();
    let text = response.text().await.map_err(|error| error.to_string())?;
    let body = serde_json::from_str(&text).unwrap_or(Value::String(text));
    if !(200..300).contains(&status) {
        return Err(format!("Device returned HTTP {status}: {body}"));
    }
    Ok(ApiResponse { status, body })
}

async fn active_session(state: &State<'_, AppState>) -> Result<DeviceSession, String> {
    state
        .session
        .read()
        .await
        .clone()
        .ok_or_else(|| "No HeadRush device is connected".into())
}

#[tauri::command]
async fn discover_devices() -> Result<Vec<DeviceInfo>, String> {
    let client = http_client(Duration::from_millis(1200))?;
    let candidates = [
        "headrushflexprime.local",
        "headrushprime.local",
        "headrushcore.local",
    ];
    let mut found = Vec::new();
    for address in candidates {
        let base = normalize_address(address)?;
        let url = route_url(&base, "/api/v1/subtree")?;
        let started = Instant::now();
        if let Ok(response) = request_json(&client, Method::GET, url, None).await {
            let (device, _) = build_profile(&response.body, &base, started.elapsed().as_millis());
            found.push(device);
        }
    }
    Ok(found)
}

#[tauri::command]
async fn connect_device(
    address: String,
    state: State<'_, AppState>,
) -> Result<ConnectResult, String> {
    let base_url = normalize_address(&address)?;
    let client = http_client(Duration::from_secs(12))?;
    let started = Instant::now();
    let subtree = request_json(
        &client,
        Method::GET,
        route_url(&base_url, "/api/v1/subtree")?,
        None,
    )
    .await?
    .body;
    let (device, capabilities) = build_profile(&subtree, &base_url, started.elapsed().as_millis());
    *state.session.write().await = Some(DeviceSession { base_url, client });
    Ok(ConnectResult {
        device,
        capabilities,
    })
}

#[tauri::command]
async fn disconnect_device(state: State<'_, AppState>) -> Result<(), String> {
    state.event_generation.fetch_add(1, Ordering::SeqCst);
    *state.session.write().await = None;
    Ok(())
}

#[tauri::command]
async fn get_subtree(path: Option<String>, state: State<'_, AppState>) -> Result<Value, String> {
    let session = active_session(&state).await?;
    let suffix = path.unwrap_or_default();
    let route = if suffix.is_empty() {
        "/api/v1/subtree".into()
    } else {
        format!("/api/v1/subtree/{}", suffix.trim_start_matches('/'))
    };
    Ok(request_json(
        &session.client,
        Method::GET,
        route_url(&session.base_url, &route)?,
        None,
    )
    .await?
    .body)
}

#[tauri::command]
async fn get_object_properties(path: String, state: State<'_, AppState>) -> Result<Value, String> {
    let session = active_session(&state).await?;
    let route = format!("/api/v1/object-properties/{}", path.trim_start_matches('/'));
    Ok(request_json(
        &session.client,
        Method::GET,
        route_url(&session.base_url, &route)?,
        None,
    )
    .await?
    .body)
}

#[tauri::command]
async fn set_object_properties(
    path: String,
    properties: Value,
    state: State<'_, AppState>,
) -> Result<ApiResponse, String> {
    if !properties.is_object() {
        return Err("Properties must be a JSON object".into());
    }
    let session = active_session(&state).await?;
    let route = format!("/api/v1/object-properties/{}", path.trim_start_matches('/'));
    request_json(
        &session.client,
        Method::PUT,
        route_url(&session.base_url, &route)?,
        Some(properties),
    )
    .await
}

#[tauri::command]
async fn call_object_method(
    path: String,
    method: String,
    arguments: Vec<Value>,
    state: State<'_, AppState>,
) -> Result<ApiResponse, String> {
    if method.is_empty()
        || !method
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '_')
    {
        return Err("Invalid reflected method name".into());
    }
    let session = active_session(&state).await?;
    let route = format!(
        "/api/v1/object-method/{}/{}",
        path.trim_start_matches('/'),
        method
    );
    request_json(
        &session.client,
        Method::POST,
        route_url(&session.base_url, &route)?,
        Some(json!({ "arguments": arguments })),
    )
    .await
}

#[tauri::command]
async fn pair_device(pin: String, state: State<'_, AppState>) -> Result<ApiResponse, String> {
    if pin.len() > 32 {
        return Err("Pairing code is too long".into());
    }
    let session = active_session(&state).await?;
    request_json(
        &session.client,
        Method::POST,
        route_url(&session.base_url, "/api/auth")?,
        Some(json!({ "pin": pin })),
    )
    .await
}

#[tauri::command]
async fn device_request(
    method: String,
    route: String,
    body: Option<Value>,
    state: State<'_, AppState>,
) -> Result<ApiResponse, String> {
    let method = raw_request_method(&method)?;
    if !raw_route_allowed(&method, &route) {
        return Err("Raw requests are restricted to the reflected API and read-only public device files".into());
    }
    let session = active_session(&state).await?;
    request_json(
        &session.client,
        method,
        route_url(&session.base_url, &route)?,
        body,
    )
    .await
}

#[tauri::command]
async fn start_device_events(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let session = active_session(&state).await?;
    let mut ws_url = session.base_url.clone();
    ws_url
        .set_scheme("ws")
        .map_err(|_| "Could not form device WebSocket URL")?;
    ws_url.set_path("/");
    let generation_counter = state.event_generation.clone();
    let generation = generation_counter.fetch_add(1, Ordering::SeqCst) + 1;
    tauri::async_runtime::spawn(async move {
        let mut attempt = 0_u64;
        while generation_counter.load(Ordering::SeqCst) == generation {
            match connect_async(ws_url.as_str()).await {
                Ok((stream, _)) => {
                    attempt = 0;
                    let _ = app.emit("device-realtime-status", json!({ "state": "connected" }));
                    let (_, mut read) = stream.split();
                    while generation_counter.load(Ordering::SeqCst) == generation {
                        let Some(message) = read.next().await else { break };
                        match message {
                            Ok(message) if message.is_text() => {
                                let text = message.into_text().unwrap_or_default();
                                let payload = serde_json::from_str(&text)
                                    .unwrap_or(Value::String(text.to_string()));
                                let event = DeviceEvent {
                                    received_at: std::time::SystemTime::now()
                                        .duration_since(std::time::UNIX_EPOCH)
                                        .map(|duration| duration.as_millis())
                                        .unwrap_or_default(),
                                    payload,
                                };
                                let _ = app.emit("device-event", event);
                            }
                            Ok(message) if message.is_close() => break,
                            Err(error) => {
                                let _ = app.emit("device-connection-error", error.to_string());
                                break;
                            }
                            _ => {}
                        }
                    }
                }
                Err(error) => {
                    attempt += 1;
                    if attempt == 1 {
                        let _ = app.emit("device-connection-error", error.to_string());
                    }
                }
            }
            if generation_counter.load(Ordering::SeqCst) != generation {
                break;
            }
            attempt += 1;
            let retry_seconds = attempt.min(15);
            let _ = app.emit("device-realtime-status", json!({ "state": "reconnecting", "retrySeconds": retry_seconds }));
            tokio::time::sleep(Duration::from_secs(retry_seconds)).await;
        }
    });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            discover_devices,
            connect_device,
            disconnect_device,
            get_subtree,
            get_object_properties,
            set_object_properties,
            call_object_method,
            pair_device,
            device_request,
            start_device_events
        ])
        .run(tauri::generate_context!())
        .expect("error while running RushLink");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_local_headrush_addresses() {
        for address in [
            "headrushflexprime.local",
            "http://headrushcore.local/ignored?query=yes#fragment",
            "192.168.1.129",
            "10.0.0.4:8080",
            "127.0.0.1",
            "localhost",
            "http://[::1]",
            "http://[fd00::1234]",
        ] {
            let url = normalize_address(address).unwrap_or_else(|error| panic!("{address}: {error}"));
            assert_eq!(url.scheme(), "http");
            assert!(url.path().is_empty() || url.path() == "/");
            assert!(url.query().is_none());
            assert!(url.fragment().is_none());
        }
    }

    #[test]
    fn rejects_remote_credentials_and_unsafe_schemes() {
        for address in [
            "",
            "https://headrushflexprime.local",
            "http://example.com",
            "http://8.8.8.8",
            "http://[2001:4860:4860::8888]",
            "http://user:secret@192.168.1.2",
            "file:///etc/passwd",
        ] {
            assert!(normalize_address(address).is_err(), "unexpectedly accepted {address}");
        }
    }

    #[test]
    fn prevents_route_escape_and_authority_replacement() {
        let base = normalize_address("192.168.1.129").unwrap();
        assert_eq!(route_url(&base, "/api/v1/subtree").unwrap().as_str(), "http://192.168.1.129/api/v1/subtree");
        for route in ["api/v1/subtree", "//attacker.test/path", "/api/../admin", "/../secret"] {
            assert!(route_url(&base, route).is_err(), "unexpectedly accepted {route}");
        }
    }

    #[test]
    fn restricts_raw_methods_and_public_file_writes() {
        assert_eq!(raw_request_method("GET").unwrap(), Method::GET);
        assert_eq!(raw_request_method("POST").unwrap(), Method::POST);
        assert_eq!(raw_request_method("PUT").unwrap(), Method::PUT);
        for method in ["DELETE", "PATCH", "get", ""] {
            assert!(raw_request_method(method).is_err());
        }
        assert!(raw_route_allowed(&Method::POST, "/api/v1/object-method/X/run"));
        assert!(raw_route_allowed(&Method::GET, "/static/js/main.js"));
        assert!(raw_route_allowed(&Method::GET, "/files/Evil/Web/manual.pdf"));
        assert!(!raw_route_allowed(&Method::POST, "/static/js/main.js"));
        assert!(!raw_route_allowed(&Method::PUT, "/files/Evil/Web/settings.json"));
        assert!(!raw_route_allowed(&Method::GET, "/etc/passwd"));
    }

    #[test]
    fn derives_capabilities_without_trusting_missing_metadata() {
        let subtree = json!({
            "/Evil/Gui": { "value": { "DeviceName": "HeadRush Flex Prime", "AppVersion": "5.1.0" } },
            "/Evil/API/Tone3000": { "meta": { "properties": { "LoggedIn": {} }, "x-methods": { "search": {} } } },
            "/Evil/Engine/DrumsCtrl": { "meta": { "properties": { "Tempo": {}, "Kit": {} } } },
            "/Evil/Engine/FootSwitch": { "value": {} }
        });
        let base = normalize_address("headrushflexprime.local").unwrap();
        let (device, capabilities) = build_profile(&subtree, &base, 9);
        assert_eq!(device.model, "Prime Flex");
        assert_eq!(device.product_code, "HG12");
        assert_eq!(device.firmware, "5.1.0");
        assert_eq!(capabilities.object_count, 4);
        assert_eq!(capabilities.property_count, 3);
        assert_eq!(capabilities.method_count, 1);
        assert_eq!(capabilities.flags.get("tone3000"), Some(&Value::Bool(true)));
        assert_eq!(capabilities.flags.get("drums"), Some(&Value::Bool(true)));
        assert_eq!(capabilities.flags.get("looper"), Some(&Value::Bool(false)));
    }
}
