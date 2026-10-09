//! Whether Claude Code / Codex can run on an account of their own. A coding
//! agent that is installed but signed in nowhere only takes room in the
//! pickers, so they list it once this says yes. Only presence is checked:
//! no secret is read or kept.
use serde_json::Value;
use std::path::{Path, PathBuf};

/// Where to look: the home folder and the environment (injectable for tests).
pub(crate) struct Probe<'a> {
    pub home: PathBuf,
    pub env: &'a dyn Fn(&str) -> Option<String>,
}

impl Probe<'_> {
    fn var(&self, name: &str) -> bool {
        (self.env)(name).is_some_and(|v| !v.trim().is_empty())
    }

    fn json(path: &Path) -> Option<Value> {
        serde_json::from_slice(&std::fs::read(path).ok()?).ok()
    }

    /// Claude Code: a claude.ai sign-in (`oauthAccount` in `.claude.json`,
    /// `.credentials.json`, the macOS keychain entry) or an API key it is set
    /// up with (environment, `settings.json` env or apiKeyHelper).
    pub fn claude(&self, keychain: impl Fn() -> bool) -> bool {
        const KEYS: [&str; 3] = [
            "ANTHROPIC_API_KEY",
            "ANTHROPIC_AUTH_TOKEN",
            "CLAUDE_CODE_OAUTH_TOKEN",
        ];
        if KEYS.iter().any(|k| self.var(k)) {
            return true;
        }
        let dir = (self.env)("CLAUDE_CONFIG_DIR")
            .filter(|d| !d.trim().is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| self.home.join(".claude"));
        let account = [self.home.join(".claude.json"), dir.join(".claude.json")]
            .iter()
            .filter_map(|p| Self::json(p))
            .any(|v| {
                v.get("oauthAccount").is_some_and(|a| !a.is_null())
                    || v.get("primaryApiKey")
                        .is_some_and(|k| k.as_str().is_some_and(|k| !k.is_empty()))
            });
        if account || dir.join(".credentials.json").is_file() {
            return true;
        }
        let settings = Self::json(&dir.join("settings.json"));
        let configured = settings.as_ref().is_some_and(|s| {
            s.get("apiKeyHelper")
                .and_then(Value::as_str)
                .is_some_and(|h| !h.trim().is_empty())
                || KEYS
                    .iter()
                    .any(|k| s["env"][k].as_str().is_some_and(|v| !v.trim().is_empty()))
        });
        configured || keychain()
    }

    /// Codex: `auth.json` holding a ChatGPT sign-in or an API key.
    pub fn codex(&self) -> bool {
        let dir = (self.env)("CODEX_HOME")
            .filter(|d| !d.trim().is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| self.home.join(".codex"));
        Self::json(&dir.join("auth.json")).is_some_and(|auth| {
            auth.get("tokens").is_some_and(|t| !t.is_null())
                || auth
                    .get("OPENAI_API_KEY")
                    .and_then(Value::as_str)
                    .is_some_and(|k| !k.trim().is_empty())
        })
    }
}

/// The macOS keychain entry Claude Code keeps its sign-in in (looked up
/// without reading it, so nothing asks for access).
fn claude_keychain() -> bool {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("security")
            .args(["find-generic-password", "-s", "Claude Code-credentials"])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .is_ok_and(|s| s.success())
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

/// Signed in for `backend` ("claude" / "codex"); None for the others.
pub(crate) fn signed_in(backend: &str) -> Option<bool> {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_default();
    let shell = crate::shell_env::snapshot_vars();
    let env = |name: &str| {
        std::env::var(name)
            .ok()
            .or_else(|| shell.as_ref()?.get(name).cloned())
    };
    let probe = Probe { home, env: &env };
    match backend {
        "claude" => Some(probe.claude(claude_keychain)),
        "codex" => Some(probe.codex()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn home(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("lynshen-tool-login-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn claude_needs_a_sign_in_or_a_key() {
        let dir = home("claude");
        let none = |_: &str| None;
        let probe = Probe {
            home: dir.clone(),
            env: &none,
        };
        // Installed and used once (approved keys, settings) but signed in nowhere.
        fs::write(
            dir.join(".claude.json"),
            r#"{"customApiKeyResponses":{"approved":[]}}"#,
        )
        .unwrap();
        assert!(!probe.claude(|| false));
        assert!(probe.claude(|| true), "the keychain entry counts");
        fs::create_dir_all(dir.join(".claude")).unwrap();
        fs::write(
            dir.join(".claude/settings.json"),
            r#"{"env":{"ANTHROPIC_AUTH_TOKEN":"x"}}"#,
        )
        .unwrap();
        assert!(probe.claude(|| false));
        fs::remove_file(dir.join(".claude/settings.json")).unwrap();
        fs::write(
            dir.join(".claude.json"),
            r#"{"oauthAccount":{"emailAddress":"a@b"}}"#,
        )
        .unwrap();
        assert!(probe.claude(|| false));
        let key = |name: &str| (name == "ANTHROPIC_API_KEY").then(|| "sk".to_string());
        let empty = home("claude-env");
        assert!(Probe {
            home: empty.clone(),
            env: &key
        }
        .claude(|| false));
        let _ = fs::remove_dir_all(dir);
        let _ = fs::remove_dir_all(empty);
    }

    #[test]
    fn codex_needs_auth_json_with_a_sign_in_or_key() {
        let dir = home("codex");
        let none = |_: &str| None;
        let probe = Probe {
            home: dir.clone(),
            env: &none,
        };
        assert!(!probe.codex());
        fs::create_dir_all(dir.join(".codex")).unwrap();
        fs::write(
            dir.join(".codex/auth.json"),
            r#"{"OPENAI_API_KEY":null,"tokens":null}"#,
        )
        .unwrap();
        assert!(!probe.codex());
        fs::write(
            dir.join(".codex/auth.json"),
            r#"{"tokens":{"id_token":"x"}}"#,
        )
        .unwrap();
        assert!(probe.codex());
        let _ = fs::remove_dir_all(dir);
    }
}
