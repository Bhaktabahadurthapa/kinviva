//! Small streaming resampler + downmixer used to normalise every capture
//! source to 16 kHz mono i16, the format both speech providers accept.
//!
//! Linear interpolation is adequate for speech recognition input; it is not
//! intended for high-fidelity audio.

pub const TARGET_RATE: u32 = 16_000;

pub struct Resampler {
    step: f64,
    pos: f64,
    last: f32,
}

impl Resampler {
    pub fn new(input_rate: u32, output_rate: u32) -> Self {
        Self {
            step: input_rate as f64 / output_rate as f64,
            pos: 0.0,
            last: 0.0,
        }
    }

    /// Resample a block of mono f32 samples. State carries across calls so
    /// consecutive blocks join without discontinuities.
    pub fn process(&mut self, input: &[f32]) -> Vec<f32> {
        if input.is_empty() {
            return Vec::new();
        }
        if (self.step - 1.0).abs() < f64::EPSILON {
            self.last = *input.last().unwrap();
            return input.to_vec();
        }
        // Index 0 is the last sample of the previous block.
        let len = input.len() + 1;
        let at = |i: usize| if i == 0 { self.last } else { input[i - 1] };
        let mut out = Vec::with_capacity((input.len() as f64 / self.step) as usize + 2);
        let mut t = self.pos;
        while t < (len - 1) as f64 {
            let i = t.floor() as usize;
            let frac = (t - i as f64) as f32;
            out.push(at(i) * (1.0 - frac) + at(i + 1) * frac);
            t += self.step;
        }
        self.pos = t - (len - 1) as f64;
        self.last = input[input.len() - 1];
        out
    }
}

/// Average interleaved channels into mono.
pub fn downmix(interleaved: &[f32], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return interleaved.to_vec();
    }
    interleaved
        .chunks(channels)
        .map(|frame| frame.iter().sum::<f32>() / frame.len() as f32)
        .collect()
}

pub fn to_i16(samples: &[f32]) -> Vec<i16> {
    samples
        .iter()
        .map(|s| (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16)
        .collect()
}

/// Root-mean-square level in 0.0..=1.0.
pub fn rms(samples: &[i16]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum: f64 = samples
        .iter()
        .map(|&s| {
            let f = s as f64 / i16::MAX as f64;
            f * f
        })
        .sum();
    (sum / samples.len() as f64).sqrt() as f32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn downsample_48k_to_16k_keeps_duration() {
        let mut r = Resampler::new(48_000, 16_000);
        let mut total = 0;
        for _ in 0..100 {
            total += r.process(&vec![0.5f32; 480]).len();
        }
        // 100 blocks * 10 ms = 1 s => ~16000 samples
        assert!((total as i64 - 16_000).abs() <= 2, "got {total}");
    }

    #[test]
    fn downsample_preserves_dc_level() {
        let mut r = Resampler::new(44_100, 16_000);
        let out = r.process(&vec![0.25f32; 4410]);
        assert!(out.iter().skip(2).all(|s| (s - 0.25).abs() < 1e-4));
    }

    #[test]
    fn downmix_averages_channels() {
        assert_eq!(downmix(&[1.0, 0.0, 0.5, 0.5], 2), vec![0.5, 0.5]);
    }

    #[test]
    fn rms_of_silence_is_zero() {
        assert_eq!(rms(&[0; 100]), 0.0);
        assert!(rms(&[i16::MAX; 10]) > 0.99);
    }
}
