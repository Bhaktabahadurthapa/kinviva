//! Deepgram live streaming transcription over WebSocket.
//! Docs: https://developers.deepgram.com/reference/speech-to-text-api/listen-streaming
//!
//! Raw linear16 PCM is streamed as binary frames; JSON `Results` messages carry
//! interim (`is_final: false`) and final transcripts.

use super::SttEvent;
use crate::audio::Source;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;
use tokio_util::sync::CancellationToken;

pub const DEFAULT_ENDPOINT: &str = "wss://api.deepgram.com/v1/listen";

#[derive(Deserialize, Debug)]
struct Alternative {
    #[serde(default)]
    transcript: String,
}
#[derive(Deserialize, Debug)]
struct Channel {
    #[serde(default)]
    alternatives: Vec<Alternative>,
}
#[derive(Deserialize, Debug)]
struct DgMessage {
    #[serde(rename = "type", default)]
    kind: String,
    #[serde(default)]
    is_final: bool,
    #[serde(default)]
    start: f64,
    #[serde(default)]
    duration: f64,
    channel: Option<Channel>,
    #[serde(default)]
    description: Option<String>,
}

pub fn build_url(endpoint: &str, model: &str, language: &str) -> Result<url::Url, String> {
    let mut url = url::Url::parse(endpoint).map_err(|e| format!("Invalid Deepgram endpoint: {e}"))?;
    url.query_pairs_mut()
        .append_pair("encoding", "linear16")
        .append_pair("sample_rate", "16000")
        .append_pair("channels", "1")
        .append_pair("interim_results", "true")
        .append_pair("punctuate", "true")
        .append_pair("smart_format", "true")
        .append_pair("model", model)
        .append_pair("language", language);
    Ok(url)
}

/// Translate one Deepgram text message to a transcript event (if any).
pub fn parse_message(source: Source, raw: &str) -> Option<SttEvent> {
    let msg: DgMessage = serde_json::from_str(raw).ok()?;
    match msg.kind.as_str() {
        "Results" => {
            let text = msg
                .channel?
                .alternatives
                .into_iter()
                .next()
                .map(|a| a.transcript.trim().to_string())
                .unwrap_or_default();
            if msg.is_final {
                if text.is_empty() {
                    return None;
                }
                Some(SttEvent::Final {
                    source,
                    text,
                    start_ms: (msg.start * 1000.0) as i64,
                    end_ms: ((msg.start + msg.duration) * 1000.0) as i64,
                })
            } else {
                Some(SttEvent::Partial { source, text })
            }
        }
        "Error" => Some(SttEvent::Error {
            source,
            message: msg.description.unwrap_or_else(|| "Deepgram error".into()),
            fatal: true,
        }),
        _ => None,
    }
}

fn pcm_bytes(chunk: &[i16]) -> Vec<u8> {
    chunk.iter().flat_map(|s| s.to_le_bytes()).collect()
}

#[allow(clippy::too_many_arguments)]
pub async fn run(
    endpoint: &str,
    api_key: &str,
    model: &str,
    language: &str,
    source: Source,
    mut audio: mpsc::Receiver<Vec<i16>>,
    events: mpsc::UnboundedSender<SttEvent>,
    cancel: CancellationToken,
) {
    let fail = |message: String| {
        let _ = events.send(SttEvent::Error { source, message, fatal: true });
    };
    let url = match build_url(endpoint, model, language) {
        Ok(u) => u,
        Err(e) => return fail(e),
    };
    let mut request = match url.as_str().into_client_request() {
        Ok(r) => r,
        Err(e) => return fail(format!("Invalid Deepgram request: {e}")),
    };
    let Ok(auth) = HeaderValue::from_str(&format!("Token {api_key}")) else {
        return fail("The Deepgram API key contains invalid characters.".into());
    };
    request.headers_mut().insert("Authorization", auth);

    let connect = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        tokio_tungstenite::connect_async(request),
    );
    let ws = match connect.await {
        Ok(Ok((ws, _))) => ws,
        Ok(Err(tokio_tungstenite::tungstenite::Error::Http(resp))) => {
            let status = resp.status();
            let hint = match status.as_u16() {
                401 | 403 => "check the Deepgram API key",
                400 => "check the model and language settings",
                _ => "provider rejected the connection",
            };
            return fail(format!("Deepgram connection failed (HTTP {status}): {hint}."));
        }
        Ok(Err(e)) => return fail(format!("Could not reach Deepgram: {e}")),
        Err(_) => return fail("Timed out connecting to Deepgram.".into()),
    };
    let _ = events.send(SttEvent::Connected { source });
    let (mut write, mut read) = ws.split();

    let reader_events = events.clone();
    let reader = tokio::spawn(async move {
        while let Some(msg) = read.next().await {
            match msg {
                Ok(Message::Text(t)) => {
                    if let Some(ev) = parse_message(source, t.as_str()) {
                        let _ = reader_events.send(ev);
                    }
                }
                Ok(Message::Close(frame)) => {
                    if let Some(f) = frame {
                        // 1000 = normal close after CloseStream.
                        if u16::from(f.code) != 1000 {
                            let _ = reader_events.send(SttEvent::Error {
                                source,
                                message: format!("Deepgram closed the stream: {} {}", u16::from(f.code), f.reason),
                                fatal: true,
                            });
                        }
                    }
                    break;
                }
                Ok(_) => {}
                Err(e) => {
                    let _ = reader_events.send(SttEvent::Error {
                        source,
                        message: format!("Deepgram connection lost: {e}"),
                        fatal: true,
                    });
                    break;
                }
            }
        }
    });

    let mut keepalive = tokio::time::interval(std::time::Duration::from_secs(5));
    let mut last_send = tokio::time::Instant::now();
    loop {
        tokio::select! {
            _ = cancel.cancelled() => break,
            chunk = audio.recv() => match chunk {
                Some(c) => {
                    if write.send(Message::Binary(pcm_bytes(&c).into())).await.is_err() {
                        break;
                    }
                    last_send = tokio::time::Instant::now();
                }
                None => break, // capture stopped
            },
            _ = keepalive.tick() => {
                if last_send.elapsed() > std::time::Duration::from_secs(4) {
                    let _ = write.send(Message::Text(r#"{"type":"KeepAlive"}"#.into())).await;
                }
            }
        }
    }
    // Ask Deepgram to flush final results, then wait briefly for them.
    let _ = write.send(Message::Text(r#"{"type":"CloseStream"}"#.into())).await;
    let wait = if cancel.is_cancelled() { 1 } else { 5 };
    if tokio::time::timeout(std::time::Duration::from_secs(wait), reader).await.is_err() {
        // Reader is aborted on drop of the join handle's task via timeout; ignore.
    }
    let _ = write.close().await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_contains_audio_format_and_model() {
        let u = build_url(DEFAULT_ENDPOINT, "nova-3", "en").unwrap();
        let q = u.query().unwrap();
        assert!(q.contains("encoding=linear16"));
        assert!(q.contains("sample_rate=16000"));
        assert!(q.contains("interim_results=true"));
        assert!(q.contains("model=nova-3"));
    }

    #[test]
    fn parses_interim_and_final_results() {
        let interim = r#"{"type":"Results","is_final":false,"start":1.0,"duration":0.5,
            "channel":{"alternatives":[{"transcript":"hello wor"}]}}"#;
        assert_eq!(
            parse_message(Source::System, interim),
            Some(SttEvent::Partial { source: Source::System, text: "hello wor".into() })
        );
        let fin = r#"{"type":"Results","is_final":true,"start":1.0,"duration":0.5,
            "channel":{"alternatives":[{"transcript":"Hello world."}]}}"#;
        assert_eq!(
            parse_message(Source::System, fin),
            Some(SttEvent::Final { source: Source::System, text: "Hello world.".into(), start_ms: 1000, end_ms: 1500 })
        );
    }

    #[test]
    fn ignores_empty_finals_and_metadata() {
        let empty = r#"{"type":"Results","is_final":true,"start":0,"duration":1,
            "channel":{"alternatives":[{"transcript":""}]}}"#;
        assert_eq!(parse_message(Source::Mic, empty), None);
        assert_eq!(parse_message(Source::Mic, r#"{"type":"Metadata"}"#), None);
        assert_eq!(parse_message(Source::Mic, "not json"), None);
    }
}

#[cfg(test)]
mod network_tests {
    use super::*;

    /// Real provider rejection. Uses a deliberately invalid key; no audio is
    /// sent because the handshake fails. Run with `cargo test -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn invalid_key_is_rejected_by_deepgram() {
        let (_tx, rx) = mpsc::channel(1);
        let (ev_tx, mut ev_rx) = mpsc::unbounded_channel();
        run(DEFAULT_ENDPOINT, "invalid-test-key", "nova-3", "en", Source::System, rx, ev_tx, CancellationToken::new()).await;
        match ev_rx.recv().await {
            Some(SttEvent::Error { fatal: true, message, .. }) => {
                assert!(message.contains("HTTP 401") || message.contains("HTTP 403"), "{message}");
                assert!(!message.contains("invalid-test-key"));
            }
            other => panic!("unexpected {other:?}"),
        }
    }
}
