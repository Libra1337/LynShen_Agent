//! Monoize（LynShen Console，https://www.lynshen.org）账号体系接入。
//!
//! 流程与 web 网关一致：注册 / 登录（网关开了内置 PoW 验证码，客户端直接
//! 解算，无需人工交互）→ 拿到会话 token → 自动创建一条仅桌面端使用的
//! API key（auth.json `providers.monoize`，界面不展示、不可复制）→
//! 模型广场走会话接口（服务端按登录用户的分组过滤）。
//!
//! key 的"仅客户端可用"约束：key 由登录流程自动轮换生成，保存于本机凭据
//! 文件且任何界面都不显示；退出登录时在网关侧删除。网关目前没有按客户端
//! 绑定的强校验，如需服务端强约束可给 key 配 ip 白名单（见 docs）。

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::PathBuf;

const BASE: &str = "https://www.lynshen.org/api";
/// 登录流程自动创建的 key 名字，轮换时按名删除重建。
const KEY_NAME: &str = "lynshen-desktop";

fn session_path() -> PathBuf {
    crate::lynshen_dir().join("monoize-session.json")
}

fn http() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_secs(30))
        .build()
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
    let agent = http();
    let challenge: Value = agent
        .post(&format!("{BASE}/dashboard/captcha/challenge"))
        .call()
        .map_err(|e| format!("captcha challenge failed: {e}"))?
        .into_json()
        .map_err(|e| e.to_string())?;
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

    let redeem: Value = agent
        .post(&format!("{BASE}/dashboard/captcha/redeem"))
        .send_json(json!({ "token": token, "solutions": solutions }))
        .map_err(|e| format!("captcha redeem failed: {e}"))?
        .into_json()
        .map_err(|e| e.to_string())?;
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
    crate::set_auth_key("monoize".to_string(), key.to_string())
}

/// 登录后调用：删掉旧的桌面 key，创建新的并写入凭据文件。
/// 相同模型出现在多个分组/渠道时网关要求显式选择：绑定一律取第一个
/// 选项；同时为每个 (模型, 分组) 生成一条字面量重写规则，让桌面端的
/// `模型@分组` 名字（跨分组同名模型的区分后缀）重写回基础名。
/// 返回 (key_id, key)。
fn provision_desktop_key(session_token: &str) -> Result<(String, String), String> {
    let agent = http();
    let auth = format!("Bearer {session_token}");

    let listed: Value = agent
        .get(&format!("{BASE}/dashboard/tokens"))
        .set("Authorization", &auth)
        .call()
        .map_err(|e| format!("list tokens failed: {e}"))?
        .into_json()
        .map_err(|e| e.to_string())?;
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
        let _ = agent
            .delete(&format!("{BASE}/dashboard/tokens/{id}"))
            .set("Authorization", &auth)
            .call();
    }

    // 渠道歧义：同一 (分组, 模型) 有多个渠道时，取第一个渠道绑定。
    let conflicts: Value = agent
        .get(&format!("{BASE}/dashboard/tokens/channel-conflicts"))
        .set("Authorization", &auth)
        .call()
        .map_err(|e| format!("list channel conflicts failed: {e}"))?
        .into_json()
        .map_err(|e| e.to_string())?;
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

    // `模型@分组` → 基础名 的字面量重写规则（网关的 replace 不支持捕获组，
    // 且每把 key 最多 32 条）。只有跨分组同名模型需要后缀区分，所以只为
    // 出现在 2 个及以上分组里的模型生成规则。
    let groups: Value = agent
        .get(&format!("{BASE}/dashboard/groups"))
        .set("Authorization", &auth)
        .call()
        .map_err(|e| format!("list groups failed: {e}"))?
        .into_json()
        .map_err(|e| e.to_string())?;
    let mut group_models: Vec<(String, Vec<String>)> = Vec::new();
    let mut model_group_count: std::collections::BTreeMap<String, usize> = Default::default();
    for group in groups["groups"].as_array().cloned().unwrap_or_default() {
        let (Some(group_id), Some(group_name)) = (
            group["id"].as_str().map(String::from),
            group["name"].as_str().map(String::from),
        ) else {
            continue;
        };
        let models: Value = agent
            .get(&format!(
                "{BASE}/dashboard/marketplace/models?group_id={group_id}"
            ))
            .set("Authorization", &auth)
            .call()
            .map_err(|e| format!("list group models failed: {e}"))?
            .into_json()
            .map_err(|e| e.to_string())?;
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
    for (group_name, names) in &group_models {
        for model in names {
            if model_group_count.get(model).copied().unwrap_or(0) < 2 {
                continue;
            }
            if model_redirects.len() >= 32 {
                break;
            }
            model_redirects.push(json!({
                "pattern": format!("^{}@{}$", regex_escape(model), regex_escape(group_name)),
                "replace": model,
            }));
        }
    }

    let created: Value = agent
        .post(&format!("{BASE}/dashboard/tokens"))
        .set("Authorization", &auth)
        .send_json(json!({
            "name": KEY_NAME,
            "channel_bindings": channel_bindings,
            "model_redirects": model_redirects,
        }))
        .map_err(extract_error_message)?
        .into_json()
        .map_err(|e| e.to_string())?;
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

/// 把网关 4xx/5xx 响应体里的错误信息透出来（登录失败原因等）。
fn extract_error_message(e: ureq::Error) -> String {
    let body = e
        .into_response()
        .and_then(|r| r.into_json::<Value>().ok());
    if let Some(v) = body {
        if let Some(message) = v["message"].as_str() {
            return message.to_string();
        }
        return v.to_string();
    }
    "network error".to_string()
}

fn auth_call(method: &str, path: &str, token: &str, body: Option<Value>) -> Result<Value, String> {
    let agent = http();
    let req = agent.request(method, &format!("{BASE}{path}")).set("Authorization", &format!("Bearer {token}"));
    let resp = match body {
        Some(payload) => req
            .send_json(payload)
            .map_err(|e| format!("{path} failed: {e}"))?,
        None => req
            .call()
            .map_err(|e| format!("{path} failed: {e}"))?,
    };
    resp.into_json::<Value>().map_err(|e| e.to_string())
}

/// 校验本地会话仍有效；失效时清掉本地状态并返回 None。
fn current_session() -> Result<Option<Value>, String> {
    let session = read_session();
    let token = session["token"].as_str().map(String::from);
    let Some(token) = token else {
        return Ok(None);
    };
    match auth_call("GET", "/dashboard/auth/me", &token, None) {
        Ok(me) => Ok(Some(json!({
            "token": token,
            "user": me.get("user").cloned().unwrap_or(me),
            "key_id": session["key_id"].clone(),
        }))),
        Err(_) => {
            // 会话过期：清本地，但保留 providers.monoize 的 key（还能直接调
            // /v1，余额可见），下次登录再轮换。
            Ok(None)
        }
    }
}

// ---------- Tauri commands ----------

/// 注册（与 web 相同的规则：3-22 位字母数字下划线，密码 ≥8 位，PoW 验证码）。
#[tauri::command(async)]
pub fn monoize_register(username: String, password: String) -> Result<Value, String> {
    register_or_login("/dashboard/auth/register", username, password)
}

/// 登录：会话 token + 自动轮换桌面专用 key。
#[tauri::command(async)]
pub fn monoize_login(username: String, password: String) -> Result<Value, String> {
    register_or_login("/dashboard/auth/login", username, password)
}

fn register_or_login(path: &str, username: String, password: String) -> Result<Value, String> {
    let captcha = solve_captcha()?;
    let agent = http();
    let resp: Value = agent
        .post(&format!("{BASE}{path}"))
        .send_json(json!({
            "username": username,
            "password": password,
            "captcha_token": captcha,
        }))
        .map_err(extract_error_message)?
        .into_json()
        .map_err(|e| e.to_string())?;
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
    if let (Some(token), Some(key_id)) = (
        session["token"].as_str(),
        session["key_id"].as_str(),
    ) {
        let _ = auth_call("DELETE", &format!("/dashboard/tokens/{key_id}"), token, None);
    }
    clear_session();
    crate::remove_auth_key("monoize".to_string())
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
    let session = current_session()?
        .ok_or("not logged in")?;
    let token = session["token"].as_str().ok_or("missing session token")?;
    let groups: Value = auth_call("GET", "/dashboard/groups", token, None)?;
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
        let models = auth_call(
            "GET",
            &format!("/dashboard/marketplace/models?group_id={group_id}"),
            token,
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
            if let Some(groups) = entry.get_mut("groups").and_then(|g| g.as_array_mut()) {
                if !groups.iter().any(|g| g == &json!(group_name)) {
                    groups.push(json!(group_name));
                }
            }
        }
    }
    Ok(json!(Value::Array(by_model.into_values().collect::<Vec<_>>())))
}
