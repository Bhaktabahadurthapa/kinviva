//! Streaming client for OpenAI-compatible Chat Completions endpoints
//! (`POST {base}/chat/completions` with `stream: true`, server-sent events).
//! The same client works with OpenAI and with local servers that expose this
//! API, such as Ollama (`http://localhost:11434/v1`).

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Serialize)]
pub struct ChatMessage {
    pub role: &'static str,
    pub content: String,
}

#[derive(Debug, Clone)]
pub struct LlmConfig {
    pub base_url: String,
    pub model: String,
    pub api_key: Option<String>,
    pub temperature: f32,
    /// "minimal" | "low" | "medium" | "high": how much a reasoning model thinks
    /// before answering. `None` sends nothing (the provider's default).
    pub reasoning_effort: Option<String>,
    /// Ask for a JSON object (`response_format`). Dropped and retried if the provider rejects it.
    pub json_mode: bool,
}

#[derive(Debug, PartialEq)]
pub enum LlmError {
    Cancelled,
    /// A human-readable message, safe to show (never contains the API key).
    Failed(String),
}

impl std::fmt::Display for LlmError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LlmError::Cancelled => write!(f, "Cancelled"),
            LlmError::Failed(m) => write!(f, "{m}"),
        }
    }
}

fn endpoint(base: &str, path: &str) -> String {
    format!("{}/{}", base.trim_end_matches('/'), path)
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .build()
        .expect("http client")
}

#[derive(Deserialize)]
struct ErrorBody {
    error: Option<ErrorDetail>,
}
#[derive(Deserialize)]
struct ErrorDetail {
    message: Option<String>,
}

fn describe_status(status: reqwest::StatusCode, body: &str) -> String {
    let detail = serde_json::from_str::<ErrorBody>(body)
        .ok()
        .and_then(|b| b.error)
        .and_then(|e| e.message)
        .unwrap_or_default();
    let hint = match status.as_u16() {
        401 | 403 => "The API key was rejected.",
        404 => "Endpoint or model not found. Check the base URL and model name.",
        429 => "Rate limited or out of quota.",
        500..=599 => "The provider had a server error.",
        _ => "The provider rejected the request.",
    };
    let detail: String = detail.chars().take(300).collect();
    if detail.is_empty() {
        format!("{hint} (HTTP {})", status.as_u16())
    } else {
        format!("{hint} (HTTP {}: {detail})", status.as_u16())
    }
}

#[derive(Deserialize)]
struct StreamChunk {
    #[serde(default)]
    choices: Vec<StreamChoice>,
}
#[derive(Deserialize)]
struct StreamChoice {
    #[serde(default)]
    delta: Delta,
}
#[derive(Deserialize, Default)]
struct Delta {
    #[serde(default)]
    content: Option<String>,
}

/// Incremental SSE parser: feed raw bytes, get content deltas.
#[derive(Default)]
pub struct SseParser {
    buf: String,
    pub done: bool,
}

impl SseParser {
    pub fn feed(&mut self, bytes: &[u8]) -> Result<Vec<String>, String> {
        self.buf.push_str(&String::from_utf8_lossy(bytes));
        let mut out = Vec::new();
        while let Some(nl) = self.buf.find('\n') {
            let line: String = self.buf.drain(..=nl).collect();
            let line = line.trim();
            let Some(data) = line.strip_prefix("data:") else { continue };
            let data = data.trim();
            if data == "[DONE]" {
                self.done = true;
                continue;
            }
            if data.is_empty() {
                continue;
            }
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(data) {
                if let Some(msg) = v.get("error").and_then(|e| e.get("message")).and_then(|m| m.as_str()) {
                    return Err(format!("Provider error: {msg}"));
                }
            }
            match serde_json::from_str::<StreamChunk>(data) {
                Ok(chunk) => {
                    for c in chunk.choices {
                        if let Some(t) = c.delta.content {
                            if !t.is_empty() {
                                out.push(t);
                            }
                        }
                    }
                }
                Err(_) => return Err("The provider sent a response MeetingLens could not read.".into()),
            }
        }
        Ok(out)
    }
}

async fn send_request(cfg: &LlmConfig, body: &serde_json::Value, cancel: &CancellationToken) -> Result<reqwest::Response, LlmError> {
    let mut req = client().post(endpoint(&cfg.base_url, "chat/completions")).json(body);
    if let Some(key) = &cfg.api_key {
        req = req.bearer_auth(key);
    }
    let send = async {
        req.send().await.map_err(|e| {
            if e.is_connect() {
                LlmError::Failed(format!("Could not connect to {}. Is the provider reachable?", cfg.base_url))
            } else if e.is_timeout() {
                LlmError::Failed("The AI provider timed out.".into())
            } else {
                LlmError::Failed(format!("Request failed: {}", e.without_url()))
            }
        })
    };
    tokio::select! {
        _ = cancel.cancelled() => Err(LlmError::Cancelled),
        r = send => r,
    }
}


/// Stream a completion. `on_delta` is called for each text fragment.
/// Returns the full text, or `Cancelled` if `cancel` fired first.
pub async fn stream_chat(
    cfg: &LlmConfig,
    messages: Vec<ChatMessage>,
    cancel: CancellationToken,
    mut on_delta: impl FnMut(&str),
) -> Result<String, LlmError> {
    if cfg.model.trim().is_empty() {
        return Err(LlmError::Failed("No AI model is configured. Choose one in Settings → AI.".into()));
    }
    let mut body = serde_json::json!({
        "model": cfg.model,
        "messages": messages,
        "stream": true,
        "temperature": cfg.temperature,
    });
    if cfg.json_mode {
        body["response_format"] = serde_json::json!({ "type": "json_object" });
    }
    if let Some(effort) = &cfg.reasoning_effort {
        body["reasoning_effort"] = serde_json::json!(effort);
    }
    let mut resp = send_request(cfg, &body, &cancel).await?;
    // A model that does not know an optional field answers 400; retry without
    // each one in turn rather than failing the whole request.
    for optional in ["response_format", "reasoning_effort"] {
        if resp.status() == reqwest::StatusCode::BAD_REQUEST && body.get(optional).is_some() {
            body.as_object_mut().map(|o| o.remove(optional));
            resp = send_request(cfg, &body, &cancel).await?;
        }
    }
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(LlmError::Failed(describe_status(status, &text)));
    }
    let mut stream = resp.bytes_stream();
    let mut parser = SseParser::default();
    let mut full = String::new();
    // Guard against a provider that stops sending without closing.
    let idle = Duration::from_secs(60);
    loop {
        let next = tokio::select! {
            _ = cancel.cancelled() => return Err(LlmError::Cancelled),
            n = tokio::time::timeout(idle, stream.next()) => n,
        };
        match next {
            Err(_) => return Err(LlmError::Failed("The AI provider stopped responding.".into())),
            Ok(None) => break,
            Ok(Some(Err(e))) => return Err(LlmError::Failed(format!("Connection lost while streaming: {}", e.without_url()))),
            Ok(Some(Ok(bytes))) => {
                for d in parser.feed(&bytes).map_err(LlmError::Failed)? {
                    full.push_str(&d);
                    on_delta(&d);
                }
                if parser.done {
                    break;
                }
            }
        }
    }
    if full.trim().is_empty() {
        return Err(LlmError::Failed("The AI provider returned an empty response.".into()));
    }
    Ok(full)
}

#[derive(Deserialize)]
struct ModelList {
    data: Vec<ModelEntry>,
}
#[derive(Deserialize)]
struct ModelEntry {
    id: String,
}

/// `GET {base}/models`, used to offer model choices instead of hardcoding one.
pub async fn list_models(base_url: &str, api_key: Option<&str>) -> Result<Vec<String>, String> {
    let mut req = client().get(endpoint(base_url, "models")).timeout(Duration::from_secs(15));
    if let Some(k) = api_key {
        req = req.bearer_auth(k);
    }
    let resp = req.send().await.map_err(|e| format!("Could not reach {base_url}: {}", e.without_url()))?;
    if !resp.status().is_success() {
        let s = resp.status();
        return Err(describe_status(s, &resp.text().await.unwrap_or_default()));
    }
    let list: ModelList = resp.json().await.map_err(|_| "Unexpected /models response.".to_string())?;
    let mut ids: Vec<String> = list.data.into_iter().map(|m| m.id).collect();
    ids.sort();
    Ok(ids)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[test]
    fn sse_parser_handles_split_frames() {
        let mut p = SseParser::default();
        let a = p.feed(b"data: {\"choices\":[{\"delta\":{\"content\":\"Hel").unwrap();
        assert!(a.is_empty());
        let b = p.feed(b"lo\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\" there\"}}]}\n\n").unwrap();
        assert_eq!(b, vec!["Hello", " there"]);
        let c = p.feed(b": keep-alive\n\ndata: [DONE]\n\n").unwrap();
        assert!(c.is_empty());
        assert!(p.done);
    }

    #[test]
    fn sse_parser_surfaces_inline_errors() {
        let mut p = SseParser::default();
        let err = p.feed(b"data: {\"error\":{\"message\":\"model overloaded\"}}\n").unwrap_err();
        assert!(err.contains("model overloaded"));
    }

    /// One-shot HTTP server that writes `head` then streams `chunks` with a delay.
    async fn serve(head: &'static str, chunks: Vec<&'static str>, delay_ms: u64) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await.unwrap();
            let mut buf = vec![0u8; 8192];
            let _ = sock.read(&mut buf).await;
            sock.write_all(head.as_bytes()).await.unwrap();
            for c in chunks {
                tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                let frame = format!("{:x}\r\n{}\r\n", c.len(), c);
                if sock.write_all(frame.as_bytes()).await.is_err() {
                    return;
                }
            }
            let _ = sock.write_all(b"0\r\n\r\n").await;
        });
        format!("http://{addr}/v1")
    }

    const SSE_HEAD: &str = "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ntransfer-encoding: chunked\r\n\r\n";

    fn cfg(base: String) -> LlmConfig {
        LlmConfig { base_url: base, model: "test".into(), api_key: Some("sk-secret-123".into()), temperature: 0.2, reasoning_effort: None, json_mode: false }
    }

    fn msgs() -> Vec<ChatMessage> {
        vec![ChatMessage { role: "user", content: "hi".into() }]
    }

    #[tokio::test]
    async fn streams_deltas_in_order() {
        let base = serve(
            SSE_HEAD,
            vec![
                "data: {\"choices\":[{\"delta\":{\"content\":\"Short \"}}]}\n\n",
                "data: {\"choices\":[{\"delta\":{\"content\":\"answer.\"}}]}\n\n",
                "data: [DONE]\n\n",
            ],
            5,
        )
        .await;
        let mut seen = Vec::new();
        let out = stream_chat(&cfg(base), msgs(), CancellationToken::new(), |d| seen.push(d.to_string())).await;
        assert_eq!(out, Ok("Short answer.".into()));
        assert_eq!(seen, vec!["Short ", "answer."]);
    }

    /// A server that rejects `reasoning_effort` (400) must still get an answer:
    /// the request is retried without it. The first request carries the field.
    #[tokio::test]
    async fn reasoning_effort_is_sent_and_dropped_when_rejected() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::<bool>::new()));
        let seen2 = seen.clone();
        tokio::spawn(async move {
            loop {
                let (mut sock, _) = listener.accept().await.unwrap();
                let mut buf = vec![0u8; 16384];
                let n = sock.read(&mut buf).await.unwrap_or(0);
                let has = String::from_utf8_lossy(&buf[..n]).contains("\"reasoning_effort\":\"low\"");
                seen2.lock().unwrap().push(has);
                if has {
                    let _ = sock.write_all(b"HTTP/1.1 400 Bad Request\r\ncontent-length: 2\r\nconnection: close\r\n\r\n{}").await;
                } else {
                    let body = "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\ndata: [DONE]\n\n";
                    let resp = format!("HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}", body.len(), body);
                    let _ = sock.write_all(resp.as_bytes()).await;
                }
            }
        });
        let mut c = cfg(format!("http://{addr}/v1"));
        c.reasoning_effort = Some("low".into());
        let out = stream_chat(&c, msgs(), CancellationToken::new(), |_| {}).await;
        assert_eq!(out, Ok("ok".into()));
        assert_eq!(*seen.lock().unwrap(), vec![true, false]);
    }

    /// `json_mode` sends `response_format`; a provider that rejects it still answers.
    #[tokio::test]
    async fn json_mode_is_sent_and_dropped_when_rejected() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::<bool>::new()));
        let seen2 = seen.clone();
        tokio::spawn(async move {
            loop {
                let (mut sock, _) = listener.accept().await.unwrap();
                let mut buf = vec![0u8; 16384];
                let n = sock.read(&mut buf).await.unwrap_or(0);
                let has = String::from_utf8_lossy(&buf[..n]).contains("\"response_format\"");
                seen2.lock().unwrap().push(has);
                if has {
                    let _ = sock.write_all(b"HTTP/1.1 400 Bad Request\r\ncontent-length: 2\r\nconnection: close\r\n\r\n{}").await;
                } else {
                    let body = "data: {\"choices\":[{\"delta\":{\"content\":\"{}\"}}]}\n\ndata: [DONE]\n\n";
                    let resp = format!("HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}", body.len(), body);
                    let _ = sock.write_all(resp.as_bytes()).await;
                }
            }
        });
        let mut c = cfg(format!("http://{addr}/v1"));
        c.json_mode = true;
        c.reasoning_effort = Some("low".into());
        let out = stream_chat(&c, msgs(), CancellationToken::new(), |_| {}).await;
        assert_eq!(out, Ok("{}".into()));
        assert!(seen.lock().unwrap()[0]);
        assert!(!*seen.lock().unwrap().last().unwrap());
    }

    #[tokio::test]
    async fn auth_failure_is_reported_without_leaking_key() {
        let base = serve(
            "HTTP/1.1 401 Unauthorized\r\ncontent-type: application/json\r\ntransfer-encoding: chunked\r\n\r\n",
            vec!["{\"error\":{\"message\":\"Incorrect API key provided\"}}"],
            0,
        )
        .await;
        let err = stream_chat(&cfg(base), msgs(), CancellationToken::new(), |_| {}).await.unwrap_err();
        let LlmError::Failed(m) = err else { panic!() };
        assert!(m.contains("API key was rejected"));
        assert!(m.contains("HTTP 401"));
        assert!(!m.contains("sk-secret-123"));
    }

    #[tokio::test]
    async fn server_error_and_unreachable_provider() {
        let base = serve(
            "HTTP/1.1 503 Service Unavailable\r\ntransfer-encoding: chunked\r\n\r\n",
            vec!["overloaded"],
            0,
        )
        .await;
        let err = stream_chat(&cfg(base), msgs(), CancellationToken::new(), |_| {}).await.unwrap_err();
        assert!(matches!(err, LlmError::Failed(ref m) if m.contains("server error")));

        // Nothing listens on this port.
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        drop(l);
        let err = stream_chat(&cfg(format!("http://127.0.0.1:{port}/v1")), msgs(), CancellationToken::new(), |_| {})
            .await
            .unwrap_err();
        assert!(matches!(err, LlmError::Failed(ref m) if m.contains("Could not connect")));
    }

    #[tokio::test]
    async fn cancellation_stops_a_slow_stream() {
        let base = serve(
            SSE_HEAD,
            vec![
                "data: {\"choices\":[{\"delta\":{\"content\":\"one \"}}]}\n\n",
                "data: {\"choices\":[{\"delta\":{\"content\":\"two \"}}]}\n\n",
                "data: {\"choices\":[{\"delta\":{\"content\":\"three\"}}]}\n\n",
                "data: [DONE]\n\n",
            ],
            300,
        )
        .await;
        let cancel = CancellationToken::new();
        let c2 = cancel.clone();
        let mut seen = Vec::new();
        let started = std::time::Instant::now();
        let res = stream_chat(&cfg(base), msgs(), cancel, |d| {
            seen.push(d.to_string());
            c2.cancel();
        })
        .await;
        assert_eq!(res, Err(LlmError::Cancelled));
        assert_eq!(seen, vec!["one "]);
        assert!(started.elapsed() < Duration::from_millis(900));
    }

    #[tokio::test]
    async fn missing_model_and_empty_response() {
        let mut c = cfg("http://127.0.0.1:1/v1".into());
        c.model = " ".into();
        let err = stream_chat(&c, msgs(), CancellationToken::new(), |_| {}).await.unwrap_err();
        assert!(matches!(err, LlmError::Failed(ref m) if m.contains("No AI model")));

        let base = serve(SSE_HEAD, vec!["data: [DONE]\n\n"], 0).await;
        let err = stream_chat(&cfg(base), msgs(), CancellationToken::new(), |_| {}).await.unwrap_err();
        assert!(matches!(err, LlmError::Failed(ref m) if m.contains("empty response")));
    }
}
