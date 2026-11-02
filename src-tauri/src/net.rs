//! Outbound HTTP for the frontend where the webview's CORS rules get in the way (provider model discovery).
//! GET only, http(s) only, bounded timeout and body size; the response is returned verbatim for the frontend to parse.
use serde::Serialize;
use std::collections::HashMap;
use std::time::Duration;

#[derive(Debug, Serialize)]
pub struct HttpGetResult {
    pub status: u16,
    pub body: String,
    pub content_type: Option<String>,
}

const MAX_BODY: usize = 8 * 1024 * 1024;

#[tauri::command]
pub async fn cmd_http_get(
    url: String,
    headers: HashMap<String, String>,
    timeout_ms: Option<u64>,
) -> Result<HttpGetResult, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|e| format!("invalid URL: {e}"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("only http(s) URLs are allowed".into());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(timeout_ms.unwrap_or(15_000).clamp(1_000, 60_000)))
        .user_agent(concat!("Opal/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?;
    let mut req = client.get(parsed);
    for (k, v) in headers {
        req = req.header(k, v);
    }
    let res = req.send().await.map_err(|e| describe(&e))?;
    let status = res.status().as_u16();
    let content_type = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let bytes = res.bytes().await.map_err(|e| describe(&e))?;
    if bytes.len() > MAX_BODY {
        return Err("response too large".into());
    }
    Ok(HttpGetResult {
        status,
        body: String::from_utf8_lossy(&bytes).into_owned(),
        content_type,
    })
}

fn describe(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        return "timed out".into();
    }
    if e.is_connect() {
        return "connection failed".into();
    }
    e.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn rejects_non_http_schemes() {
        let err = cmd_http_get("file:///etc/passwd".into(), HashMap::new(), None)
            .await
            .unwrap_err();
        assert!(err.contains("http"), "{err}");
    }

    #[tokio::test]
    async fn fetches_a_local_server_without_cors_headers() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            let mut buf = [0u8; 2048];
            let _ = sock.read(&mut buf);
            let body = r#"{"data":[{"id":"glm-5.3"}]}"#;
            let _ = write!(
                sock,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
        });
        let res = cmd_http_get(format!("http://127.0.0.1:{port}/v1/models"), HashMap::new(), Some(5_000))
            .await
            .unwrap();
        assert_eq!(res.status, 200);
        assert!(res.body.contains("glm-5.3"));
        assert_eq!(res.content_type.as_deref(), Some("application/json"));
    }
}
