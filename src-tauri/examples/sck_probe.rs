//! Diagnose ScreenCaptureKit audio: prints the delivered format and peak level
//! while playing a sound file. Usage: cargo run --example sck_probe -- <audio-file>
use screencapturekit::prelude::*;
use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};
use std::sync::Arc;

fn main() {
    let file = std::env::args().nth(1).expect("audio file");
    let content = SCShareableContent::get().expect("shareable content");
    let display = &content.displays()[0];
    let filter = SCContentFilter::create().with_display(display).with_excluding_windows(&[]).build();
    let config = SCStreamConfiguration::new()
        .with_width(2).with_height(2)
        .with_captures_audio(true)
        .with_sample_rate(48000).with_channel_count(1);
    let peak = Arc::new(AtomicU32::new(0));
    let n = Arc::new(AtomicUsize::new(0));
    let (p2, n2) = (peak.clone(), n.clone());
    let mut stream = SCStream::new(&filter, &config);
    stream.add_output_handler(move |s: CMSampleBuffer, _t: SCStreamOutputType| {
        let i = n2.fetch_add(1, Ordering::Relaxed);
        if i == 0 {
            if let Some(f) = s.format_description() {
                println!("format: rate {:?} ch {:?} bits {:?} bpf {:?} flags {:?} float {}", f.audio_sample_rate(), f.audio_channel_count(), f.audio_bits_per_channel(), f.audio_bytes_per_frame(), f.audio_format_flags(), f.audio_is_float());
            }
            if let Some(l) = s.audio_buffer_list() {
                println!("buffers {} first len {}", l.num_buffers(), l.get(0).map(|b| b.data().len()).unwrap_or(0));
            }
        }
        if let Some(l) = s.audio_buffer_list() {
            for b in l.iter() {
                for c in b.data().chunks_exact(4) {
                    let v = f32::from_le_bytes([c[0], c[1], c[2], c[3]]).abs();
                    p2.fetch_max((v * 1e6) as u32, Ordering::Relaxed);
                }
            }
        }
    }, SCStreamOutputType::Audio);
    stream.start_capture().expect("start");
    std::thread::sleep(std::time::Duration::from_millis(800));
    let st = std::process::Command::new("afplay").arg(&file).arg("-t").arg("4").status();
    println!("afplay: {:?}", st);
    stream.stop_capture().ok();
    println!("callbacks {} peak {}", n.load(Ordering::Relaxed), peak.load(Ordering::Relaxed) as f32 / 1e6);
}
