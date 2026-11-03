//! Native audio capture. Microphone and system audio are separate sources with
//! separate platform implementations; both deliver 16 kHz mono i16 chunks.

pub mod cpal_capture;
#[cfg(target_os = "macos")]
pub mod macos_system;
pub mod resample;

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use tokio::sync::mpsc;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    /// The local user's microphone ("Me").
    Mic,
    /// Audio played by the computer, e.g. remote meeting participants ("Them").
    System,
}

impl Source {
    pub fn as_str(&self) -> &'static str {
        match self {
            Source::Mic => "mic",
            Source::System => "system",
        }
    }
    pub fn speaker_label(&self) -> &'static str {
        match self {
            Source::Mic => "Me",
            Source::System => "Them",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "mic" => Some(Source::Mic),
            "system" => Some(Source::System),
            _ => None,
        }
    }
}

/// Non-fatal problems reported from capture callbacks (device lost, etc.).
#[derive(Debug, Clone)]
pub struct CaptureFault {
    pub source: Source,
    pub message: String,
}

/// Shared plumbing handed to every capture implementation.
#[derive(Clone)]
pub struct CaptureSink {
    pub source: Source,
    pub audio: mpsc::Sender<Vec<i16>>,
    pub faults: mpsc::UnboundedSender<CaptureFault>,
    /// Latest RMS level * 1e6, for meters.
    pub level: Arc<AtomicU32>,
    /// Chunks dropped because the consumer fell behind.
    pub dropped: Arc<AtomicU32>,
}

impl CaptureSink {
    pub fn push(&self, chunk: Vec<i16>) {
        if chunk.is_empty() {
            return;
        }
        self.level
            .store((resample::rms(&chunk) * 1_000_000.0) as u32, Ordering::Relaxed);
        if self.audio.try_send(chunk).is_err() {
            self.dropped.fetch_add(1, Ordering::Relaxed);
        }
    }
    pub fn fault(&self, message: impl Into<String>) {
        let _ = self.faults.send(CaptureFault {
            source: self.source,
            message: message.into(),
        });
    }
}

/// A running capture. Platform streams are often `!Send`, so each one lives
/// on its own thread; dropping or stopping the handle tears it down and joins.
pub struct CaptureHandle {
    stop_tx: Option<std::sync::mpsc::Sender<()>>,
    thread: Option<std::thread::JoinHandle<()>>,
    pub description: String,
}

impl CaptureHandle {
    /// Spawn `body` on a capture thread. `body` must set up the stream, call
    /// `ready` with the outcome, then block on `stop` until asked to end.
    pub fn spawn<F>(name: &str, body: F) -> Result<Self, String>
    where
        F: FnOnce(std::sync::mpsc::Receiver<()>, &dyn Fn(Result<String, String>)) + Send + 'static,
    {
        let (stop_tx, stop_rx) = std::sync::mpsc::channel::<()>();
        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<String, String>>();
        let thread = std::thread::Builder::new()
            .name(format!("capture-{name}"))
            .spawn(move || {
                let ready = move |r: Result<String, String>| {
                    let _ = ready_tx.send(r);
                };
                body(stop_rx, &ready);
            })
            .map_err(|e| e.to_string())?;
        match ready_rx.recv_timeout(std::time::Duration::from_secs(20)) {
            Ok(Ok(description)) => Ok(Self {
                stop_tx: Some(stop_tx),
                thread: Some(thread),
                description,
            }),
            Ok(Err(e)) => {
                let _ = thread.join();
                Err(e)
            }
            Err(_) => {
                drop(stop_tx);
                Err(format!("{name} capture did not start within 20 s"))
            }
        }
    }

    pub fn stop(mut self) {
        self.shutdown();
    }

    fn shutdown(&mut self) {
        if let Some(tx) = self.stop_tx.take() {
            let _ = tx.send(());
        }
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

impl Drop for CaptureHandle {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct DeviceInfo {
    pub name: String,
    pub is_default: bool,
}

pub fn start_mic(device_name: Option<String>, sink: CaptureSink) -> Result<CaptureHandle, String> {
    cpal_capture::start_input(device_name, sink)
}

pub fn start_system(sink: CaptureSink) -> Result<CaptureHandle, String> {
    #[cfg(target_os = "macos")]
    {
        macos_system::start(sink)
    }
    #[cfg(target_os = "windows")]
    {
        cpal_capture::start_loopback(sink)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = sink;
        Err("System-audio capture is not implemented on this OS yet.".into())
    }
}
