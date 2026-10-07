//! Browser-based LynShen device authorization. Passwords stay on the website.
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/// 等价的网关域名，按序容灾。
pub(crate) const BASES: [&str; 3] = [
    "https://www.lynshen.org",
    "https://api.lynshen.org",
    "https://lynshen.org",
];
/// 上次成功的域名下标（失败切换后更新）。
static BASE_INDEX: AtomicUsize = AtomicUsize::new(0);

fn session_path() -> PathBuf {
    crate::lynshen_dir().join("monoize-session.json")
}

fn http() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_secs(15))
        .build()
}

/// 带域名容灾的网关请求。`path` 是完整路径（dashboard 接口带 `/api` 前缀，
/// key 级接口在根下）。网络层失败依次换域名；网关有应答时把响应体里的
/// `message` 作为错误返回（登录失败原因等），不再切换。
fn api_call(
    method: &str,
    path: &str,
    bearer: Option<&str>,
    body: Option<Value>,
) -> Result<Value, String> {
    let start = BASE_INDEX.load(Ordering::Relaxed);
    let mut last_network_err = String::new();
    for offset in 0..BASES.len() {
        let index = (start + offset) % BASES.len();
        let mut req = http().request(method, &format!("{}{}", BASES[index], path));
        if let Some(token) = bearer {
            req = req.set("Authorization", &format!("Bearer {token}"));
        }
        let result = match &body {
            Some(payload) => req.send_json(payload.clone()),
            None => req.call(),
        };
        match result {
            Ok(resp) => {
                BASE_INDEX.store(index, Ordering::Relaxed);
                return resp.into_json::<Value>().map_err(|e| e.to_string());
            }
            Err(ureq::Error::Status(_, resp)) => {
                // 网关有应答（含 401/409 等业务错误）：透出错误信息，不切换域名。
                BASE_INDEX.store(index, Ordering::Relaxed);
                let parsed = resp.into_json::<Value>().ok();
                return Err(match &parsed {
                    Some(v) => v["message"]
                        .as_str()
                        .map(String::from)
                        .unwrap_or_else(|| v.to_string()),
                    None => format!("gateway error via {}", BASES[index]),
                });
            }
            Err(e) => {
                last_network_err = format!("{}: {e}", BASES[index]);
            }
        }
    }
    Err(format!("all gateways unreachable ({last_network_err})"))
}

/// key 级接口（/user/balance、/v1/models）：用 auth.json 里存的 monoize key。
pub(crate) fn gateway_key_get(path: &str) -> Result<Value, String> {
    let key = crate::read_auth()
        .get("providers")
        .and_then(|p| p.get("monoize"))
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|k| !k.is_empty())
        .ok_or_else(|| "未配置 Monoize API key".to_string())?;
    api_call("GET", path, Some(&key), None)
}

fn read_session() -> Value {
    crate::read_json(&session_path())
}
fn write_session(session: &Value) -> Result<(), String> {
    crate::write_json(&session_path(), session)?;
    crate::secrets::restrict_to_owner(&session_path());
    Ok(())
}
fn clear_session() {
    let _ = std::fs::remove_file(session_path());
}
fn store_api_key(key: &str) -> Result<(), String> {
    crate::store_provider_key("monoize".to_string(), key.to_string())
}

#[derive(Clone)]
struct Authorization {
    device_code: String,
    user_code: String,
    expires: Instant,
}
fn pending() -> &'static Mutex<Option<Authorization>> {
    static PENDING: OnceLock<Mutex<Option<Authorization>>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(None))
}

#[tauri::command(async)]
pub fn monoize_oauth_start() -> Result<Value, String> {
    let mut guard = pending().lock().unwrap_or_else(|error| error.into_inner());
    if guard
        .as_ref()
        .is_some_and(|attempt| attempt.expires > Instant::now())
    {
        return Err("An authorization is already in progress".into());
    }
    let response = api_call(
        "POST",
        "/api/desktop/oauth/device",
        None,
        Some(json!({"client_id":"lynshen-desktop"})),
    )?;
    let device_code = response["device_code"]
        .as_str()
        .ok_or("Missing device code")?
        .to_string();
    let user_code = response["user_code"]
        .as_str()
        .ok_or("Missing user code")?
        .to_string();
    if user_code.len() != 12 || !user_code.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("Invalid authorization code".into());
    }
    let base = BASES[BASE_INDEX.load(Ordering::Relaxed)];
    *guard = Some(Authorization {
        device_code,
        user_code: user_code.clone(),
        expires: Instant::now() + Duration::from_secs(600),
    });
    Ok(
        json!({"user_code": user_code, "verification_uri_complete": format!("{base}/oauth/authorize?user_code={user_code}"), "interval": 5, "expires_in": 600}),
    )
}

#[tauri::command(async)]
pub fn monoize_oauth_poll(user_code: String) -> Result<Value, String> {
    let attempt = pending()
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .clone()
        .filter(|attempt| attempt.user_code == user_code)
        .ok_or("Authorization canceled")?;
    if attempt.expires <= Instant::now() {
        return Err("Authorization expired; start again".into());
    }
    let response = api_call(
        "POST",
        "/api/desktop/oauth/token",
        None,
        Some(json!({"client_id":"lynshen-desktop", "device_code": attempt.device_code})),
    )?;
    if let Some(error) = response["error"].as_str() {
        return match error {
            "authorization_pending" | "slow_down" => Ok(json!({"pending": true})),
            "access_denied" => Err("Authorization was declined in the browser".into()),
            _ => Err("Authorization expired; start again".into()),
        };
    }
    let key = response["access_token"]
        .as_str()
        .ok_or("Missing desktop access token")?;
    let mut guard = pending().lock().unwrap_or_else(|error| error.into_inner());
    if !guard
        .as_ref()
        .is_some_and(|active| active.user_code == user_code)
    {
        let _ = api_call(
            "POST",
            "/api/desktop/oauth/revoke",
            Some(key),
            Some(json!({})),
        );
        return Err("Authorization canceled".into());
    }
    let result = store_api_key(key).and_then(|()| {
        write_session(&json!({
            "kind": "device", "key_id": response["key_id"], "user": response["user"],
        }))
    });
    *guard = None;
    if let Err(error) = result {
        let _ = api_call(
            "POST",
            "/api/desktop/oauth/revoke",
            Some(key),
            Some(json!({})),
        );
        return Err(error);
    }
    Ok(json!({"user": response["user"]}))
}

#[tauri::command(async)]
pub fn monoize_oauth_cancel(user_code: String) {
    let attempt = {
        let mut guard = pending().lock().unwrap_or_else(|error| error.into_inner());
        if guard
            .as_ref()
            .is_some_and(|active| active.user_code == user_code)
        {
            guard.take()
        } else {
            None
        }
    };
    if let Some(attempt) = attempt {
        let _ = api_call(
            "POST",
            "/api/desktop/oauth/cancel",
            None,
            Some(json!({"client_id":"lynshen-desktop", "device_code": attempt.device_code})),
        );
    }
}

fn current_session() -> Result<Option<Value>, String> {
    let session = read_session();
    if session["kind"] == "device" {
        return gateway_key_get("/api/desktop/oauth/me").map(Some);
    }
    let Some(token) = session["token"].as_str() else {
        return Ok(None);
    };
    let me = api_call("GET", "/api/dashboard/auth/me", Some(token), None)?;
    Ok(Some(
        json!({"token": token, "user": me.get("user").unwrap_or(&me), "key_id": session["key_id"]}),
    ))
}

#[tauri::command(async)]
pub fn monoize_session() -> Result<Value, String> {
    match current_session()? {
        Some(session) => Ok(json!({"logged_in": true, "session": {"user": session["user"]}})),
        None => Ok(json!({"logged_in": false})),
    }
}

#[tauri::command(async)]
pub fn monoize_logout() -> Result<(), String> {
    let session = read_session();
    if session["kind"] == "device" {
        let auth = crate::read_auth();
        if let Some(key) = auth["providers"]["monoize"].as_str() {
            api_call(
                "POST",
                "/api/desktop/oauth/revoke",
                Some(key),
                Some(json!({})),
            )?;
        }
    } else if let (Some(token), Some(key_id)) =
        (session["token"].as_str(), session["key_id"].as_str())
    {
        api_call(
            "DELETE",
            &format!("/api/dashboard/tokens/{key_id}"),
            Some(token),
            None,
        )?;
    }
    clear_session();
    crate::remove_provider_credential("monoize".to_string())
}

/// 模型广场：登录用户各分组内可调用的模型（服务端过滤）。逐分组拉取并
/// 合并，`groups` 记录模型出现的分组——跨分组同名模型由前端以 `模型@分组`
/// 区分；分组列表随 `groups` 一并返回。
#[tauri::command(async)]
pub fn monoize_marketplace() -> Result<Value, String> {
    let models = gateway_key_get("/api/desktop/oauth/models")?;
    Ok(json!(models["data"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|model| {
            model["id"].as_str().map(|id| json!({
            "model_id": id, "groups": model["groups"], "routing_status": model["routing_status"],
            "providers": model["providers"]
        }))
        })
        .collect::<Vec<_>>()))
}
