//! Meeting session lifecycle: start capture for each enabled source, run a
//! speech provider per source, persist final segments, and tear everything
//! down on stop so devices are released.

use crate::audio::{self, CaptureFault, CaptureHandle, CaptureSink, Source};
use crate::db::{now_ms, Db};
use crate::state::{AppState, Live, MeetingStatus};
use crate::stt::{self, SttConfig, SttEvent};
use crate::{secrets, settings::Settings};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

pub struct Session {
    pub meeting_id: String,
    captures: HashMap<Source, CaptureHandle>,
    sinks: HashMap<Source, CaptureSink>,
    cancel: CancellationToken,
    tasks: Vec<JoinHandle<()>>,
}

pub fn emit_status(app: &AppHandle, live: &Arc<Mutex<Live>>) {
    let status = live.lock().unwrap().status.clone();
    let _ = app.emit("meeting-status", status);
}

fn stt_config(settings: &Settings, data_dir: &std::path::Path) -> Result<SttConfig, String> {
    match settings.stt_provider.as_str() {
        "deepgram" => {
            let key = secrets::get("deepgram_api_key")?
                .ok_or("Add your Deepgram API key in Settings → Speech before starting.")?;
            Ok(SttConfig::Deepgram {
                api_key: key,
                model: settings.deepgram_model.clone(),
                language: settings.language.clone(),
                endpoint: settings.deepgram_endpoint.clone(),
            })
        }
        "whisper_cli" => {
            if settings.whisper_model_path.trim().is_empty() {
                return Err("Choose a whisper.cpp model file in Settings → Speech.".into());
            }
            Ok(SttConfig::WhisperCli {
                binary: settings.whisper_cli_path.clone(),
                model_path: settings.whisper_model_path.clone(),
                language: settings.language.clone(),
                work_dir: data_dir.join("tmp"),
            })
        }
        other => Err(format!("Unknown speech provider \"{other}\".")),
    }
}

fn host_of(url: &str) -> Option<String> {
    url::Url::parse(url).ok().and_then(|u| u.host_str().map(String::from))
}

pub async fn start(app: &AppHandle, state: &AppState, title: Option<String>) -> Result<MeetingStatus, String> {
    let mut guard = state.session.lock().await;
    if guard.is_some() {
        return Err("A meeting is already running.".into());
    }
    let settings = state.settings();
    if !settings.capture_mic && !settings.capture_system {
        return Err("Enable the microphone or system audio in Settings → Audio.".into());
    }
    let cfg = stt_config(&settings, &state.data_dir)?;

    let meeting_id = uuid::Uuid::new_v4().to_string();
    let started_at = now_ms();
    let title = title
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| format!("Meeting {}", chrono::Local::now().format("%b %-d, %H:%M")));
    state.db.create_meeting(&meeting_id, &title, started_at, false)?;

    {
        let mut live = state.live.lock().unwrap();
        live.transcript.clear();
        live.notes.clear();
        live.ai.clear();
        let mut st = MeetingStatus {
            state: "starting".into(),
            meeting_id: Some(meeting_id.clone()),
            title: Some(title.clone()),
            started_at: Some(started_at),
            stt_provider: settings.stt_provider.clone(),
            audio_to_cloud: cfg.is_cloud(),
            stt_host: if cfg.is_cloud() { host_of(&settings.deepgram_endpoint) } else { None },
            recording_audio: settings.save_audio,
            ..Default::default()
        };
        st.mic.enabled = settings.capture_mic;
        st.system.enabled = settings.capture_system;
        live.status = st;
    }
    emit_status(app, &state.live);
    state.questions.lock().unwrap().set_cooldown(settings.question_cooldown_secs);
    state.auto.reset();

    let cancel = CancellationToken::new();
    let (ev_tx, ev_rx) = mpsc::unbounded_channel::<SttEvent>();
    let (fault_tx, fault_rx) = mpsc::unbounded_channel::<CaptureFault>();
    let mut session = Session {
        meeting_id: meeting_id.clone(),
        captures: HashMap::new(),
        sinks: HashMap::new(),
        cancel: cancel.clone(),
        tasks: Vec::new(),
    };
    let mut levels: Vec<(Source, Arc<AtomicU32>, Arc<AtomicU32>)> = Vec::new();
    let rec_dir = state.data_dir.join("recordings").join(&meeting_id);

    let wanted: Vec<Source> = [(settings.capture_mic, Source::Mic), (settings.capture_system, Source::System)]
        .into_iter()
        .filter(|(on, _)| *on)
        .map(|(_, s)| s)
        .collect();

    for source in wanted {
        let (raw_tx, raw_rx) = mpsc::channel::<Vec<i16>>(256);
        let sink = CaptureSink {
            source,
            audio: raw_tx,
            faults: fault_tx.clone(),
            level: Arc::new(AtomicU32::new(0)),
            dropped: Arc::new(AtomicU32::new(0)),
        };
        state.live.lock().unwrap().status.source_mut(source).capture = "starting".into();
        emit_status(app, &state.live);
        let started = match source {
            Source::Mic => audio::start_mic(settings.mic_device.clone(), sink.clone()),
            Source::System => audio::start_system(sink.clone()),
        };
        match started {
            Ok(handle) => {
                {
                    let mut live = state.live.lock().unwrap();
                    let st = live.status.source_mut(source);
                    st.capture = "capturing".into();
                    st.stt = "connecting".into();
                    st.device = Some(handle.description.clone());
                    st.message = None;
                }
                levels.push((source, sink.level.clone(), sink.dropped.clone()));
                session.captures.insert(source, handle);
                session.sinks.insert(source, sink);
                // Generous buffer: a local engine may pause for a few seconds per utterance.
                let (stt_tx, stt_rx) = mpsc::channel::<Vec<i16>>(4096);
                let rec_path = settings.save_audio.then(|| rec_dir.join(format!("{}.wav", source.as_str())));
                session.tasks.push(tokio::spawn(forward_audio(raw_rx, stt_tx, rec_path)));
                session.tasks.push(tokio::spawn(stt::run(cfg.clone(), source, stt_rx, ev_tx.clone(), cancel.clone())));
            }
            Err(message) => {
                let mut live = state.live.lock().unwrap();
                let st = live.status.source_mut(source);
                st.capture = "error".into();
                st.message = Some(message);
            }
        }
        emit_status(app, &state.live);
    }
    drop(ev_tx);

    if session.captures.is_empty() {
        let _ = state.db.delete_meeting(&meeting_id);
        let msg = {
            let mut live = state.live.lock().unwrap();
            let m = [&live.status.mic, &live.status.system]
                .iter()
                .filter_map(|s| s.message.clone())
                .collect::<Vec<_>>()
                .join(" ");
            live.status.state = "idle".into();
            live.status.meeting_id = None;
            m
        };
        emit_status(app, &state.live);
        return Err(if msg.is_empty() { "No audio source could be started.".into() } else { msg });
    }

    session.tasks.push(tokio::spawn(pump_events(
        app.clone(),
        state.db.clone(),
        state.live.clone(),
        state.questions.clone(),
        meeting_id.clone(),
        settings.question_detection,
        ev_rx,
    )));
    session.tasks.push(tokio::spawn(pump_faults(app.clone(), state.live.clone(), fault_rx)));
    session.tasks.push(tokio::spawn(emit_levels(app.clone(), state.live.clone(), levels, cancel.clone())));

    state.live.lock().unwrap().status.state = "running".into();
    emit_status(app, &state.live);
    let status = state.live.lock().unwrap().status.clone();
    *guard = Some(session);
    Ok(status)
}

pub async fn stop(app: &AppHandle, state: &AppState) -> Result<Option<String>, String> {
    let mut guard = state.session.lock().await;
    let Some(mut session) = guard.take() else { return Ok(None) };
    state.live.lock().unwrap().status.state = "stopping".into();
    emit_status(app, &state.live);

    // 1. Release devices. Dropping the stream drops its sink, closing the audio channel.
    for (_, cap) in session.captures.drain() {
        tokio::task::spawn_blocking(move || cap.stop()).await.ok();
    }
    session.sinks.clear();
    // 2. Let providers flush their last finals, then force-cancel stragglers.
    let deadline = tokio::time::Instant::now() + Duration::from_secs(6);
    let levels_and_pumps = session.tasks.split_off(session.tasks.len().saturating_sub(3));
    for t in session.tasks.drain(..) {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if tokio::time::timeout(remaining, t).await.is_err() {
            session.cancel.cancel();
        }
    }
    session.cancel.cancel();
    for t in levels_and_pumps {
        let mut t = t;
        if tokio::time::timeout(Duration::from_secs(2), &mut t).await.is_err() {
            t.abort();
        }
    }
    state.db.end_meeting(&session.meeting_id, now_ms())?;
    {
        let mut live = state.live.lock().unwrap();
        let st = &mut live.status;
        st.state = "idle".into();
        st.audio_to_cloud = false;
        st.context_meeting_id = Some(session.meeting_id.clone());
        st.context_is_demo = false;
        for s in [&mut st.mic, &mut st.system] {
            s.capture = "off".into();
            s.stt = "idle".into();
        }
        live.transcript.partials.clear();
    }
    emit_status(app, &state.live);
    let _ = app.emit("meeting-saved", &session.meeting_id);
    Ok(Some(session.meeting_id))
}

pub async fn switch_mic(app: &AppHandle, state: &AppState, device: Option<String>) -> Result<(), String> {
    let mut guard = state.session.lock().await;
    let Some(session) = guard.as_mut() else { return Ok(()) };
    let Some(sink) = session.sinks.get(&Source::Mic).cloned() else {
        return Err("The microphone is not part of this meeting.".into());
    };
    if let Some(old) = session.captures.remove(&Source::Mic) {
        tokio::task::spawn_blocking(move || old.stop()).await.ok();
    }
    let result = tokio::task::spawn_blocking(move || audio::start_mic(device, sink)).await.map_err(|e| e.to_string())?;
    let out = {
        let mut live = state.live.lock().unwrap();
        let st = live.status.source_mut(Source::Mic);
        match result {
            Ok(h) => {
                st.capture = "capturing".into();
                st.device = Some(h.description.clone());
                st.message = None;
                session.captures.insert(Source::Mic, h);
                Ok(())
            }
            Err(e) => {
                st.capture = "error".into();
                st.message = Some(e.clone());
                Err(e)
            }
        }
    };
    emit_status(app, &state.live);
    out
}

/// Copy capture audio to the speech provider, optionally recording to WAV.
async fn forward_audio(
    mut raw: mpsc::Receiver<Vec<i16>>,
    stt: mpsc::Sender<Vec<i16>>,
    record_to: Option<std::path::PathBuf>,
) {
    let mut writer = record_to.and_then(|p| {
        std::fs::create_dir_all(p.parent()?).ok()?;
        let spec = hound::WavSpec { channels: 1, sample_rate: 16_000, bits_per_sample: 16, sample_format: hound::SampleFormat::Int };
        hound::WavWriter::create(p, spec).ok()
    });
    while let Some(chunk) = raw.recv().await {
        if let Some(w) = writer.as_mut() {
            for s in &chunk {
                let _ = w.write_sample(*s);
            }
        }
        if stt.send(chunk).await.is_err() {
            // Provider ended (e.g. auth failure); keep draining so capture is not blocked.
            continue;
        }
    }
    if let Some(w) = writer {
        let _ = w.finalize();
    }
}

async fn pump_events(
    app: AppHandle,
    db: Arc<Db>,
    live: Arc<Mutex<Live>>,
    questions: Arc<Mutex<crate::question::QuestionDetector>>,
    meeting_id: String,
    detect_questions: bool,
    mut rx: mpsc::UnboundedReceiver<SttEvent>,
) {
    while let Some(ev) = rx.recv().await {
        match ev {
            SttEvent::Partial { source, text } => {
                live.lock().unwrap().transcript.set_partial(source, &text);
                let _ = app.emit("transcript-partial", serde_json::json!({ "source": source, "text": text }));
            }
            SttEvent::Final { source, text, start_ms, end_ms } => {
                let id = match db.add_segment(&meeting_id, source, &text, start_ms, end_ms) {
                    Ok(id) => id,
                    Err(e) => {
                        let _ = app.emit("app-error", e);
                        -1
                    }
                };
                let seg = crate::transcript::Segment { id, source, text: text.clone(), start_ms, end_ms };
                live.lock().unwrap().transcript.push_final(seg.clone());
                let _ = app.emit("transcript-final", &seg);
                if detect_questions && source == Source::System && questions.lock().unwrap().check(&text, now_ms()) {
                    let _ = app.emit("question-detected", serde_json::json!({ "text": text, "segment_id": id }));
                }
                if source == Source::System {
                    crate::auto_assist::on_their_final(&app, id, &text);
                }
            }
            SttEvent::Error { source, message, fatal } => {
                {
                    let mut l = live.lock().unwrap();
                    let st = l.status.source_mut(source);
                    if fatal {
                        st.stt = "error".into();
                    }
                    st.message = Some(message);
                }
                emit_status(&app, &live);
            }
            SttEvent::Connected { source } => {
                live.lock().unwrap().status.source_mut(source).stt = "connected".into();
                emit_status(&app, &live);
            }
            SttEvent::Closed { source } => {
                {
                    let mut l = live.lock().unwrap();
                    let st = l.status.source_mut(source);
                    if st.stt != "error" {
                        st.stt = "closed".into();
                    }
                }
                emit_status(&app, &live);
            }
        }
    }
}

async fn pump_faults(app: AppHandle, live: Arc<Mutex<Live>>, mut rx: mpsc::UnboundedReceiver<CaptureFault>) {
    while let Some(f) = rx.recv().await {
        {
            let mut l = live.lock().unwrap();
            let st = l.status.source_mut(f.source);
            st.capture = "error".into();
            st.message = Some(f.message);
        }
        emit_status(&app, &live);
    }
}

async fn emit_levels(
    app: AppHandle,
    live: Arc<Mutex<Live>>,
    levels: Vec<(Source, Arc<AtomicU32>, Arc<AtomicU32>)>,
    cancel: CancellationToken,
) {
    let mut tick = tokio::time::interval(Duration::from_millis(200));
    let mut reported = vec![0u32; levels.len()];
    loop {
        tokio::select! {
            _ = cancel.cancelled() => break,
            _ = tick.tick() => {
                let mut map = serde_json::Map::new();
                for (i, (s, l, dropped)) in levels.iter().enumerate() {
                    map.insert(s.as_str().into(), serde_json::json!(l.load(Ordering::Relaxed) as f32 / 1_000_000.0));
                    // Never lose audio silently: surface drops in the source status.
                    let d = dropped.load(Ordering::Relaxed);
                    if d > reported[i] {
                        reported[i] = d;
                        live.lock().unwrap().status.source_mut(*s).message =
                            Some(format!("Audio processing fell behind; {d} audio blocks were dropped."));
                        emit_status(&app, &live);
                    }
                }
                let _ = app.emit("audio-levels", map);
            }
        }
    }
}
