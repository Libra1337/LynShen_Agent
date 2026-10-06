//! Serves local HTML so the embedded browser can preview what an agent wrote.
//!
//! The browser only loads http(s) (see `browser::normalize_url`), and a
//! `file://` page cannot load its own relative scripts and styles in WKWebView.
//! A preview therefore gets a loopback URL `http://127.0.0.1:<port>/<token>/<id>/<file>`:
//! `<token>` is random per launch, `<id>` names one shared directory (the
//! HTML file's own folder), and paths that leave that folder are refused.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, OnceLock};

struct Server {
    port: u16,
    token: String,
    roots: Mutex<HashMap<String, PathBuf>>,
}

fn random_hex(bytes: usize) -> Result<String, String> {
    let mut buffer = vec![0u8; bytes];
    getrandom::getrandom(&mut buffer).map_err(|e| e.to_string())?;
    Ok(buffer.iter().map(|b| format!("{b:02x}")).collect())
}

fn server() -> Result<&'static Server, String> {
    static SERVER: OnceLock<Result<Server, String>> = OnceLock::new();
    SERVER
        .get_or_init(|| {
            let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
            let port = listener.local_addr().map_err(|e| e.to_string())?.port();
            let token = random_hex(16)?;
            std::thread::spawn(move || {
                for stream in listener.incoming().flatten() {
                    std::thread::spawn(move || {
                        let _ = handle(stream);
                    });
                }
            });
            Ok(Server {
                port,
                token,
                roots: Mutex::new(HashMap::new()),
            })
        })
        .as_ref()
        .map_err(Clone::clone)
}

fn content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "wasm" => "application/wasm",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "mp4" => "video/mp4",
        "mp3" => "audio/mpeg",
        "txt" | "md" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn percent_decode(path: &str) -> String {
    let bytes = path.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(value) = u8::from_str_radix(&path[i + 1..i + 3], 16) {
                out.push(value);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The file a request names inside `root`, or None when it leaves it.
fn resolve(root: &Path, relative: &str) -> Option<PathBuf> {
    let mut path = root.to_path_buf();
    for component in Path::new(relative).components() {
        match component {
            Component::Normal(part) => path.push(part),
            Component::CurDir => {}
            _ => return None,
        }
    }
    let canonical = path.canonicalize().ok()?;
    canonical.starts_with(root).then_some(canonical)
}

fn respond(stream: &mut TcpStream, status: &str, kind: &str, body: &[u8]) -> std::io::Result<()> {
    write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        body.len()
    )?;
    stream.write_all(body)
}

fn handle(mut stream: TcpStream) -> std::io::Result<()> {
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut line = String::new();
    reader.read_line(&mut line)?;
    let mut header = String::new();
    while reader.read_line(&mut header)? > 2 {
        header.clear();
    }
    let Ok(server) = server() else {
        return Ok(());
    };
    let target = line.split(' ').nth(1).unwrap_or("/");
    let path = percent_decode(target.split(['?', '#']).next().unwrap_or("/"));
    let mut parts = path.trim_start_matches('/').splitn(3, '/');
    let (token, id, relative) = (
        parts.next().unwrap_or(""),
        parts.next().unwrap_or(""),
        parts.next().unwrap_or(""),
    );
    let root = (token == server.token)
        .then(|| server.roots.lock().ok()?.get(id).cloned())
        .flatten();
    let Some(file) = root.and_then(|root| resolve(&root, relative)) else {
        return respond(&mut stream, "404 Not Found", "text/plain", b"not found");
    };
    let file = if file.is_dir() { file.join("index.html") } else { file };
    let mut body = Vec::new();
    match std::fs::File::open(&file).and_then(|mut f| f.read_to_end(&mut body)) {
        Ok(_) => respond(&mut stream, "200 OK", content_type(&file), &body),
        Err(_) => respond(&mut stream, "404 Not Found", "text/plain", b"not found"),
    }
}

/// The loopback URL that shows `path` (an .html/.htm file) in the embedded
/// browser, sharing only the file's own directory.
#[tauri::command]
pub fn preview_url(path: String) -> Result<String, String> {
    let file = PathBuf::from(&path)
        .canonicalize()
        .map_err(|e| format!("{path}: {e}"))?;
    let is_html = file
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("html") || e.eq_ignore_ascii_case("htm"));
    if !is_html || !file.is_file() {
        return Err("only .html files can be previewed".into());
    }
    let root = file.parent().ok_or("no parent directory")?.to_path_buf();
    let server = server()?;
    let mut roots = server.roots.lock().map_err(|e| e.to_string())?;
    let id = match roots.iter().find(|(_, dir)| **dir == root) {
        Some((id, _)) => id.clone(),
        None => {
            let id = random_hex(8)?;
            roots.insert(id.clone(), root);
            id
        }
    };
    let name = file.file_name().and_then(|n| n.to_str()).unwrap_or("index.html");
    let encoded: String = name
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect();
    Ok(format!(
        "http://127.0.0.1:{}/{}/{id}/{encoded}",
        server.port, server.token
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn get(url: &str) -> (u16, String) {
        let rest = url.strip_prefix("http://").unwrap();
        let (host, path) = rest.split_once('/').unwrap();
        let mut stream = TcpStream::connect(host).unwrap();
        write!(stream, "GET /{path} HTTP/1.1\r\nHost: {host}\r\n\r\n").unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        let status = response[9..12].parse().unwrap();
        let body = response.split("\r\n\r\n").nth(1).unwrap_or("").to_string();
        (status, body)
    }

    #[test]
    fn serves_the_page_and_its_folder_but_nothing_outside() {
        let dir = std::env::temp_dir().join(format!("lynshen-preview-{}", std::process::id()));
        let site = dir.join("site");
        std::fs::create_dir_all(&site).unwrap();
        std::fs::write(site.join("鹈鹕 bike.html"), "<script src=app.js></script>").unwrap();
        std::fs::write(site.join("app.js"), "ok()").unwrap();
        std::fs::write(dir.join("secret.txt"), "secret").unwrap();

        let url = preview_url(site.join("鹈鹕 bike.html").display().to_string()).unwrap();
        assert!(url.starts_with("http://127.0.0.1:"));
        assert_eq!(get(&url).1, "<script src=app.js></script>");
        let base = url.rsplit_once('/').unwrap().0;
        assert_eq!(get(&format!("{base}/app.js")), (200, "ok()".to_string()));
        assert_eq!(get(&format!("{base}/../secret.txt")).0, 404);
        assert_eq!(get(&format!("{base}/%2e%2e/secret.txt")).0, 404);
        let (prefix, rest) = base.split_once("/127.0.0.1:").unwrap();
        let port_and_token = rest.splitn(2, '/').collect::<Vec<_>>();
        let wrong_token = format!("{prefix}/127.0.0.1:{}/wrong/x/app.js", port_and_token[0]);
        assert_eq!(get(&wrong_token).0, 404);
        assert!(preview_url(dir.join("secret.txt").display().to_string()).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
