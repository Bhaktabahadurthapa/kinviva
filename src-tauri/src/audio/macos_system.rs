//! macOS system-audio capture via ScreenCaptureKit (macOS 13+).
//!
//! ScreenCaptureKit requires the Screen & System Audio Recording permission.
//! We request a tiny video surface and only consume the audio output.
//! MeetingLens plays no audio, so nothing is excluded. (Excluding the
//! "current process" also silenced audio from child processes of the same
//! responsible app during testing.)

use super::resample::{to_i16, Resampler, TARGET_RATE};
use super::{CaptureHandle, CaptureSink};
use screencapturekit::prelude::*;
use std::sync::Mutex;

const SAMPLE_RATE: u32 = 48_000;

pub fn start(sink: CaptureSink) -> Result<CaptureHandle, String> {
    CaptureHandle::spawn("system", move |stop, ready| {
        let content = match SCShareableContent::get() {
            Ok(c) => c,
            Err(e) => {
                return ready(Err(format!(
                    "System audio needs Screen & System Audio Recording permission \
                     (System Settings → Privacy & Security). Details: {e}"
                )))
            }
        };
        let displays = content.displays();
        let Some(display) = displays.first() else {
            return ready(Err("No display available for ScreenCaptureKit.".into()));
        };
        let filter = SCContentFilter::create()
            .with_display(display)
            .with_excluding_windows(&[])
            .build();
        let config = SCStreamConfiguration::new()
            .with_width(2)
            .with_height(2)
            .with_captures_audio(true)
            .with_sample_rate(SAMPLE_RATE as i32)
            .with_channel_count(1);

        let resampler = Mutex::new(Resampler::new(SAMPLE_RATE, TARGET_RATE));
        let audio_sink = sink.clone();
        let mut stream = SCStream::new(&filter, &config);
        stream.add_output_handler(
            move |sample: CMSampleBuffer, kind: SCStreamOutputType| {
                if !matches!(kind, SCStreamOutputType::Audio) {
                    return;
                }
                let Some(list) = sample.audio_buffer_list() else { return };
                // Float32, non-interleaved; with one channel requested we use buffer 0.
                let Some(buf) = list.get(0) else { return };
                let bytes = buf.data();
                let samples: Vec<f32> = bytes
                    .chunks_exact(4)
                    .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
                    .collect();
                let out = resampler.lock().unwrap().process(&samples);
                audio_sink.push(to_i16(&out));
            },
            SCStreamOutputType::Audio,
        );
        if let Err(e) = stream.start_capture() {
            return ready(Err(format!(
                "Could not start system-audio capture. Grant Screen & System Audio \
                 Recording permission and restart MeetingLens. Details: {e}"
            )));
        }
        ready(Ok("System audio (ScreenCaptureKit)".into()));
        let _ = stop.recv();
        if let Err(e) = stream.stop_capture() {
            sink.fault(format!("Error while stopping system audio: {e}"));
        }
    })
}
