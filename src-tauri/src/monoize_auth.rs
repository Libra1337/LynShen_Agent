//! Monoize（LynShen Console）账号体系接入。
//!
//! 流程与 web 网关一致：注册 / 登录（网关开了内置 PoW 验证码，客户端直接
//! 解算，无需人工交互）→ 拿到会话 token → 自动创建一条仅桌面端使用的
//! API key（auth.json `providers.monoize`，界面不展示、不可复制）→
//! 模型广场走会话接口（服务端按登录用户的分组过滤）。
//!
//! 网关有多个等价域名（防止一条突然无法连接）：请求依次尝试，只有网络层
//! 失败（超时 / DNS / 拒绝连接）才切换下一个，网关自身返回的 4xx/5xx
//! 原样透出。上次成功的域名优先。
//!
//! key 的“仅客户端可用”约束：key 由登录流程自动轮换生成，保存于本机凭据
//! 文件且任何界面都不显示；退出登录时在网关侧删除。网关目前没有按客户端
//! 绑定的强校验，如需服务端强约束可给 key 配 ip 白名单（见 docs）。

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

/// 等价的网关域名，按序容灾。
pub(crate) const BASES: [&str; 3] = [
    "https://www.lynshen.org",
    "https://api.lynshen.org",
    "https://lynshen.org",
];
/// 上次成功的域名下标（失败切换后更新）。
static BASE_INDEX: AtomicUsize = AtomicUsize::new(0);
/// 登录流程自动创建的 key 名字，轮换时按名删除重建。
const KEY_NAME: &str = "lynshen-desktop";

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

// ---------- 内置 PoW 验证码（与网关 captcha.rs 的算法一致） ----------

fn fnv1a_resume(mut hash: u32, input: &[u8]) -> u32 {
    for &byte in input {
        hash ^= u32::from(byte);
        hash = hash
            .wrapping_add(hash << 1)
            .wrapping_add(hash << 4)
            .wrapping_add(hash << 7)
            .wrapping_add(hash << 8)
            .wrapping_add(hash << 24);
    }
    hash
}

fn fnv1a(input: &[u8]) -> u32 {
    fnv1a_resume(2_166_136_261, input)
}

/// xorshift32，逐轮以 %08x 拼接再截断到 `len` 个十六进制字符。
fn prng_hex(mut state: u32, len: usize) -> String {
    let mut out = String::with_capacity(len + 8);
    while out.len() < len {
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        out.push_str(&format!("{state:08x}"));
    }
    out.truncate(len);
    out
}

fn hex_nibble(byte: u8) -> u8 {
    match byte {
        b'0'..=b'9' => byte - b'0',
        b'a'..=b'f' => byte - b'a' + 10,
        b'A'..=b'F' => byte - b'A' + 10,
        _ => 0xff,
    }
}

fn digest_matches(digest: &[u8], target_hex: &str) -> bool {
    target_hex.bytes().enumerate().all(|(i, expected)| {
        let byte = digest[i / 2];
        let actual = if i % 2 == 0 { byte >> 4 } else { byte & 0x0f };
        actual == hex_nibble(expected)
    })
}

/// 拉一道挑战并解算，返回可直接随登录/注册提交的 captcha token。
fn solve_captcha() -> Result<String, String> {
    let challenge: Value = api_call("POST", "/api/dashboard/captcha/challenge", None, None)?;
    let token = challenge["token"]
        .as_str()
        .ok_or("captcha challenge has no token")?
        .to_string();
    let count = challenge["challenge"]["c"].as_u64().unwrap_or(50) as usize;
    let size = challenge["challenge"]["s"].as_u64().unwrap_or(32) as usize;
    let difficulty = challenge["challenge"]["d"].as_u64().unwrap_or(3) as usize;
    if count == 0 || count > 1000 || size == 0 || size > 128 || difficulty == 0 || difficulty > 8 {
        return Err("captcha challenge parameters out of range".into());
    }

    let token_hash = fnv1a(token.as_bytes());
    let solutions: Vec<u64> = (0..count)
        .map(|index| {
            let idx = (index + 1).to_string();
            let salt_seed = fnv1a_resume(token_hash, idx.as_bytes());
            let target_seed = fnv1a_resume(salt_seed, b"d");
            let salt = prng_hex(salt_seed, size);
            let target = prng_hex(target_seed, difficulty);
            let mut solution: u64 = 0;
            loop {
                let digest = Sha256::digest(format!("{salt}{solution}").as_bytes());
                if digest_matches(&digest, &target) {
                    return solution;
                }
                solution += 1;
            }
        })
        .collect();

    let redeem: Value = api_call(
        "POST",
        "/api/dashboard/captcha/redeem",
        None,
        Some(json!({ "token": token, "solutions": solutions })),
    )?;
    if redeem["success"] != json!(true) {
        return Err("captcha redeem rejected the solutions".into());
    }
    redeem["token"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "captcha redeem returned no token".into())
}

// ---------- 会话与 key 的本地存储 ----------

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

/// 转义正则元字符，让模型/分组名按字面匹配。
fn regex_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if "\\.^$|?*+()[]{}".contains(c) {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// 登录后调用：删掉旧的桌面 key，创建新的并写入凭据文件。
/// 相同模型出现在多个分组/渠道时网关要求显式选择：绑定一律取第一个
/// 选项；同时为跨分组同名模型生成 `模型@分组` → 基础名 的字面量重写
/// 规则（网关的 replace 不支持捕获组，每把 key 上限 32 条）。
/// 返回 (key_id, key)。
fn provision_desktop_key(session_token: &str) -> Result<(String, String), String> {
    // api_call 内部统一加 "Bearer " 前缀，这里传裸 token。
    let bearer = session_token.to_string();

    let listed: Value = api_call("GET", "/api/dashboard/tokens", Some(&bearer), None)
        .map_err(|e| format!("list tokens failed: {e}"))?;
    // 旧 key 的明文只在创建时返回一次，轮换 = 删旧建新。
    let stale: Vec<String> = listed
        .as_array()
        .map(|rows| {
            rows.iter()
                .filter(|row| row["name"].as_str() == Some(KEY_NAME))
                .filter_map(|row| row["id"].as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    for id in stale {
        let _ = api_call("DELETE", &format!("/api/dashboard/tokens/{id}"), Some(&bearer), None);
    }

    // 渠道歧义：同一 (分组, 模型) 有多个渠道时，取第一个渠道绑定。
    let conflicts: Value =
        api_call("GET", "/api/dashboard/tokens/channel-conflicts", Some(&bearer), None)
            .map_err(|e| format!("list channel conflicts failed: {e}"))?;
    let channel_bindings: Vec<Value> = conflicts
        .as_array()
        .map(|rows| {
            rows.iter()
                .filter_map(|row| {
                    let channel = row["options"].get(0)?["channel_id"].as_str()?;
                    Some(json!({
                        "group_id": row["group_id"],
                        "model": row["model"],
                        "channel_id": channel,
                    }))
                })
                .collect()
        })
        .unwrap_or_default();

    // 分组歧义：同一模型出现在多个分组时，网关要求为每个歧义模型选定
    // 分组——取第一个分组绑定。
    let model_conflicts: Value =
        api_call("GET", "/api/dashboard/tokens/model-conflicts", Some(&bearer), None)
            .map_err(|e| format!("list model conflicts failed: {e}"))?;
    let model_bindings: Vec<Value> = model_conflicts
        .as_array()
        .map(|rows| {
            rows.iter()
                .filter_map(|row| {
                    let group = row["options"].get(0)?["group_id"].as_str()?;
                    let model = row["model"].as_str()?;
                    Some(json!({ "model": model, "group_id": group }))
                })
                .collect()
        })
        .unwrap_or_default();

    // 逐分组拉模型，只为跨分组同名模型生成后缀重写规则（上限 32 条）。
    let groups: Value = api_call("GET", "/api/dashboard/groups", Some(&bearer), None)
        .map_err(|e| format!("list groups failed: {e}"))?;
    let mut group_models: Vec<(String, Vec<String>)> = Vec::new();
    let mut model_group_count: std::collections::BTreeMap<String, usize> = Default::default();
    for group in groups["groups"].as_array().cloned().unwrap_or_default() {
        let (Some(group_id), Some(group_name)) = (
            group["id"].as_str().map(String::from),
            group["name"].as_str().map(String::from),
        ) else {
            continue;
        };
        let models: Value = api_call(
            "GET",
            &format!("/api/dashboard/marketplace/models?group_id={group_id}"),
            Some(&bearer),
            None,
        )
        .map_err(|e| format!("list group models failed: {e}"))?;
        let mut names = Vec::new();
        for row in models.as_array().cloned().unwrap_or_default() {
            if let Some(model) = row["model_id"].as_str() {
                *model_group_count.entry(model.to_string()).or_default() += 1;
                names.push(model.to_string());
            }
        }
        group_models.push((group_name, names));
    }
    let mut model_redirects: Vec<Value> = Vec::new();
    'outer: for (group_name, names) in &group_models {
        for model in names {
            if model_group_count.get(model).copied().unwrap_or(0) < 2 {
                continue;
            }
            if model_redirects.len() >= 32 {
                break 'outer;
            }
            model_redirects.push(json!({
                "pattern": format!("^{}@{}$", regex_escape(model), regex_escape(group_name)),
                "replace": model,
            }));
        }
    }

    let created: Value = api_call(
        "POST",
        "/api/dashboard/tokens",
        Some(&bearer),
        Some(json!({
            "name": KEY_NAME,
            "channel_bindings": channel_bindings,
            "model_bindings": model_bindings,
            "model_redirects": model_redirects,
        })),
    )?;
    let key = created["key"]
        .as_str()
        .ok_or("gateway returned no key")?
        .to_string();
    let id = created["id"]
        .as_str()
        .ok_or("gateway returned no key id")?
        .to_string();
    store_api_key(&key)?;
    Ok((id, key))
}

/// 校验本地会话仍有效；失效时清掉本地状态并返回 None。
fn current_session() -> Result<Option<Value>, String> {
    let session = read_session();
    let Some(token) = session["token"].as_str().map(String::from) else {
        return Ok(None);
    };
    match api_call("GET", "/api/dashboard/auth/me", Some(&token), None) {
        Ok(me) => Ok(Some(json!({
            "token": token,
            "user": me.get("user").cloned().unwrap_or(me),
            "key_id": session["key_id"].clone(),
        }))),
        Err(_) => {
            // 会话过期（或网关暂不可达）：清本地，但保留 providers.monoize 的
            // key（还能直接调 /v1，余额可见），下次登录再轮换。
            Ok(None)
        }
    }
}

// ---------- Tauri commands ----------

/// 注册（与 web 相同的规则：3-22 位字母数字下划线，密码 ≥8 位，PoW 验证码）。
#[tauri::command(async)]
pub fn monoize_register(username: String, password: String) -> Result<Value, String> {
    register_or_login("/api/dashboard/auth/register", username, password)
}

/// 登录：会话 token + 自动轮换桌面专用 key。
#[tauri::command(async)]
pub fn monoize_login(username: String, password: String) -> Result<Value, String> {
    register_or_login("/api/dashboard/auth/login", username, password)
}

fn register_or_login(path: &str, username: String, password: String) -> Result<Value, String> {
    let captcha = solve_captcha()?;
    let resp: Value = api_call(
        "POST",
        path,
        None,
        Some(json!({
            "username": username,
            "password": password,
            "captcha_token": captcha,
        })),
    )?;
    let token = resp["token"]
        .as_str()
        .ok_or("gateway returned no session token")?
        .to_string();
    let (key_id, _key) = provision_desktop_key(&token)?;
    let user = resp.get("user").cloned().unwrap_or(Value::Null);
    write_session(&json!({
        "token": token,
        "username": user["username"].clone(),
        "user_id": user["id"].clone(),
        "key_id": key_id,
    }))?;
    Ok(json!({ "user": user, "key_id": key_id }))
}

/// 退出登录：网关侧删除桌面 key，清空本地会话与凭据。
#[tauri::command(async)]
pub fn monoize_logout() -> Result<(), String> {
    let session = read_session();
    if let (Some(token), Some(key_id)) = (session["token"].as_str(), session["key_id"].as_str()) {
        let _ = api_call(
            "DELETE",
            &format!("/api/dashboard/tokens/{key_id}"),
            Some(token),
            None,
        );
    }
    clear_session();
    crate::remove_provider_credential("monoize".to_string())
}

/// 当前登录态：无会话返回 `{"logged_in": false}`。
#[tauri::command(async)]
pub fn monoize_session() -> Result<Value, String> {
    match current_session()? {
        Some(session) => Ok(json!({ "logged_in": true, "session": session })),
        None => Ok(json!({ "logged_in": false })),
    }
}

/// 模型广场：登录用户各分组内可调用的模型（服务端过滤）。逐分组拉取并
/// 合并，`groups` 记录模型出现的分组——跨分组同名模型由前端以 `模型@分组`
/// 区分；分组列表随 `groups` 一并返回。
#[tauri::command(async)]
pub fn monoize_marketplace() -> Result<Value, String> {
    let session = current_session()?.ok_or("not logged in")?;
    let token = session["token"].as_str().ok_or("missing session token")?;
    let groups: Value = api_call("GET", "/api/dashboard/groups", Some(token), None)?;
    let group_list: Vec<(String, String)> = groups["groups"]
        .as_array()
        .map(|rows| {
            rows.iter()
                .filter_map(|g| {
                    let id = g["id"].as_str()?;
                    let name = g["name"].as_str()?;
                    Some((id.to_string(), name.to_string()))
                })
                .collect()
        })
        .unwrap_or_default();

    let mut by_model: std::collections::BTreeMap<String, Value> = Default::default();
    for (group_id, group_name) in &group_list {
        let models = api_call(
            "GET",
            &format!("/api/dashboard/marketplace/models?group_id={group_id}"),
            Some(token),
            None,
        )?;
        for row in models.as_array().cloned().unwrap_or_default() {
            let Some(model_id) = row["model_id"].as_str() else { continue };
            let entry = by_model.entry(model_id.to_string()).or_insert_with(|| {
                let mut first = row.clone();
                if let Some(obj) = first.as_object_mut() {
                    obj.insert("groups".to_string(), json!([]));
                }
                first
            });
            if let Some(group_names) = entry.get_mut("groups").and_then(|g| g.as_array_mut()) {
                if !group_names.iter().any(|g| g == &json!(group_name)) {
                    group_names.push(json!(group_name));
                }
            }
        }
    }
    Ok(json!(Value::Array(
        by_model.into_values().collect::<Vec<_>>()
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 对真实网关跑完整登录链路（与前端 invoke 的是同一批函数）：
    /// PoW 验证码 → 登录 → 自动建 key（含歧义绑定）→ key 级接口 → 登出吊销。
    /// 依赖外网与网关在线；跑完即清理，不留会话与 key。
    #[test]
    fn full_login_roundtrip_against_live_gateway() {
        // 注册（若已存在则登录）一个一次性账号。
        let username = format!("mztest{}", std::process::id() % 100000);
        let password = "LynShenDesk-Test-2026";
        let outcome = register_or_login(
            "/api/dashboard/auth/register",
            username.clone(),
            password.to_string(),
        )
        .or_else(|_| {
            register_or_login(
                "/api/dashboard/auth/login",
                username.clone(),
                password.to_string(),
            )
        })
        .expect("register or login");
        assert!(outcome["user"]["username"].as_str() == Some(username.as_str()));

        // 会话可查。
        let session = current_session().expect("session read").expect("logged in");
        assert_eq!(session["user"]["username"].as_str(), Some(username.as_str()));

        // 登录流程应已把仅客户端 key 写进 auth.json 的 providers.monoize。
        let key = crate::read_auth()["providers"]["monoize"]
            .as_str()
            .expect("providers.monoize stored")
            .to_string();
        assert!(key.starts_with("sk-"));

        // key 级接口（走同一条容灾请求层）。
        let balance = gateway_key_get("/user/balance").expect("balance via key");
        assert!(balance["balance_infos"].is_array());
        let models = gateway_key_get("/v1/models").expect("models via key");
        assert!(models["data"].as_array().map(|a| !a.is_empty()).unwrap_or(false));

        // 模型广场（会话级，服务端按分组过滤）。
        let square = monoize_marketplace().expect("marketplace");
        assert!(square.as_array().map(|a| !a.is_empty()).unwrap_or(false));

        // 登出：网关侧删 key、清本地。
        monoize_logout().expect("logout");
        assert!(read_session().get("token").is_none());
        assert!(crate::read_auth()["providers"]["monoize"].is_null());
    }
}
