//! Local transcription by invoking a user-installed whisper.cpp `whisper-cli`
//! binary with a user-supplied ggml model. No audio leaves the machine.
//!
//! whisper-cli transcribes files, not streams, so audio is segmented into
//! utterances. While an utterance is in progress we periodically transcribe
//! the audio so far (partial), then once more when it ends (final).

use super::vad::{Segment, Segmenter};
use super::SttEvent;
use crate::audio::Source;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

const PARTIAL_EVERY_MS: u64 = 1500;

pub fn write_wav(path: &Path, samples: &[i16]) -> Result<(), String> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: 16_000,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut w = hound::WavWriter::create(path, spec).map_err(|e| e.to_string())?;
    for s in samples {
        w.write_sample(*s).map_err(|e| e.to_string())?;
    }
    w.finalize().map_err(|e| e.to_string())
}

/// whisper-cli marks non-speech with annotations such as "[BLANK_AUDIO]",
/// "(machine whirring)" or "*music*"; these are not words anyone said.
pub fn clean_output(raw: &str) -> String {
    let mut out = String::new();
    for line in raw.lines() {
        let mut l = line.trim().to_string();
        for (open, close) in [('[', ']'), ('(', ')'), ('*', '*')] {
            while let Some(a) = l.find(open) {
                match l[a + 1..].find(close) {
                    Some(off) => l.replace_range(a..=a + 1 + off, ""),
                    None => break,
                }
            }
        }
        let l = l.split_whitespace().collect::<Vec<_>>().join(" ");
        if !l.is_empty() {
            if !out.is_empty() {
                out.push(' ');
            }
            out.push_str(&l);
        }
    }
    out
}

static NEXT_CLIP: AtomicU64 = AtomicU64::new(0);

/// `base` names this process and source; each clip gets its own file so
/// overlapping transcriptions (or two app instances) never share one.
async fn transcribe(binary: &str, model: &str, language: &str, base: &Path, samples: &[i16]) -> Result<String, String> {
    let stem = base.file_name().and_then(|n| n.to_str()).unwrap_or("utterance");
    let wav_path = base.with_file_name(format!("{stem}-{}.wav", NEXT_CLIP.fetch_add(1, Ordering::Relaxed)));
    let wav = wav_path.as_path();
    write_wav(wav, samples)?;
    let output = tokio::process::Command::new(binary)
        .args(["-m", model, "-f"])
        .arg(wav)
        .args(["-l", language, "-nt", "-np"])
        .kill_on_drop(true)
        .output()
        .await;
    let _ = std::fs::remove_file(wav);
    let output = output.map_err(|e| format!("Could not run whisper-cli at \"{binary}\": {e}"))?;
    if !output.status.success() {
        // Prefer whisper-cli's own error line over the tail of its usage text.
        let err = String::from_utf8_lossy(&output.stderr);
        let line = err
            .lines()
            .find(|l| l.to_lowercase().contains("error"))
            .or_else(|| err.lines().rev().find(|l| !l.trim().is_empty()))
            .unwrap_or("unknown error");
        return Err(format!("whisper-cli failed: {}", line.trim()));
    }
    Ok(clean_output(&String::from_utf8_lossy(&output.stdout)))
}

#[allow(clippy::too_many_arguments)]
pub async fn run(
    binary: &str,
    model: &str,
    language: &str,
    work_dir: &Path,
    source: Source,
    mut audio: mpsc::Receiver<Vec<i16>>,
    events: mpsc::UnboundedSender<SttEvent>,
    cancel: CancellationToken,
) {
    if !Path::new(model).is_file() {
        let _ = events.send(SttEvent::Error {
            source,
            message: format!("Whisper model file not found: {model}"),
            fatal: true,
        });
        return;
    }
    let _ = std::fs::create_dir_all(work_dir);
    let wav = work_dir.join(format!("utterance-{}-{}", std::process::id(), source.as_str()));
    let _ = events.send(SttEvent::Connected { source });
    let mut seg = Segmenter::new(0.01, 700, 15_000);
    let mut last_partial = tokio::time::Instant::now();

    let emit_final = |text: String, start_ms: i64, len: usize| {
        if !text.is_empty() {
            let _ = events.send(SttEvent::Final {
                source,
                text,
                start_ms,
                end_ms: start_ms + (len as i64 * 1000 / 16_000),
            });
        }
    };

    loop {
        let chunk = tokio::select! {
            _ = cancel.cancelled() => return,
            c = audio.recv() => c,
        };
        let Some(chunk) = chunk else { break };
        // Audio keeps arriving while whisper-cli runs. Take everything queued
        // now so each partial reflects the latest audio instead of falling
        // further behind on long utterances.
        let mut batch = vec![chunk];
        while let Ok(c) = audio.try_recv() {
            batch.push(c);
        }
        for c in &batch {
            if let Some(Segment::Done { samples, start_ms }) = seg.push(c) {
                match transcribe(binary, model, language, &wav, &samples).await {
                    Ok(t) => emit_final(t, start_ms, samples.len()),
                    Err(e) => {
                        let _ = events.send(SttEvent::Error { source, message: e, fatal: false });
                    }
                }
                let _ = events.send(SttEvent::Partial { source, text: String::new() });
                last_partial = tokio::time::Instant::now();
            }
        }
        if seg.is_speaking()
            && last_partial.elapsed().as_millis() as u64 >= PARTIAL_EVERY_MS
            && seg.current().len() > 16_000
        {
            last_partial = tokio::time::Instant::now();
            let samples = seg.current().to_vec();
            match transcribe(binary, model, language, &wav, &samples).await {
                Ok(t) if !t.is_empty() => {
                    let _ = events.send(SttEvent::Partial { source, text: t });
                }
                Ok(_) => {}
                Err(e) => {
                    let _ = events.send(SttEvent::Error { source, message: e, fatal: false });
                }
            }
        }
    }
    // Capture stopped: flush the utterance in progress.
    if let Some(Segment::Done { samples, start_ms }) = seg.finish() {
        if let Ok(t) = transcribe(binary, model, language, &wav, &samples).await {
            emit_final(t, start_ms, samples.len());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_annotations() {
        assert_eq!(clean_output(" [BLANK_AUDIO]\n"), "");
        assert_eq!(clean_output(" Hello there.\n How are you?\n"), "Hello there. How are you?");
        assert_eq!(clean_output("[music] Okay [laughs] fine"), "Okay fine");
        assert_eq!(clean_output("(sizzling) (sizzling)"), "");
        assert_eq!(clean_output("Yes. (tense music) *applause* Agreed."), "Yes. Agreed.");
    }

    /// Drives the provider loop with synthetic audio and a stand-in
    /// `whisper-cli` script (no model needed): speech yields partials, then a
    /// final after silence; an utterance in progress is flushed on stop.
    #[cfg(unix)]
    #[tokio::test]
    async fn emits_partials_then_final_and_flushes_on_stop() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let fake = dir.path().join("fake-whisper");
        std::fs::write(&fake, "#!/bin/sh\necho ' Fake words. [BLANK_AUDIO]'\n").unwrap();
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        let model = dir.path().join("model.bin");
        std::fs::write(&model, b"x").unwrap();

        let (tx, rx) = mpsc::channel(4096);
        let (ev_tx, mut ev_rx) = mpsc::unbounded_channel();
        let task = tokio::spawn({
            let (fake, model, work) = (fake.clone(), model.clone(), dir.path().to_path_buf());
            async move {
                run(fake.to_str().unwrap(), model.to_str().unwrap(), "en", &work, Source::System, rx, ev_tx, CancellationToken::new()).await
            }
        });
        let block = |level: i16| vec![level; 1600]; // 100 ms
        // 0.3 s silence, 2.5 s speech (paced so the partial timer can fire), 1 s silence.
        for _ in 0..3 { tx.send(block(0)).await.unwrap(); }
        for i in 0..25 {
            tx.send(block(if i % 2 == 0 { 9000 } else { -9000 })).await.unwrap();
            tokio::time::sleep(std::time::Duration::from_millis(80)).await;
        }
        for _ in 0..10 { tx.send(block(0)).await.unwrap(); }
        // Second utterance left open when capture stops.
        for _ in 0..5 { tx.send(block(9000)).await.unwrap(); }
        drop(tx);
        task.await.unwrap();

        let mut events = Vec::new();
        while let Ok(e) = ev_rx.try_recv() { events.push(e); }
        let partials = events.iter().filter(|e| matches!(e, SttEvent::Partial { text, .. } if !text.is_empty())).count();
        let finals: Vec<_> = events.iter().filter_map(|e| match e { SttEvent::Final { text, start_ms, .. } => Some((text.clone(), *start_ms)), _ => None }).collect();
        assert!(partials >= 1, "{events:?}");
        assert_eq!(finals.len(), 2, "{events:?}");
        assert_eq!(finals[0], ("Fake words.".to_string(), 300));
        assert!(finals[1].1 > finals[0].1);
    }

    #[tokio::test]
    async fn missing_model_reports_fatal_error() {
        let (_tx, rx) = mpsc::channel(1);
        let (ev_tx, mut ev_rx) = mpsc::unbounded_channel();
        run("whisper-cli", "/nonexistent/model.bin", "en", &std::env::temp_dir(), Source::Mic, rx, ev_tx, CancellationToken::new()).await;
        match ev_rx.recv().await {
            Some(SttEvent::Error { fatal: true, message, .. }) => assert!(message.contains("model file not found")),
            other => panic!("unexpected {other:?}"),
        }
    }
}
