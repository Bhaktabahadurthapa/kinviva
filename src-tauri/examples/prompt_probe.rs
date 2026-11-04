//! Replays a real transcript through the Explain / Suggest prompts to compare
//! models (developer tool, not part of the app):
//!
//!   cargo run --example prompt_probe -- <llm-base-url> <model> <transcript.txt> <focus-lines> [sources.txt]
//!
//! transcript.txt holds "Them: …" / "Me: …" lines; the last <focus-lines>
//! lines are treated as the newest speech, exactly as auto-assist does.
//! An optional sources.txt is passed as one document excerpt.

use meetinglens_lib::llm::{self, LlmConfig};
use meetinglens_lib::prompts::{self, Action, PromptInput};
use std::time::Instant;
use tokio_util::sync::CancellationToken;

#[tokio::main]
async fn main() {
    let a: Vec<String> = std::env::args().collect();
    let cfg = LlmConfig { base_url: a[1].clone(), model: a[2].clone(), api_key: None, temperature: 0.2 };
    let text = std::fs::read_to_string(&a[3]).expect("transcript file");
    let n: usize = a[4].parse().unwrap_or(2);
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    let focus = lines[lines.len().saturating_sub(n)..].join("\n");
    let passages: Vec<meetinglens_lib::db::Passage> = a
        .get(5)
        .and_then(|p| std::fs::read_to_string(p).ok().map(|t| (p.clone(), t)))
        .map(|(p, t)| vec![meetinglens_lib::db::Passage { document: p.rsplit('/').next().unwrap_or(&p).to_string(), chunk: 0, text: t }])
        .unwrap_or_default();
    for action in [Action::Explain, Action::Suggest] {
        let msgs = prompts::build(&PromptInput { action, transcript: &text, notes: "", passages: &passages, question: None, focus: Some(&focus) });
        let t = Instant::now();
        match llm::stream_chat(&cfg, msgs, CancellationToken::new(), |_| {}).await {
            Ok(out) => println!("===== {:?} · {} · {} ms\n{}\n", action, cfg.model, t.elapsed().as_millis(), out.trim()),
            Err(e) => println!("===== {:?} FAILED: {e}", action),
        }
    }
}
