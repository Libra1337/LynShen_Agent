//! 诊断：桌面端 Rust HTTP 栈（ureq/rustls）到各网关域名的连通性。
//! `cargo test --test gateway_reach -- --nocapture`
use std::time::Instant;

#[test]
fn gateway_domains_reachable_from_ureq() {
    for base in ["https://www.lynshen.org", "https://api.lynshen.org", "https://lynshen.org"] {
        let t = Instant::now();
        let r = ureq::get(&format!("{base}/api/public/site"))
            .timeout(std::time::Duration::from_secs(15))
            .call();
        match r {
            Ok(resp) => {
                let v: serde_json::Value = resp.into_json().unwrap();
                println!("{base} -> OK in {:?} site={}", t.elapsed(), v["site_name"]);
            }
            Err(e) => println!("{base} -> ERR in {:?}: {e}", t.elapsed()),
        }
    }
}
