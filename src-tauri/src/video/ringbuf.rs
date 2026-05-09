//! In-memory ring buffer of encoded segments. Hot tier — last N seconds for
//! instant scrub-back. Backed by VecDeque rather than the `ringbuf` crate so
//! the default build has zero new dependencies.

use std::collections::VecDeque;

use super::types::EncodedSegment;

pub struct RingBuffer {
    capacity_bytes: usize,
    bytes_used: usize,
    segments: VecDeque<EncodedSegment>,
}

impl RingBuffer {
    pub fn new(capacity_bytes: usize) -> Self {
        Self {
            capacity_bytes,
            bytes_used: 0,
            segments: VecDeque::new(),
        }
    }

    pub fn capacity_bytes(&self) -> usize {
        self.capacity_bytes
    }

    pub fn bytes_used(&self) -> u64 {
        self.bytes_used as u64
    }

    pub fn len(&self) -> usize {
        self.segments.len()
    }

    pub fn is_empty(&self) -> bool {
        self.segments.is_empty()
    }

    /// Push a new segment. Older segments are evicted (oldest first) until the
    /// new total fits the byte cap. A single segment larger than the cap is
    /// rejected silently — caller can detect via `len()` not changing.
    pub fn push(&mut self, segment: EncodedSegment) {
        let size = segment.byte_size();
        if size > self.capacity_bytes {
            return;
        }
        while self.bytes_used + size > self.capacity_bytes {
            match self.segments.pop_front() {
                Some(evicted) => {
                    self.bytes_used = self.bytes_used.saturating_sub(evicted.byte_size());
                }
                None => break,
            }
        }
        self.bytes_used += size;
        self.segments.push_back(segment);
    }

    /// Returns segments overlapping the wall-clock window [start_ms, end_ms].
    pub fn segments_in_range(&self, start_ms: i64, end_ms: i64) -> Vec<&EncodedSegment> {
        self.segments
            .iter()
            .filter(|s| {
                let s_end = s.end_ms.unwrap_or(s.start_ms + s.duration_ms as i64);
                s.start_ms <= end_ms && s_end >= start_ms
            })
            .collect()
    }

    /// Drain all segments out of the buffer. Used when stopping capture or
    /// when persisting RAM tier to disk on shutdown.
    pub fn drain(&mut self) -> Vec<EncodedSegment> {
        let v: Vec<_> = self.segments.drain(..).collect();
        self.bytes_used = 0;
        v
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::video::types::PrivacyFlag;

    fn seg(start_ms: i64, duration_ms: u64, size_bytes: usize) -> EncodedSegment {
        EncodedSegment {
            monitor_idx: 0,
            start_ms,
            end_ms: Some(start_ms + duration_ms as i64),
            duration_ms,
            width: 1920,
            height: 1080,
            frame_count: 60,
            bytes: vec![0u8; size_bytes],
            privacy_flag: PrivacyFlag::Normal,
        }
    }

    #[test]
    fn respects_byte_cap_evicting_oldest() {
        let mut rb = RingBuffer::new(1000);
        rb.push(seg(0, 1000, 400));
        rb.push(seg(1000, 1000, 400));
        rb.push(seg(2000, 1000, 400));
        // 1200 > 1000 → oldest evicted, total 800
        assert_eq!(rb.len(), 2);
        assert_eq!(rb.bytes_used(), 800);
        let kept_starts: Vec<i64> = rb.segments.iter().map(|s| s.start_ms).collect();
        assert_eq!(kept_starts, vec![1000, 2000]);
    }

    #[test]
    fn rejects_single_oversize_segment() {
        let mut rb = RingBuffer::new(500);
        rb.push(seg(0, 1000, 1000));
        assert_eq!(rb.len(), 0);
        assert_eq!(rb.bytes_used(), 0);
    }

    #[test]
    fn segments_in_range_overlap_correctly() {
        let mut rb = RingBuffer::new(10_000);
        rb.push(seg(0, 1000, 100));      // 0..1000
        rb.push(seg(1000, 1000, 100));   // 1000..2000
        rb.push(seg(2000, 1000, 100));   // 2000..3000

        // Query 1500..1800 — only middle segment overlaps
        let hits = rb.segments_in_range(1500, 1800);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].start_ms, 1000);

        // Query 800..2200 — first three all overlap
        let hits = rb.segments_in_range(800, 2200);
        assert_eq!(hits.len(), 3);
    }

    #[test]
    fn ram_minutes_5_corresponds_to_real_capacity() {
        // Sanity check on the heuristic: 5 minutes at 3.5 Mbps avg ≈ 131 MB
        let cap = crate::video::types::VideoStartOpts {
            ram_minutes: 5,
            ..Default::default()
        }
        .ram_capacity_bytes();
        assert!(cap > 100_000_000 && cap < 200_000_000);
    }

    #[test]
    fn drain_empties_buffer_and_returns_segments() {
        let mut rb = RingBuffer::new(10_000);
        rb.push(seg(0, 1000, 100));
        rb.push(seg(1000, 1000, 100));
        let drained = rb.drain();
        assert_eq!(drained.len(), 2);
        assert!(rb.is_empty());
        assert_eq!(rb.bytes_used(), 0);
    }
}
