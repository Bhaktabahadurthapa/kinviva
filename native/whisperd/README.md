# meetinglens-whisperd

A small C++ speech-to-text helper for MeetingLens. It links the same
[whisper.cpp](https://github.com/ggml-org/whisper.cpp) (v1.9.4, pinned in
`CMakeLists.txt`) that people already install, keeps **one model loaded** for a
whole meeting, and serves **one state per audio channel** so "Them" and "Me"
run in parallel on shared weights.

It is an application-owned child process, never a network service: it only
talks over the stdin/stdout pipes of the app that started it.

## Build

```bash
./native/whisperd/build.sh        # needs cmake, ninja, a C++17 compiler, git, network
```

Produces `native/whisperd/dist/meetinglens-whisperd-<target-triple>` (about
3.8 MB, static whisper.cpp, GPU code embedded, only macOS system frameworks
linked). `./scripts/build-mac-app.sh` builds it if missing and bundles it into
the app as a Tauri sidecar. macOS only so far; the code avoids platform-specific
APIs apart from a parent-process watchdog and binary-mode pipes behind `#ifdef`s,
but no other platform has been built or tested.

## Protocol v1

stdin: a UTF-8 JSON **header line**, optionally followed by exactly `bytes` raw
bytes. stdout: one JSON object per line. stderr: warnings and errors only;
**never transcript text**. Every message carries `"v": 1`.

| Direction | Message | Meaning |
|---|---|---|
| out | `{"event":"ready","protocol":1,"version":…,"whisper":…,"max_payload_bytes":…}` | sent once at start |
| in | `{"op":"hello"}` → `{"event":"hello",…}` | version and system info |
| in | `{"op":"load","id":N,"model":"/path.bin","language":"en","threads":4,"use_gpu":true}` | load the model once → `{"event":"loaded","id":N,"ms":…}` |
| in | `{"op":"transcribe","id":N,"stream":"system","bytes":B}` + B bytes | PCM16 little-endian, mono, 16 kHz, at most 60 s |
| out | `{"event":"result","id":N,"stream":…,"text":…,"audio_ms":…,"ms":…}` | transcript of that clip |
| in | `{"op":"cancel","id":N}` | abort a queued or running clip → `{"event":"cancelled","id":N}` |
| in | `{"op":"shutdown"}` | finish, free the model, exit 0 |
| out | `{"event":"error","code":…,"message":…,"id":N?}` | `unknown_op`, `not_loaded`, `load_failed`, `inference_failed`, … |

Audio is **not** JSON: samples travel as a bounded binary payload directly after
their header, so high-frequency audio never goes through a JSON encoder.

Fatal protocol errors (unparsable header, oversized or odd-length payload) are
reported and end the process with exit code 2 after a clean shutdown. Closing
stdin, or the parent process disappearing (checked every 250 ms, even during a
model load), ends the process without orphaning it.

Up to 4 named streams are created on first use.

## Test hooks

With `MEETINGLENS_WHISPERD_FAKE=1` no model is loaded: `transcribe` returns
`fake transcript <audio_ms> ms` after `fake_delay_ms` (set in `load`), and the
extra op `crash` aborts the process. The Rust tests use this to check timeouts,
cancellation, crash restart and cleanup against the real binary.
