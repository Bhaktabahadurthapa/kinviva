//! Energy-based utterance segmentation for chunked (non-streaming) engines.

pub struct Segmenter {
    threshold: f32,
    silence_ms_to_end: u32,
    max_ms: u32,
    buffer: Vec<i16>,
    speaking: bool,
    silence_ms: u32,
    /// Absolute position (ms) of the first sample in `buffer`.
    start_ms: i64,
    consumed_ms: i64,
}

pub enum Segment {
    /// Speech still in progress; contains the utterance so far.
    Ongoing,
    /// A complete utterance with its absolute start time.
    Done { samples: Vec<i16>, start_ms: i64 },
}

const RATE: u32 = 16_000;

impl Segmenter {
    pub fn new(threshold: f32, silence_ms_to_end: u32, max_ms: u32) -> Self {
        Self {
            threshold,
            silence_ms_to_end,
            max_ms,
            buffer: Vec::new(),
            speaking: false,
            silence_ms: 0,
            start_ms: 0,
            consumed_ms: 0,
        }
    }

    pub fn current(&self) -> &[i16] {
        &self.buffer
    }
    pub fn is_speaking(&self) -> bool {
        self.speaking
    }

    pub fn push(&mut self, chunk: &[i16]) -> Option<Segment> {
        let chunk_ms = (chunk.len() as u32 * 1000) / RATE;
        let loud = crate::audio::resample::rms(chunk) >= self.threshold;
        let pos = self.consumed_ms;
        self.consumed_ms += chunk_ms as i64;
        if !self.speaking {
            if loud {
                self.speaking = true;
                self.silence_ms = 0;
                self.start_ms = pos;
                self.buffer.clear();
                self.buffer.extend_from_slice(chunk);
                return Some(Segment::Ongoing);
            }
            return None;
        }
        self.buffer.extend_from_slice(chunk);
        self.silence_ms = if loud { 0 } else { self.silence_ms + chunk_ms };
        let len_ms = (self.buffer.len() as u32 * 1000) / RATE;
        if self.silence_ms >= self.silence_ms_to_end || len_ms >= self.max_ms {
            return self.finish();
        }
        Some(Segment::Ongoing)
    }

    /// Force the current utterance to end (e.g. capture stopped).
    pub fn finish(&mut self) -> Option<Segment> {
        if !self.speaking {
            return None;
        }
        self.speaking = false;
        self.silence_ms = 0;
        Some(Segment::Done {
            samples: std::mem::take(&mut self.buffer),
            start_ms: self.start_ms,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chunk(level: i16) -> Vec<i16> {
        vec![level; 1600] // 100 ms
    }

    #[test]
    fn splits_utterance_on_silence() {
        let mut s = Segmenter::new(0.02, 500, 15_000);
        assert!(s.push(&chunk(0)).is_none());
        assert!(matches!(s.push(&chunk(8000)), Some(Segment::Ongoing)));
        for _ in 0..4 {
            assert!(matches!(s.push(&chunk(0)), Some(Segment::Ongoing)));
        }
        match s.push(&chunk(0)) {
            Some(Segment::Done { samples, start_ms }) => {
                assert_eq!(start_ms, 100);
                assert_eq!(samples.len(), 1600 * 6);
            }
            _ => panic!("expected utterance end"),
        }
        assert!(!s.is_speaking());
    }

    #[test]
    fn caps_long_utterances() {
        let mut s = Segmenter::new(0.02, 500, 1_000);
        let mut done = false;
        for _ in 0..12 {
            if let Some(Segment::Done { .. }) = s.push(&chunk(8000)) {
                done = true;
                break;
            }
        }
        assert!(done);
    }
}
