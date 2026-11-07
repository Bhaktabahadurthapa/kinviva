//! The loop shared by the on-device speech engines: split the audio into
//! utterances, re-transcribe the utterance so far for live partial text, and
//! finalize it after a pause. Only the way a clip is turned into text differs
//! between engines.

use super::native::{NativeError, NativeHub};
use super::vad::{Segment, Segmenter};
use super::{whisper_cli, SttEvent};
use crate::audio::Source;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

/// How often an utterance in progress is re-transcribed for partial text.
const PARTIAL_EVERY_MS: u64 = 1500;

/// Below this loudness (0..1 RMS) a clip is background noise, not speech.
const QUIET_RMS: f32 = 0.025;

/// Whisper invents short stock phrases ("You", "Thank you.", "♪♪") when it is
/// fed near-silence such as room noise. Such text from a quiet clip, or text
/// with no letters or digits at all, is not something anyone said.
pub fn is_hallucination(text: &str, rms: f32) -> bool {
    let t = text.trim();
    if t.is_empty() || !t.chars().any(char::is_alphanumeric) {
        return true;
    }
    if rms >= QUIET_RMS {
        return false;
    }
    let words = t.trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase();
    matches!(
        words.as_str(),
        "you" | "thank you" | "thanks" | "thanks for watching" | "thank you for watching" | "bye" | "bye bye" | "okay" | "so" | "the" | "uh" | "um" | "hmm"
    )
}

/// How a clip becomes text.
pub enum Engine {
    /// A fresh `whisper-cli` process per clip (works anywhere whisper.cpp is installed).
    Cli { binary: String, model: String, language: String, wav: PathBuf },
    /// The bundled C++ helper, model kept loaded (`stream` names the audio channel).
    Native { hub: Arc<NativeHub>, stream: &'static str },
}

#[derive(Debug, PartialEq)]
pub enum EngineError {
    /// The engine cannot continue; stop and tell the user.
    Fatal(String),
    /// This clip failed; keep going.
    Transient(String),
    Cancelled,
}

impl Engine {
    async fn start(&self) -> Result<(), String> {
        match self {
            Engine::Cli { .. } => Ok(()),
            Engine::Native { hub, .. } => hub.ensure_started().await.map_err(|e| match e {
                NativeError::Fatal(m) | NativeError::Transient(m) => m,
                NativeError::Cancelled => "cancelled".into(),
            }),
        }
    }

    async fn transcribe(&self, samples: &[i16], cancel: &CancellationToken) -> Result<String, EngineError> {
        match self {
            Engine::Cli { binary, model, language, wav } => whisper_cli::transcribe(binary, model, language, wav, samples)
                .await
                .map_err(EngineError::Transient),
            Engine::Native { hub, stream } => match hub.transcribe(stream, samples, cancel).await {
                Ok(text) => Ok(whisper_cli::clean_output(&text)),
                Err(NativeError::Fatal(m)) => Err(EngineError::Fatal(m)),
                Err(NativeError::Transient(m)) => Err(EngineError::Transient(m)),
                Err(NativeError::Cancelled) => Err(EngineError::Cancelled),
            },
        }
    }

    async fn finish(&self) {
        if let Engine::Native { hub, .. } = self {
            hub.release().await;
        }
    }
}

pub async fn run(
    engine: Engine,
    source: Source,
    audio: mpsc::Receiver<Vec<i16>>,
    events: mpsc::UnboundedSender<SttEvent>,
    cancel: CancellationToken,
) {
    if let Err(message) = engine.start().await {
        let _ = events.send(SttEvent::Error { source, message, fatal: true });
        engine.finish().await;
        return;
    }
    let _ = events.send(SttEvent::Connected { source });
    run_loop(&engine, source, audio, &events, &cancel).await;
    engine.finish().await;
}

async fn run_loop(
    engine: &Engine,
    source: Source,
    mut audio: mpsc::Receiver<Vec<i16>>,
    events: &mpsc::UnboundedSender<SttEvent>,
    cancel: &CancellationToken,
) {
    let mut seg = Segmenter::new(0.01, 700, 15_000);
    let mut last_partial = tokio::time::Instant::now();

    let emit_final = |text: String, start_ms: i64, samples: &[i16]| {
        let len = samples.len();
        if !is_hallucination(&text, crate::audio::resample::rms(samples)) {
            let _ = events.send(SttEvent::Final { source, text, start_ms, end_ms: start_ms + (len as i64 * 1000 / 16_000) });
        }
    };
    // Returns false when the engine cannot continue.
    let report = |e: EngineError| -> bool {
        match e {
            EngineError::Cancelled => false,
            EngineError::Transient(message) => {
                let _ = events.send(SttEvent::Error { source, message, fatal: false });
                true
            }
            EngineError::Fatal(message) => {
                let _ = events.send(SttEvent::Error { source, message, fatal: true });
                false
            }
        }
    };

    loop {
        let chunk = tokio::select! {
            _ = cancel.cancelled() => return,
            c = audio.recv() => c,
        };
        let Some(chunk) = chunk else { break };
        // Audio keeps arriving while a clip is transcribed. Take everything
        // queued now so each partial reflects the latest audio instead of
        // falling further behind on long utterances.
        let mut batch = vec![chunk];
        while let Ok(c) = audio.try_recv() {
            batch.push(c);
        }
        for c in &batch {
            if let Some(Segment::Done { samples, start_ms }) = seg.push(c) {
                match engine.transcribe(&samples, cancel).await {
                    Ok(t) => emit_final(t, start_ms, &samples),
                    Err(e) => {
                        if !report(e) {
                            return;
                        }
                    }
                }
                let _ = events.send(SttEvent::Partial { source, text: String::new() });
                last_partial = tokio::time::Instant::now();
            }
        }
        if seg.is_speaking() && last_partial.elapsed().as_millis() as u64 >= PARTIAL_EVERY_MS && seg.current().len() > 16_000 {
            last_partial = tokio::time::Instant::now();
            let samples = seg.current().to_vec();
            match engine.transcribe(&samples, cancel).await {
                Ok(t) if !is_hallucination(&t, crate::audio::resample::rms(&samples)) => {
                    let _ = events.send(SttEvent::Partial { source, text: t });
                }
                Ok(_) => {}
                Err(e) => {
                    if !report(e) {
                        return;
                    }
                }
            }
        }
    }
    // Capture stopped: flush the utterance in progress.
    if let Some(Segment::Done { samples, start_ms }) = seg.finish() {
        if let Ok(t) = engine.transcribe(&samples, cancel).await {
            emit_final(t, start_ms, &samples);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stt::native::{locate_helper, Config};
    use serde_json::json;

    #[test]
    fn quiet_clips_do_not_produce_stock_phrases() {
        for junk in ["You", "you.", " Thank you. ", "Thanks for watching!", "♪♪", "♪ ♪ ♪", "...", "Bye."] {
            assert!(is_hallucination(junk, 0.012), "{junk:?} should be dropped");
        }
        // Symbols-only text is dropped even from loud audio.
        assert!(is_hallucination("♪♪", 0.2));
        assert!(is_hallucination("", 0.2));
    }

    #[test]
    fn real_speech_is_kept_even_when_short_or_quiet() {
        // Loud audio: the same words are genuine.
        for ok in ["You", "Thank you.", "Okay"] {
            assert!(!is_hallucination(ok, 0.1), "{ok:?} from loud audio is speech");
        }
        // Quiet but a real sentence: kept.
        assert!(!is_hallucination("Can you send me the report", 0.012));
        assert!(!is_hallucination("Thank you for joining the meeting today", 0.01));
    }

    /// Speech-like audio (loud) then silence, in 100 ms blocks, through the
    /// real helper in fake mode: partials appear while speaking, one final
    /// follows the pause, and the helper is stopped at the end.
    #[tokio::test]
    async fn native_engine_drives_partials_and_a_final_through_the_helper() {
        let Some(path) = locate_helper() else {
            eprintln!("skipped: native helper not built");
            return;
        };
        let hub = NativeHub::new(
            Config {
                path,
                model: "unused".into(),
                language: "en".into(),
                threads: 2,
                env: vec![("KINVIVA_WHISPERD_FAKE".into(), "1".into())],
                extra_load: json!({}),
            },
            1,
        );
        let (tx, rx) = mpsc::channel(4096);
        let (ev_tx, mut ev_rx) = mpsc::unbounded_channel();
        let task = tokio::spawn(run(Engine::Native { hub, stream: "system" }, Source::System, rx, ev_tx, CancellationToken::new()));
        let block = |level: i16| vec![level; 1600];
        for _ in 0..3 {
            tx.send(block(0)).await.unwrap();
        }
        for i in 0..25 {
            tx.send(block(if i % 2 == 0 { 9000 } else { -9000 })).await.unwrap();
            tokio::time::sleep(std::time::Duration::from_millis(80)).await;
        }
        for _ in 0..10 {
            tx.send(block(0)).await.unwrap();
        }
        drop(tx);
        task.await.unwrap();

        let mut events = Vec::new();
        while let Ok(e) = ev_rx.try_recv() {
            events.push(e);
        }
        assert!(matches!(events.first(), Some(SttEvent::Connected { .. })), "{events:?}");
        let partials = events.iter().filter(|e| matches!(e, SttEvent::Partial { text, .. } if !text.is_empty())).count();
        let finals: Vec<_> = events.iter().filter_map(|e| if let SttEvent::Final { text, .. } = e { Some(text.clone()) } else { None }).collect();
        assert!(partials >= 1, "{events:?}");
        assert_eq!(finals.len(), 1, "{events:?}");
        assert!(finals[0].starts_with("fake transcript"), "{finals:?}");
    }

    #[tokio::test]
    async fn an_unavailable_engine_ends_the_channel_with_a_fatal_error() {
        let hub = NativeHub::new(
            Config { path: "/nonexistent/helper".into(), model: "x".into(), language: "en".into(), threads: 1, env: vec![], extra_load: json!({}) },
            1,
        );
        let (_tx, rx) = mpsc::channel(8);
        let (ev_tx, mut ev_rx) = mpsc::unbounded_channel();
        run(Engine::Native { hub, stream: "mic" }, Source::Mic, rx, ev_tx, CancellationToken::new()).await;
        match ev_rx.recv().await {
            Some(SttEvent::Error { fatal: true, message, source }) => {
                assert_eq!(source, Source::Mic);
                assert!(message.contains("Could not start the speech engine"), "{message}");
            }
            other => panic!("{other:?}"),
        }
    }
}
