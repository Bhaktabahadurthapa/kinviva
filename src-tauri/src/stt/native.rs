//! Client for the bundled C++ speech helper, `kinviva-whisperd`.
//!
//! The helper is an application-owned child process that keeps one
//! whisper.cpp model loaded for the whole meeting (one state per audio
//! channel). Control and results are versioned JSON lines; audio travels as a
//! bounded binary payload (<= 60 s of 16 kHz PCM16) right after its header.
//! See `native/whisperd/README.md` for the protocol.
//!
//! Failure handling: every request has a timeout and can be cancelled; a
//! crashed or hung helper is replaced (a few times per meeting); the helper
//! exits by itself when this process closes its stdin.

use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU32, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, Command};
use tokio::sync::{mpsc, oneshot, watch, Mutex as AsyncMutex};
use tokio_util::sync::CancellationToken;

pub const PROTOCOL: i64 = 1;
/// Largest clip the helper accepts (60 s of 16 kHz mono PCM16).
pub const MAX_CLIP_SAMPLES: usize = 16_000 * 60;
const READY_TIMEOUT: Duration = Duration::from_secs(15);
/// The first run on a Mac compiles GPU shaders (~15 s); later loads take ~0.1 s.
const LOAD_TIMEOUT: Duration = Duration::from_secs(180);
pub const DEFAULT_CLIP_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_RESTARTS: u32 = 3;
const STDERR_TAIL_LINES: usize = 20;

#[derive(Debug, Clone, PartialEq)]
pub enum NativeError {
    /// Cannot continue (could not start or load, or it keeps crashing).
    Fatal(String),
    /// This clip failed (timeout, crash, inference error); later clips may work.
    Transient(String),
    Cancelled,
}

#[derive(Debug)]
enum Reply {
    Done(String),
    Cancelled,
    Error(String),
    Died(String),
}

#[derive(Clone)]
pub struct Config {
    pub path: PathBuf,
    pub model: String,
    pub language: String,
    pub threads: u32,
    /// Extra environment for the child (used by tests).
    pub env: Vec<(String, String)>,
    /// Extra fields merged into the `load` message (used by tests).
    pub extra_load: Value,
}

/// Where the helper lives: next to the app executable in a bundle, or the
/// development build output. `KINVIVA_WHISPERD` overrides both.
pub fn locate_helper() -> Option<PathBuf> {
    locate_in(std::env::var("KINVIVA_WHISPERD").ok())
}

fn locate_in(override_path: Option<String>) -> Option<PathBuf> {
    let name = if cfg!(windows) { "kinviva-whisperd.exe" } else { "kinviva-whisperd" };
    if let Some(p) = override_path {
        let p = PathBuf::from(p);
        if p.is_file() {
            return Some(p);
        }
    }
    if let Some(dir) = std::env::current_exe().ok().and_then(|e| e.parent().map(Path::to_path_buf)) {
        let p = dir.join(name);
        if p.is_file() {
            return Some(p);
        }
    }
    #[cfg(all(debug_assertions, target_os = "macos"))]
    {
        let triple = if cfg!(target_arch = "aarch64") { "aarch64-apple-darwin" } else { "x86_64-apple-darwin" };
        let p = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../native/whisperd/dist")
            .join(format!("kinviva-whisperd-{triple}"));
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

/// One running helper process.
struct Helper {
    pid: Option<u32>,
    stdin: AsyncMutex<Option<ChildStdin>>,
    pending: Mutex<HashMap<i64, oneshot::Sender<Reply>>>,
    next_id: AtomicI64,
    alive: AtomicBool,
    death: Mutex<Option<String>>,
    kill_tx: mpsc::UnboundedSender<()>,
    died: watch::Receiver<bool>,
}

fn describe_exit(status: &std::process::ExitStatus) -> String {
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        if let Some(sig) = status.signal() {
            return format!("signal {sig}");
        }
    }
    match status.code() {
        Some(c) => format!("exit code {c}"),
        None => "unknown exit".into(),
    }
}

impl Helper {
    fn is_alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    fn death_reason(&self) -> String {
        self.death.lock().unwrap().clone().unwrap_or_else(|| "The speech engine is not running.".into())
    }

    fn resolve(&self, id: i64, reply: Reply) {
        if let Some(tx) = self.pending.lock().unwrap().remove(&id) {
            let _ = tx.send(reply);
        }
    }

    fn dispatch(&self, v: &Value, ready: &mut Option<oneshot::Sender<Result<(), String>>>) {
        let id = v["id"].as_i64();
        match v["event"].as_str() {
            Some("ready") => {
                if let Some(tx) = ready.take() {
                    let ok = v["protocol"].as_i64() == Some(PROTOCOL);
                    let _ = tx.send(if ok {
                        Ok(())
                    } else {
                        Err(format!("the speech engine speaks protocol {}, this app expects {PROTOCOL}", v["protocol"]))
                    });
                }
            }
            Some("loaded") => {
                if let Some(id) = id {
                    self.resolve(id, Reply::Done(String::new()));
                }
            }
            Some("result") => {
                if let Some(id) = id {
                    self.resolve(id, Reply::Done(v["text"].as_str().unwrap_or("").to_string()));
                }
            }
            Some("cancelled") => {
                if let Some(id) = id {
                    self.resolve(id, Reply::Cancelled);
                }
            }
            Some("error") => {
                let msg = format!("{}: {}", v["code"].as_str().unwrap_or("error"), v["message"].as_str().unwrap_or(""));
                match id {
                    Some(id) => self.resolve(id, Reply::Error(msg)),
                    // Not tied to a request, e.g. a protocol error; the process
                    // exits next and the exit handler reports it.
                    None => log::warn!("speech engine: {msg}"),
                }
            }
            _ => {}
        }
    }

    /// Sends a message that expects a reply (and optional PCM payload).
    async fn send(&self, mut header: Value, payload: Option<&[i16]>) -> Result<(i64, oneshot::Receiver<Reply>), String> {
        if !self.is_alive() {
            return Err(self.death_reason());
        }
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        header["v"] = json!(PROTOCOL);
        header["id"] = json!(id);
        if let Some(p) = payload {
            header["bytes"] = json!(p.len() * 2);
        }
        let mut buf = serde_json::to_vec(&header).map_err(|e| e.to_string())?;
        buf.push(b'\n');
        if let Some(p) = payload {
            buf.reserve(p.len() * 2);
            for s in p {
                buf.extend_from_slice(&s.to_le_bytes());
            }
        }
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, tx);
        if let Err(e) = self.write(&buf).await {
            self.pending.lock().unwrap().remove(&id);
            return Err(e);
        }
        Ok((id, rx))
    }

    /// Sends a message that has no reply (cancel, shutdown).
    async fn control(&self, mut header: Value) -> Result<(), String> {
        header["v"] = json!(PROTOCOL);
        let mut buf = serde_json::to_vec(&header).map_err(|e| e.to_string())?;
        buf.push(b'\n');
        self.write(&buf).await
    }

    async fn write(&self, buf: &[u8]) -> Result<(), String> {
        let mut guard = self.stdin.lock().await;
        let Some(stdin) = guard.as_mut() else { return Err(self.death_reason()) };
        let res = async {
            stdin.write_all(buf).await?;
            stdin.flush().await
        }
        .await;
        res.map_err(|e| format!("{} ({e})", self.death_reason()))
    }

    fn kill(&self) {
        let _ = self.kill_tx.send(());
    }

    async fn transcribe(&self, stream: &str, samples: &[i16], timeout: Duration, cancel: &CancellationToken) -> Result<String, NativeError> {
        if samples.len() > MAX_CLIP_SAMPLES {
            return Err(NativeError::Transient("audio clip is too long for the speech engine".into()));
        }
        let (id, rx) = self
            .send(json!({"op": "transcribe", "stream": stream}), Some(samples))
            .await
            .map_err(NativeError::Transient)?;
        tokio::select! {
            r = tokio::time::timeout(timeout, rx) => match r {
                Ok(Ok(Reply::Done(t))) => Ok(t),
                Ok(Ok(Reply::Cancelled)) => Err(NativeError::Cancelled),
                Ok(Ok(Reply::Error(e))) => Err(NativeError::Transient(e)),
                Ok(Ok(Reply::Died(d))) => Err(NativeError::Transient(d)),
                Ok(Err(_)) => Err(NativeError::Transient(self.death_reason())),
                Err(_) => {
                    // Hung: replace the process rather than wait forever.
                    self.pending.lock().unwrap().remove(&id);
                    self.kill();
                    Err(NativeError::Transient("The speech engine stopped responding and was restarted.".into()))
                }
            },
            _ = cancel.cancelled() => {
                self.pending.lock().unwrap().remove(&id);
                let _ = self.control(json!({"op": "cancel", "id": id})).await;
                Err(NativeError::Cancelled)
            }
        }
    }

    /// Asks the helper to exit; kills it if it does not within two seconds.
    async fn shutdown(&self) {
        let _ = self.control(json!({"op": "shutdown"})).await;
        let mut died = self.died.clone();
        let wait = died.wait_for(|d| *d);
        if tokio::time::timeout(Duration::from_secs(2), wait).await.is_err() {
            self.kill();
            let mut died = self.died.clone();
            let _ = tokio::time::timeout(Duration::from_secs(2), died.wait_for(|d| *d)).await;
        }
        // Closing stdin also tells a still-running helper to exit.
        self.stdin.lock().await.take();
    }
}

/// Starts the process and performs the handshake (ready, then load).
async fn start(cfg: &Config) -> Result<Arc<Helper>, String> {
    let mut cmd = Command::new(&cfg.path);
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    for (k, v) in &cfg.env {
        cmd.env(k, v);
    }
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Could not start the speech engine at \"{}\": {e}", cfg.path.display()))?;
    let stdin = child.stdin.take().ok_or("speech engine has no stdin")?;
    let stdout = child.stdout.take().ok_or("speech engine has no stdout")?;
    let stderr = child.stderr.take().ok_or("speech engine has no stderr")?;

    let (kill_tx, mut kill_rx) = mpsc::unbounded_channel::<()>();
    let (died_tx, died_rx) = watch::channel(false);
    let helper = Arc::new(Helper {
        pid: child.id(),
        stdin: AsyncMutex::new(Some(stdin)),
        pending: Mutex::new(HashMap::new()),
        next_id: AtomicI64::new(1),
        alive: AtomicBool::new(true),
        death: Mutex::new(None),
        kill_tx,
        died: died_rx,
    });

    // Last stderr lines, for crash reports. The helper logs warnings and
    // errors only, never transcript text.
    let tail: Arc<Mutex<VecDeque<String>>> = Arc::new(Mutex::new(VecDeque::new()));
    tokio::spawn({
        let tail = tail.clone();
        async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let mut t = tail.lock().unwrap();
                if t.len() >= STDERR_TAIL_LINES {
                    t.pop_front();
                }
                t.push_back(line.chars().take(300).collect());
            }
        }
    });

    let (ready_tx, ready_rx) = oneshot::channel::<Result<(), String>>();
    let reader = tokio::spawn({
        let h = helper.clone();
        async move {
            let mut ready = Some(ready_tx);
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if let Ok(v) = serde_json::from_str::<Value>(&line) {
                    h.dispatch(&v, &mut ready);
                }
            }
        }
    });

    // Owns the child: reports how it ended and fails anything still waiting.
    tokio::spawn({
        let h = helper.clone();
        let tail = tail.clone();
        async move {
            let how = tokio::select! {
                s = child.wait() => s.map(|s| describe_exit(&s)).unwrap_or_else(|e| format!("wait failed: {e}")),
                _ = kill_rx.recv() => {
                    let _ = child.kill().await;
                    "stopped".to_string()
                }
            };
            // Let the reader deliver anything the process wrote before it ended.
            let _ = tokio::time::timeout(Duration::from_millis(500), reader).await;
            let last: Vec<String> = tail.lock().unwrap().iter().rev().take(3).cloned().collect::<Vec<_>>().into_iter().rev().collect();
            let mut reason = match h.pid {
                Some(pid) => format!("The speech engine (process {pid}) stopped unexpectedly ({how})."),
                None => format!("The speech engine stopped unexpectedly ({how})."),
            };
            if !last.is_empty() {
                reason.push(' ');
                reason.push_str(&last.join(" | "));
            }
            *h.death.lock().unwrap() = Some(reason.clone());
            h.alive.store(false, Ordering::SeqCst);
            let pending: Vec<_> = h.pending.lock().unwrap().drain().collect();
            for (_, tx) in pending {
                let _ = tx.send(Reply::Died(reason.clone()));
            }
            let _ = died_tx.send(true);
        }
    });

    match tokio::time::timeout(READY_TIMEOUT, ready_rx).await {
        Ok(Ok(Ok(()))) => {}
        Ok(Ok(Err(e))) => {
            helper.kill();
            return Err(e);
        }
        _ => {
            let why = helper.death_reason();
            helper.kill();
            return Err(format!("The speech engine did not start. {why}"));
        }
    }

    let mut load = json!({"op": "load", "model": cfg.model, "language": cfg.language, "threads": cfg.threads});
    if let (Some(base), Some(extra)) = (load.as_object_mut(), cfg.extra_load.as_object()) {
        for (k, v) in extra {
            base.insert(k.clone(), v.clone());
        }
    }
    let (_, rx) = helper.send(load, None).await?;
    match tokio::time::timeout(LOAD_TIMEOUT, rx).await {
        Ok(Ok(Reply::Done(_))) => Ok(helper),
        Ok(Ok(Reply::Error(e))) => {
            helper.kill();
            Err(format!("The speech model could not be loaded ({e}). Check the model file in Settings → Speech."))
        }
        other => {
            let why = match other {
                Ok(Ok(Reply::Died(d))) => d,
                Err(_) => "Loading the speech model took too long.".to_string(),
                _ => helper.death_reason(),
            };
            helper.kill();
            Err(why)
        }
    }
}

/// Shared by the channels of one meeting: one helper, restarted if it dies.
pub struct NativeHub {
    cfg: Config,
    current: AsyncMutex<Option<Arc<Helper>>>,
    restarts: AtomicU32,
    users: AtomicUsize,
    clip_timeout_ms: AtomicU64,
}

impl std::fmt::Debug for NativeHub {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("NativeHub").field("path", &self.cfg.path).finish()
    }
}

impl NativeHub {
    /// `users` is how many channels will call [`release`](Self::release).
    pub fn new(cfg: Config, users: usize) -> Arc<Self> {
        Arc::new(Self {
            cfg,
            current: AsyncMutex::new(None),
            restarts: AtomicU32::new(0),
            users: AtomicUsize::new(users),
            clip_timeout_ms: AtomicU64::new(DEFAULT_CLIP_TIMEOUT.as_millis() as u64),
        })
    }

    /// How long one clip may take before the helper is considered hung.
    pub fn set_clip_timeout(&self, d: Duration) {
        self.clip_timeout_ms.store(d.as_millis() as u64, Ordering::SeqCst);
    }

    async fn helper(&self) -> Result<Arc<Helper>, NativeError> {
        let mut cur = self.current.lock().await;
        if let Some(h) = cur.as_ref() {
            if h.is_alive() {
                return Ok(h.clone());
            }
            if self.restarts.fetch_add(1, Ordering::SeqCst) >= MAX_RESTARTS {
                return Err(NativeError::Fatal(format!(
                    "The speech engine crashed {MAX_RESTARTS} times in this meeting. Stop the meeting, then check Settings → Speech."
                )));
            }
        }
        let h = start(&self.cfg).await.map_err(NativeError::Fatal)?;
        *cur = Some(h.clone());
        Ok(h)
    }

    /// Starts the helper if needed (the first call can take ~15 s on a fresh Mac).
    pub async fn ensure_started(&self) -> Result<(), NativeError> {
        self.helper().await.map(|_| ())
    }

    pub async fn transcribe(&self, stream: &str, samples: &[i16], cancel: &CancellationToken) -> Result<String, NativeError> {
        let h = self.helper().await?;
        let timeout = Duration::from_millis(self.clip_timeout_ms.load(Ordering::SeqCst));
        h.transcribe(stream, samples, timeout, cancel).await
    }

    /// Called by each channel when it finishes; the last one stops the helper.
    pub async fn release(&self) {
        if self.users.fetch_sub(1, Ordering::SeqCst) == 1 {
            self.shutdown().await;
        }
    }

    pub async fn shutdown(&self) {
        if let Some(h) = self.current.lock().await.take() {
            h.shutdown().await;
        }
    }
}

impl Drop for NativeHub {
    /// Backstop for a hub dropped without a clean stop (e.g. its tasks were
    /// aborted): make sure the child does not outlive its owner.
    fn drop(&mut self) {
        if let Ok(mut cur) = self.current.try_lock() {
            if let Some(h) = cur.take() {
                h.kill();
            }
        }
    }
}

/// Starts the helper, loads the model and shuts it down again. Run once in
/// the background at app start so macOS compiles the GPU shaders before the
/// first meeting instead of during it.
pub async fn prime(cfg: Config) -> Result<Duration, String> {
    let t = std::time::Instant::now();
    let h = start(&cfg).await?;
    h.shutdown().await;
    Ok(t.elapsed())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_cfg() -> Option<Config> {
        let path = locate_helper()?;
        Some(Config {
            path,
            model: "unused".into(),
            language: "en".into(),
            threads: 2,
            env: vec![("KINVIVA_WHISPERD_FAKE".into(), "1".into())],
            extra_load: json!({}),
        })
    }

    macro_rules! helper_or_skip {
        () => {
            match fake_cfg() {
                Some(c) => c,
                None => {
                    eprintln!("skipped: native helper not built (run native/whisperd/build.sh)");
                    return;
                }
            }
        };
    }

    #[cfg(unix)]
    fn pid_alive(pid: u32) -> bool {
        std::process::Command::new("kill").args(["-0", &pid.to_string()]).stderr(Stdio::null()).status().map(|s| s.success()).unwrap_or(false)
    }

    #[cfg(windows)]
    fn pid_alive(pid: u32) -> bool {
        // tasklist prints the process row (containing the pid) only while it exists.
        let out = std::process::Command::new("tasklist").args(["/FI", &format!("PID eq {pid}"), "/NH"]).output();
        out.map(|o| String::from_utf8_lossy(&o.stdout).split_whitespace().any(|w| w == pid.to_string())).unwrap_or(false)
    }

    impl NativeHub {
        async fn current(&self) -> Option<Arc<Helper>> {
            self.current.lock().await.clone()
        }
    }

    async fn wait_dead(h: &Arc<Helper>) {
        let mut died = h.died.clone();
        tokio::time::timeout(Duration::from_secs(5), died.wait_for(|d| *d)).await.expect("exit not noticed in time").unwrap();
    }

    fn secs(n: u64) -> Duration {
        Duration::from_secs(n)
    }

    #[tokio::test]
    async fn transcribes_two_channels_with_one_process() {
        let cfg = helper_or_skip!();
        let hub = NativeHub::new(cfg, 2);
        hub.ensure_started().await.unwrap();
        let never = CancellationToken::new();
        let (one_second, half_second) = (vec![0i16; 16_000], vec![0i16; 8_000]);
        let (a, b) = tokio::join!(hub.transcribe("system", &one_second, &never), hub.transcribe("mic", &half_second, &never));
        assert_eq!(a.unwrap(), "fake transcript 1000 ms");
        assert_eq!(b.unwrap(), "fake transcript 500 ms");
        hub.release().await;
        hub.release().await;
    }

    #[tokio::test]
    async fn cancellation_is_prompt_and_the_engine_stays_usable() {
        let mut cfg = helper_or_skip!();
        cfg.extra_load = json!({"fake_delay_ms": 2000});
        let hub = NativeHub::new(cfg, 1);
        hub.ensure_started().await.unwrap();
        let cancel = CancellationToken::new();
        let c2 = cancel.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(150)).await;
            c2.cancel();
        });
        let t = std::time::Instant::now();
        let r = hub.transcribe("system", &vec![0i16; 16_000], &cancel).await;
        assert_eq!(r, Err(NativeError::Cancelled));
        assert!(t.elapsed() < Duration::from_millis(1000), "took {:?}", t.elapsed());
        // The helper aborted that job (it would have run 2 s) and takes another.
        let r = hub.transcribe("system", &vec![0i16; 1600], &CancellationToken::new()).await;
        assert_eq!(r.unwrap(), "fake transcript 100 ms");
        hub.shutdown().await;
    }

    #[tokio::test]
    async fn a_hung_engine_times_out_and_the_replacement_works() {
        let mut cfg = helper_or_skip!();
        cfg.extra_load = json!({"fake_delay_ms": 700});
        let hub = NativeHub::new(cfg, 1);
        hub.ensure_started().await.unwrap();
        hub.set_clip_timeout(Duration::from_millis(300)); // shorter than the 700 ms "inference"
        let old = hub.current().await.unwrap();
        match hub.transcribe("system", &vec![0i16; 16_000], &CancellationToken::new()).await {
            Err(NativeError::Transient(m)) => assert!(m.contains("stopped responding"), "{m}"),
            other => panic!("expected a timeout, got {other:?}"),
        }
        wait_dead(&old).await; // the hung process was killed
        hub.set_clip_timeout(secs(10));
        // A new process serves the next clip.
        let r = hub.transcribe("system", &vec![0i16; 16_000], &CancellationToken::new()).await;
        assert_eq!(r.unwrap(), "fake transcript 1000 ms");
        let new = hub.current().await.unwrap();
        assert_ne!(old.pid, new.pid);
        hub.shutdown().await;
    }

    #[tokio::test]
    async fn crashes_are_reported_restarted_and_finally_given_up_on() {
        let cfg = helper_or_skip!();
        let hub = NativeHub::new(cfg, 1);
        hub.ensure_started().await.unwrap();

        // First crash: the process dies, the reason names it, the next clip restarts.
        let h1 = hub.current().await.unwrap();
        h1.control(json!({"op": "crash"})).await.unwrap();
        wait_dead(&h1).await;
        assert!(h1.death_reason().contains("stopped unexpectedly"), "{}", h1.death_reason());
        let r = hub.transcribe("system", &vec![0i16; 1600], &CancellationToken::new()).await;
        assert_eq!(r.unwrap(), "fake transcript 100 ms");

        // Use up the remaining restarts.
        for _ in 0..(MAX_RESTARTS - 1) {
            let h = hub.current().await.unwrap();
            h.control(json!({"op": "crash"})).await.unwrap();
            wait_dead(&h).await;
            hub.ensure_started().await.unwrap();
        }
        // One more crash exceeds the budget: a fatal, readable error.
        let h = hub.current().await.unwrap();
        h.control(json!({"op": "crash"})).await.unwrap();
        wait_dead(&h).await;
        match hub.transcribe("system", &vec![0i16; 1600], &CancellationToken::new()).await {
            Err(NativeError::Fatal(m)) => assert!(m.contains("crashed"), "{m}"),
            other => panic!("expected a fatal error, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn releasing_the_last_channel_stops_the_process() {
        let cfg = helper_or_skip!();
        let hub = NativeHub::new(cfg, 2);
        hub.ensure_started().await.unwrap();
        let pid = hub.current().await.unwrap().pid.unwrap();
        assert!(pid_alive(pid));
        hub.release().await; // one channel left: still running
        assert!(pid_alive(pid), "stopped while a channel was still using it");
        hub.release().await;
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert!(!pid_alive(pid), "helper still running after the last release");
    }

    #[tokio::test]
    async fn dropping_the_hub_does_not_leave_a_process() {
        let cfg = helper_or_skip!();
        let hub = NativeHub::new(cfg, 1);
        hub.ensure_started().await.unwrap();
        let pid = hub.current().await.unwrap().pid.unwrap();
        drop(hub); // e.g. the app exits without a clean stop
        tokio::time::sleep(Duration::from_millis(500)).await;
        assert!(!pid_alive(pid), "helper outlived its owner");
    }

    #[tokio::test]
    async fn a_missing_helper_is_a_clear_fatal_error() {
        let hub = NativeHub::new(
            Config { path: "/nonexistent/kinviva-whisperd".into(), model: "x".into(), language: "en".into(), threads: 1, env: vec![], extra_load: json!({}) },
            1,
        );
        match hub.ensure_started().await {
            Err(NativeError::Fatal(m)) => assert!(m.contains("Could not start the speech engine"), "{m}"),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn helper_location_honours_the_override() {
        let dir = std::env::temp_dir().join("ml-locate-test");
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("fake-helper");
        std::fs::write(&f, b"x").unwrap();
        assert_eq!(locate_in(Some(f.to_string_lossy().into_owned())), Some(f));
    }
}
