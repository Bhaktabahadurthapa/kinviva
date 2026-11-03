//! Microphone capture through cpal (CoreAudio on macOS, WASAPI on Windows).
//! On Windows the same path also provides system-audio loopback.

use super::resample::{downmix, to_i16, Resampler, TARGET_RATE};
use super::{CaptureHandle, CaptureSink, DeviceInfo};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, StreamConfig};

pub fn list_input_devices() -> Vec<DeviceInfo> {
    let host = cpal::default_host();
    let default = host.default_input_device().and_then(|d| d.name().ok());
    host.input_devices()
        .map(|devs| {
            devs.filter_map(|d| d.name().ok())
                .map(|name| DeviceInfo {
                    is_default: Some(&name) == default.as_ref(),
                    name,
                })
                .collect()
        })
        .unwrap_or_default()
}

fn find_input(host: &cpal::Host, name: &Option<String>) -> Result<cpal::Device, String> {
    if let Some(wanted) = name {
        if let Ok(mut devs) = host.input_devices() {
            if let Some(d) = devs.find(|d| d.name().map(|n| &n == wanted).unwrap_or(false)) {
                return Ok(d);
            }
        }
        return Err(format!("Microphone \"{wanted}\" is not connected."));
    }
    host.default_input_device()
        .ok_or_else(|| "No microphone found.".to_string())
}

pub fn start_input(device_name: Option<String>, sink: CaptureSink) -> Result<CaptureHandle, String> {
    CaptureHandle::spawn("mic", move |stop, ready| {
        let host = cpal::default_host();
        let device = match find_input(&host, &device_name) {
            Ok(d) => d,
            Err(e) => return ready(Err(e)),
        };
        let config = match device.default_input_config() {
            Ok(c) => c,
            Err(e) => return ready(Err(format!("Microphone unavailable: {e}"))),
        };
        let name = device.name().unwrap_or_else(|_| "microphone".into());
        match build_stream(&device, config.sample_format(), config.into(), sink) {
            Ok(stream) => {
                if let Err(e) = stream.play() {
                    return ready(Err(format!("Could not start microphone: {e}")));
                }
                ready(Ok(name));
                let _ = stop.recv();
                drop(stream);
            }
            Err(e) => ready(Err(e)),
        }
    })
}

/// Windows: capture what the default output device plays (WASAPI loopback).
#[cfg(target_os = "windows")]
pub fn start_loopback(sink: CaptureSink) -> Result<CaptureHandle, String> {
    CaptureHandle::spawn("system", move |stop, ready| {
        let host = cpal::default_host();
        let Some(device) = host.default_output_device() else {
            return ready(Err("No output device for loopback capture.".into()));
        };
        let config = match device.default_output_config() {
            Ok(c) => c,
            Err(e) => return ready(Err(format!("Loopback unavailable: {e}"))),
        };
        let name = device.name().unwrap_or_else(|_| "output".into());
        match build_stream(&device, config.sample_format(), config.into(), sink) {
            Ok(stream) => {
                if let Err(e) = stream.play() {
                    return ready(Err(format!("Could not start loopback: {e}")));
                }
                ready(Ok(format!("{name} (loopback)")));
                let _ = stop.recv();
                drop(stream);
            }
            Err(e) => ready(Err(e)),
        }
    })
}

fn build_stream(
    device: &cpal::Device,
    format: SampleFormat,
    config: StreamConfig,
    sink: CaptureSink,
) -> Result<cpal::Stream, String> {
    let channels = config.channels as usize;
    let mut resampler = Resampler::new(config.sample_rate.0, TARGET_RATE);
    let err_sink = sink.clone();
    let on_err = move |e: cpal::StreamError| {
        err_sink.fault(match e {
            cpal::StreamError::DeviceNotAvailable => "Device disconnected.".to_string(),
            other => other.to_string(),
        })
    };
    let mut deliver = move |mono: Vec<f32>| {
        let resampled = resampler.process(&mono);
        sink.push(to_i16(&resampled));
    };
    let stream = match format {
        SampleFormat::F32 => device.build_input_stream(
            &config,
            move |data: &[f32], _| deliver(downmix(data, channels)),
            on_err,
            None,
        ),
        SampleFormat::I16 => device.build_input_stream(
            &config,
            move |data: &[i16], _| {
                let f: Vec<f32> = data.iter().map(|&s| s as f32 / i16::MAX as f32).collect();
                deliver(downmix(&f, channels))
            },
            on_err,
            None,
        ),
        SampleFormat::I32 => device.build_input_stream(
            &config,
            move |data: &[i32], _| {
                let f: Vec<f32> = data.iter().map(|&s| s as f32 / i32::MAX as f32).collect();
                deliver(downmix(&f, channels))
            },
            on_err,
            None,
        ),
        other => return Err(format!("Unsupported sample format {other:?}")),
    };
    stream.map_err(|e| format!("Could not open audio stream: {e}"))
}
