//! Isolated CLI login process; draft sessions and their engines are untouched.
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader},
    process::{Child, Command, Stdio},
    sync::{mpsc, Mutex, OnceLock},
    time::{Duration, Instant},
};

struct Attempt {
    id: String,
    child: Child,
    events: mpsc::Receiver<Value>,
    state: Value,
    started: Instant,
}
impl Drop for Attempt {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
fn pending() -> &'static Mutex<Option<Attempt>> {
    static PENDING: OnceLock<Mutex<Option<Attempt>>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(None))
}

fn allowed(provider: &str) -> bool {
    matches!(provider, "openai-codex" | "anthropic")
}

#[tauri::command(async)]
pub fn provider_oauth_start(provider: String) -> Result<String, String> {
    if !allowed(&provider) {
        return Err("Unsupported OAuth provider".into());
    }
    let mut guard = pending().lock().unwrap_or_else(|e| e.into_inner());
    if guard.is_some() {
        return Err("An authorization is already in progress".into());
    }
    let mut cmd = Command::new(crate::resolve_bin());
    crate::no_window(&mut cmd);
    crate::shell_env::apply_to_command(&mut cmd, true, &[], &[]);
    let mut child = cmd
        .args(["auth-login", &provider])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    let stdout = child.stdout.take().ok_or("Login output unavailable")?;
    let (tx, events) = mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Ok(value) = serde_json::from_str::<Value>(&line) {
                if tx.send(value).is_err() {
                    break;
                }
            }
        }
    });
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    let id = NEXT
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        .to_string();
    *guard = Some(Attempt {
        id: id.clone(),
        child,
        events,
        state: json!({"status":"starting"}),
        started: Instant::now(),
    });
    Ok(id)
}

#[tauri::command(async)]
pub fn provider_oauth_poll(id: String) -> Result<Value, String> {
    let mut guard = pending().lock().unwrap_or_else(|e| e.into_inner());
    let attempt = guard
        .as_mut()
        .filter(|a| a.id == id)
        .ok_or("Authorization canceled")?;
    loop {
        match attempt.events.try_recv() {
            Ok(value) => attempt.state = value,
            Err(mpsc::TryRecvError::Empty) => break,
            Err(mpsc::TryRecvError::Disconnected) => {
                if !matches!(attempt.state["status"].as_str(), Some("complete" | "error")) {
                    attempt.state = json!({"status":"error", "message":"Login process ended. Update the bundled CLI and try again."});
                }
                break;
            }
        }
    }
    if attempt.started.elapsed() > Duration::from_secs(360) {
        attempt.state = json!({"status":"error", "message":"Authorization expired. Try again."});
    }
    let state = attempt.state.clone();
    if matches!(state["status"].as_str(), Some("complete" | "error")) {
        *guard = None;
    }
    Ok(state)
}

#[tauri::command(async)]
pub fn provider_oauth_cancel(id: String) {
    let mut guard = pending().lock().unwrap_or_else(|e| e.into_inner());
    if guard.as_ref().is_some_and(|a| a.id == id) {
        *guard = None;
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn api_key_providers_and_shell_arguments_are_rejected() {
        assert!(super::allowed("openai-codex"));
        assert!(super::allowed("anthropic"));
        assert!(!super::allowed("openai"));
        assert!(!super::allowed("--help"));
    }
}
