//! Hardware verification probe (not part of the app). Runs the real capture,
//! speech, AI, persistence and export code paths headlessly:
//!
//!   cargo run --example e2e_probe -- <whisper-cli> <ggml-model> <llm-base-url> <llm-model> <seconds> [cli|native]
//!
//! Play speech through the speakers while it runs (e.g. `say` or `afplay`).
//! Prints per-source audio statistics, transcripts, streamed AI output,
//! cancellation timing, persistence after reopen, and export checks.

use meetinglens_lib::audio::{self, CaptureSink, Source};
use meetinglens_lib::db::Db;
use meetinglens_lib::llm::{self, LlmConfig, LlmError};
use meetinglens_lib::prompts::{self, Action, PromptInput};
use meetinglens_lib::stt::{self, native, SttConfig, SttEvent};
use meetinglens_lib::transcript::{Segment, Transcript};
use meetinglens_lib::export;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

#[tokio::main]
async fn main() {
    let a: Vec<String> = std::env::args().collect();
    let (bin, model, base, llm_model) = (a[1].clone(), a[2].clone(), a[3].clone(), a[4].clone());
    let secs: u64 = a.get(5).and_then(|s| s.parse().ok()).unwrap_or(12);
    let engine = a.get(6).map(String::as_str).unwrap_or("cli");
    let native_hub = (engine == "native").then(|| {
        let path = native::locate_helper().expect("native helper not built (native/whisperd/build.sh)");
        native::NativeHub::new(
            native::Config { path, model: model.clone(), language: "en".into(), threads: 4, env: vec![], extra_load: serde_json::json!({}) },
            2,
        )
    });
    println!("[engine] {}", if native_hub.is_some() { "bundled C++ helper (native)" } else { "whisper-cli process per clip" });
    let work = std::env::temp_dir().join("meetinglens-probe");
    std::fs::create_dir_all(&work).unwrap();

    let (ev_tx, mut ev_rx) = mpsc::unbounded_channel::<SttEvent>();
    let (fault_tx, mut fault_rx) = mpsc::unbounded_channel();
    let cancel = CancellationToken::new();
    let mut captures = Vec::new();
    let mut stats = Vec::new();
    let mut stt_tasks = Vec::new();

    for source in [Source::System, Source::Mic] {
        let (raw_tx, mut raw_rx) = mpsc::channel::<Vec<i16>>(512);
        let sink = CaptureSink {
            source,
            audio: raw_tx,
            faults: fault_tx.clone(),
            level: Arc::new(AtomicU32::new(0)),
            dropped: Arc::new(AtomicU32::new(0)),
        };
        let started = match source {
            Source::Mic => audio::start_mic(None, sink.clone()),
            Source::System => audio::start_system(sink.clone()),
        };
        drop(sink);
        match started {
            Ok(h) => {
                println!("[capture] {:?} started: {}", source, h.description);
                captures.push((source, h));
            }
            Err(e) => {
                println!("[capture] {:?} FAILED: {e}", source);
                continue;
            }
        }
        // Tee: measure samples/peak, forward to STT.
        let samples = Arc::new(AtomicU64::new(0));
        let peak = Arc::new(AtomicU32::new(0));
        stats.push((source, samples.clone(), peak.clone()));
        let (stt_tx, stt_rx) = mpsc::channel::<Vec<i16>>(512);
        tokio::spawn(async move {
            while let Some(c) = raw_rx.recv().await {
                samples.fetch_add(c.len() as u64, Ordering::Relaxed);
                let p = c.iter().map(|s| s.unsigned_abs() as u32).max().unwrap_or(0);
                peak.fetch_max(p, Ordering::Relaxed);
                let _ = stt_tx.send(c).await;
            }
        });
        let cfg = match &native_hub {
            Some(hub) => SttConfig::WhisperNative { hub: hub.clone() },
            None => SttConfig::WhisperCli { binary: bin.clone(), model_path: model.clone(), language: "en".into(), work_dir: work.clone() },
        };
        stt_tasks.push(tokio::spawn(stt::run(cfg, source, stt_rx, ev_tx.clone(), cancel.clone())));
    }
    drop(ev_tx);
    drop(fault_tx);

    let mut transcript = Transcript::default();
    let mut partials = 0;
    let deadline = Instant::now() + Duration::from_secs(secs);
    while Instant::now() < deadline {
        tokio::select! {
            Some(ev) = ev_rx.recv() => match ev {
                SttEvent::Partial { source, text } => { if !text.is_empty() { partials += 1; println!("[partial] {:?}: {text}", source); } transcript.set_partial(source, &text); }
                SttEvent::Final { source, text, start_ms, end_ms } => {
                    println!("[final]   {:?} {start_ms}-{end_ms}ms: {text}", source);
                    let id = transcript.finals.len() as i64;
                    transcript.push_final(Segment { id, source, text, start_ms, end_ms });
                }
                other => println!("[stt] {other:?}"),
            },
            Some(f) = fault_rx.recv() => println!("[fault] {f:?}"),
            _ = tokio::time::sleep(Duration::from_millis(100)) => {}
        }
    }

    // Stop capture and measure release.
    for (source, h) in captures.drain(..) {
        let t = Instant::now();
        tokio::task::spawn_blocking(move || h.stop()).await.unwrap();
        println!("[stop] {:?} released in {} ms", source, t.elapsed().as_millis());
    }
    let t = Instant::now();
    while let Ok(Some(ev)) = tokio::time::timeout(Duration::from_secs(20), ev_rx.recv()).await {
        if let SttEvent::Final { source, text, start_ms, end_ms } = ev {
            println!("[final]   {:?} (flushed) {start_ms}-{end_ms}ms: {text}", source);
            let id = transcript.finals.len() as i64;
            transcript.push_final(Segment { id, source, text, start_ms, end_ms });
        }
    }
    for t in stt_tasks { let _ = t.await; }
    println!("[stop] speech tasks ended {} ms after capture stop", t.elapsed().as_millis());
    for (s, n, p) in &stats {
        println!("[audio] {:?}: {:.1} s captured at 16 kHz, peak {}", s, n.load(Ordering::Relaxed) as f64 / 16000.0, p.load(Ordering::Relaxed));
    }
    println!("[transcript] {} finals, {} partial updates", transcript.finals.len(), partials);

    // AI: explain + suggest streaming, then cancellation.
    let cfg = LlmConfig { base_url: base, model: llm_model.clone(), api_key: None, temperature: 0.2 };
    let window = transcript.recent_window(4000);
    let mut responses = Vec::new();
    for action in [Action::Explain, Action::Suggest] {
        let msgs = prompts::build(&PromptInput { action, transcript: &window, notes: "", passages: &[], question: None, focus: None });
        let t = Instant::now();
        let mut first: Option<u128> = None;
        let mut n = 0;
        let r = llm::stream_chat(&cfg, msgs, CancellationToken::new(), |_| { n += 1; first.get_or_insert(t.elapsed().as_millis()); }).await;
        match r {
            Ok(text) => {
                println!("[ai] {:?}: {} deltas, first token {} ms, total {} ms\n{}\n", action, n, first.unwrap_or(0), t.elapsed().as_millis(), text.trim());
                responses.push((action, text));
            }
            Err(e) => println!("[ai] {:?} FAILED: {e}", action),
        }
    }
    let c = CancellationToken::new();
    let c2 = c.clone();
    let msgs = prompts::build(&PromptInput { action: Action::Recap, transcript: &window, notes: "", passages: &[], question: None, focus: None });
    let t = Instant::now();
    let mut got = 0;
    let r = llm::stream_chat(&cfg, msgs, c, |_| { got += 1; if got == 3 { c2.cancel(); } }).await;
    println!("[ai] cancel after 3 deltas -> {:?} in {} ms, deltas seen {}", r.as_ref().err(), t.elapsed().as_millis(), got);
    assert_eq!(r, Err(LlmError::Cancelled));

    // Persistence across reopen + export.
    let dbp = work.join("probe.sqlite");
    let _ = std::fs::remove_file(&dbp);
    {
        let db = Db::open(&dbp).unwrap();
        db.create_meeting("probe", "Probe meeting", 0, false).unwrap();
        for s in &transcript.finals { db.add_segment("probe", s.source, &s.text, s.start_ms, s.end_ms).unwrap(); }
        for (i, (a, txt)) in responses.iter().enumerate() {
            db.add_ai_message(&format!("r{i}"), Some("probe"), a.as_str(), None, txt, &llm_model, "done").unwrap();
        }
        db.end_meeting("probe", 1).unwrap();
    }
    let db = Db::open(&dbp).unwrap();
    let m = db.get_meeting("probe").unwrap();
    println!("[db] reopened: {} segments, {} ai messages", m.segments.len(), m.ai_messages.len());
    let md = export::to_markdown(&m);
    let ok = m.segments.iter().all(|s| md.contains(&s.text)) && responses.iter().all(|(_, r)| md.contains(r.trim()));
    std::fs::write(work.join("probe.md"), &md).unwrap();
    std::fs::write(work.join("probe.txt"), export::to_text(&m)).unwrap();
    println!("[export] markdown contains every segment and response: {ok} ({})", work.join("probe.md").display());
}
