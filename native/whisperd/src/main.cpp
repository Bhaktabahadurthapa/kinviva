// kinviva-whisperd: a persistent whisper.cpp speech-to-text helper.
//
// The Kinviva app starts one of these per meeting as a child process.
// The model is loaded once and kept in memory; each audio channel gets its
// own whisper state, so channels run in parallel and share the weights.
//
// Protocol v1 (see README.md). stdin: UTF-8 JSON header lines, each optionally
// followed by `bytes` raw bytes (16 kHz mono signed 16-bit little-endian PCM).
// stdout: one JSON object per line. stderr: warnings/errors only, never
// transcript text. The process exits when stdin closes (parent gone).

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <iostream>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#define NOGDI
#include <fcntl.h>
#include <io.h>
#include <windows.h>
#include <tlhelp32.h>
#else
#include <unistd.h>
#endif

#include "json.hpp"
#include "whisper.h"

using json = nlohmann::json;
using Clock = std::chrono::steady_clock;

namespace {

constexpr int kProtocol = 1;
constexpr const char *kVersion = "0.1.0";
constexpr size_t kMaxHeader = 8192;
constexpr size_t kMaxPayload = 16000u * 2u * 60u; // 60 s of audio
constexpr size_t kMaxStreams = 4;

std::mutex g_out_mutex;

void emit(json j) {
    j["v"] = kProtocol;
    std::string line = j.dump(-1, ' ', false, json::error_handler_t::replace);
    line.push_back('\n');
    std::lock_guard<std::mutex> lock(g_out_mutex);
    std::fwrite(line.data(), 1, line.size(), stdout);
    std::fflush(stdout);
}

void emit_error(const char *code, const std::string &message, const json &id = nullptr) {
    json j = {{"event", "error"}, {"code", code}, {"message", message}};
    if (!id.is_null()) j["id"] = id;
    emit(std::move(j));
}

// Test hook: with KINVIVA_WHISPERD_FAKE set, no model is loaded and
// transcription returns a canned string, so the app's process handling
// (timeouts, cancellation, crashes) can be tested without a model.
bool fake_mode() { return std::getenv("KINVIVA_WHISPERD_FAKE") != nullptr; }

void quiet_log(enum ggml_log_level level, const char *text, void *) {
    if (level >= GGML_LOG_LEVEL_WARN && text) std::fputs(text, stderr);
}

struct Job {
    int64_t id = 0;
    std::vector<float> pcm;
    int audio_ms = 0;
};

class Stream {
public:
    Stream(std::string name, whisper_context *ctx, int threads, std::string lang, int fake_delay_ms)
        : name_(std::move(name)), ctx_(ctx), threads_(threads), lang_(std::move(lang)), fake_delay_ms_(fake_delay_ms) {
        if (ctx_) state_ = whisper_init_state(ctx_);
        worker_ = std::thread([this] { run(); });
    }

    bool ok() const { return fake_mode() || state_ != nullptr; }

    ~Stream() {
        stop();
        if (state_) whisper_free_state(state_);
    }

    void push(Job job) {
        std::lock_guard<std::mutex> lock(m_);
        queue_.push_back(std::move(job));
        cv_.notify_one();
    }

    // Returns true if the job was found (queued or running).
    bool cancel(int64_t id) {
        {
            std::lock_guard<std::mutex> lock(m_);
            for (auto it = queue_.begin(); it != queue_.end(); ++it) {
                if (it->id == id) {
                    queue_.erase(it);
                    emit({{"event", "cancelled"}, {"id", id}, {"stream", name_}});
                    return true;
                }
            }
            if (running_id_ == id) {
                abort_.store(true);
                return true;
            }
        }
        return false;
    }

    void stop() {
        {
            std::lock_guard<std::mutex> lock(m_);
            if (stopping_) return;
            stopping_ = true;
            abort_.store(true);
            cv_.notify_all();
        }
        if (worker_.joinable()) worker_.join();
    }

private:
    static bool should_abort(void *self) { return static_cast<Stream *>(self)->abort_.load(); }

    void run() {
        for (;;) {
            Job job;
            {
                std::unique_lock<std::mutex> lock(m_);
                cv_.wait(lock, [this] { return stopping_ || !queue_.empty(); });
                if (stopping_) return;
                job = std::move(queue_.front());
                queue_.pop_front();
                running_id_ = job.id;
                abort_.store(false);
            }
            process(job);
            {
                std::lock_guard<std::mutex> lock(m_);
                running_id_ = -1;
            }
        }
    }

    void process(const Job &job) {
        const auto t0 = Clock::now();
        auto ms = [&] { return (int)std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now() - t0).count(); };

        std::string text;
        if (fake_mode()) {
            // Cancellable sleep, then a canned result.
            for (int waited = 0; waited < fake_delay_ms_ && !abort_.load(); waited += 10)
                std::this_thread::sleep_for(std::chrono::milliseconds(10));
            if (!abort_.load()) text = "fake transcript " + std::to_string(job.audio_ms) + " ms";
        } else {
            whisper_full_params p = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
            p.print_progress = false;
            p.print_realtime = false;
            p.print_timestamps = false;
            p.print_special = false;
            p.no_context = true;      // each clip stands alone, like whisper-cli
            p.no_timestamps = true;
            p.suppress_nst = true;    // drop "(music)" style non-speech annotations
            p.n_threads = threads_;
            p.language = lang_.c_str();
            p.abort_callback = &Stream::should_abort;
            p.abort_callback_user_data = this;
            const int rc = whisper_full_with_state(ctx_, state_, p, job.pcm.data(), (int)job.pcm.size());
            if (!abort_.load()) {
                if (rc != 0) {
                    emit_error("inference_failed", "whisper_full failed with code " + std::to_string(rc), job.id);
                    return;
                }
                const int n = whisper_full_n_segments_from_state(state_);
                for (int i = 0; i < n; ++i) {
                    const char *seg = whisper_full_get_segment_text_from_state(state_, i);
                    if (seg) text += seg;
                }
            }
        }
        if (abort_.load()) {
            emit({{"event", "cancelled"}, {"id", job.id}, {"stream", name_}});
            return;
        }
        emit({{"event", "result"}, {"id", job.id}, {"stream", name_}, {"text", text}, {"audio_ms", job.audio_ms}, {"ms", ms()}});
    }

    std::string name_;
    whisper_context *ctx_;
    whisper_state *state_ = nullptr;
    int threads_;
    std::string lang_;
    int fake_delay_ms_;

    std::mutex m_;
    std::condition_variable cv_;
    std::deque<Job> queue_;
    int64_t running_id_ = -1;
    bool stopping_ = false;
    std::atomic<bool> abort_{false};
    std::thread worker_;
};

enum class Header { Line, Eof, TooLong };

// Reads one header line (without the newline).
Header read_header(std::string &line) {
    line.clear();
    for (;;) {
        const int c = std::cin.get();
        if (c == EOF) return line.empty() ? Header::Eof : Header::Line;
        if (c == '\n') return Header::Line;
        if (c != '\r') line.push_back((char)c);
        if (line.size() > kMaxHeader) return Header::TooLong;
    }
}

#ifdef _WIN32
// Windows has no re-parenting, so wait on a handle to the parent process
// (found through a process snapshot) and exit as soon as it ends.
void start_parent_watchdog() {
    const DWORD self = GetCurrentProcessId();
    DWORD parent = 0;
    HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snap != INVALID_HANDLE_VALUE) {
        PROCESSENTRY32 e;
        e.dwSize = sizeof(e);
        for (BOOL ok = Process32First(snap, &e); ok; ok = Process32Next(snap, &e)) {
            if (e.th32ProcessID == self) {
                parent = e.th32ParentProcessID;
                break;
            }
        }
        CloseHandle(snap);
    }
    if (parent == 0) return;
    HANDLE h = OpenProcess(SYNCHRONIZE, FALSE, parent);
    if (!h) return;
    std::thread([h] {
        WaitForSingleObject(h, INFINITE);
        _exit(0);
    }).detach();
}
#else
// If the app dies while this process is busy (for instance loading a model for
// seconds), stdin's EOF is not noticed until the main thread gets back to
// reading. A watchdog notices the parent disappearing (we are re-parented)
// and exits at once. _exit skips ggml's static destructors, which assert that
// all resources were freed.
void start_parent_watchdog() {
    const pid_t parent = getppid();
    std::thread([parent] {
        for (;;) {
            std::this_thread::sleep_for(std::chrono::milliseconds(250));
            if (getppid() != parent) _exit(0);
        }
    }).detach();
}
#endif

} // namespace

int main(int argc, char **argv) {
    if (argc > 1 && std::strcmp(argv[1], "--version") == 0) {
        std::printf("kinviva-whisperd %s (whisper.cpp %s)\n", kVersion, whisper_version());
        return 0;
    }
    std::ios::sync_with_stdio(false);
    std::cin.tie(nullptr);
#ifdef _WIN32
    _setmode(_fileno(stdin), _O_BINARY);
    _setmode(_fileno(stdout), _O_BINARY);
#endif
    whisper_log_set(quiet_log, nullptr);
    start_parent_watchdog();

    emit({{"event", "ready"},
          {"name", "kinviva-whisperd"},
          {"version", kVersion},
          {"protocol", kProtocol},
          {"whisper", whisper_version()},
          {"max_payload_bytes", kMaxPayload},
          {"fake", fake_mode()}});

    whisper_context *ctx = nullptr;
    std::string language = "en";
    int threads = 4;
    int fake_delay_ms = 0;
    std::map<std::string, std::unique_ptr<Stream>> streams;
    std::mutex streams_mutex;

    // Fatal protocol errors cannot be resynchronised (the payload length is
    // unknown), so they end the loop with exit code 2 after a clean shutdown;
    // exiting abruptly would trip ggml's resource checks.
    int exit_code = 0;
    std::string line;
    for (;;) {
        const Header h = read_header(line);
        if (h == Header::Eof) break;
        if (h == Header::TooLong) {
            emit_error("protocol", "header line too long");
            exit_code = 2;
            break;
        }
        json msg;
        try {
            msg = json::parse(line);
        } catch (const std::exception &e) {
            emit_error("protocol", std::string("invalid JSON header: ") + e.what());
            exit_code = 2;
            break;
        }
        const std::string op = msg.value("op", "");
        const json id = msg.contains("id") ? msg["id"] : json(nullptr);
        const size_t bytes = msg.value("bytes", (size_t)0);

        if (bytes > kMaxPayload) {
            emit_error("protocol", "payload exceeds the maximum of " + std::to_string(kMaxPayload) + " bytes", id);
            exit_code = 2;
            break;
        }
        std::vector<int16_t> samples;
        if (bytes > 0) {
            if (bytes % 2 != 0) {
                emit_error("protocol", "payload length must be even (PCM16)", id);
                exit_code = 2;
                break;
            }
            samples.resize(bytes / 2);
            std::cin.read(reinterpret_cast<char *>(samples.data()), (std::streamsize)bytes);
            if ((size_t)std::cin.gcount() != bytes) break; // truncated: parent gone
        }

        if (msg.value("v", 0) != kProtocol) {
            emit_error("unsupported_version", "this helper speaks protocol 1", id);
            continue;
        }

        if (op == "hello") {
            emit({{"event", "hello"}, {"version", kVersion}, {"whisper", whisper_version()}, {"system", whisper_print_system_info()}});
        } else if (op == "load") {
            if (ctx || (fake_mode() && streams.size() > 0)) {
                emit_error("already_loaded", "a model is already loaded", id);
                continue;
            }
            language = msg.value("language", "en");
            threads = std::max(1, msg.value("threads", 4));
            fake_delay_ms = msg.value("fake_delay_ms", 0);
            const std::string model = msg.value("model", "");
            const auto t0 = Clock::now();
            if (fake_mode()) {
                emit({{"event", "loaded"}, {"id", id}, {"ms", 0}, {"fake", true}});
                continue;
            }
            whisper_context_params cp = whisper_context_default_params();
            cp.use_gpu = msg.value("use_gpu", true);
            ctx = whisper_init_from_file_with_params_no_state(model.c_str(), cp);
            if (!ctx) {
                emit_error("load_failed", "could not load model file", id);
                continue;
            }
            emit({{"event", "loaded"},
                  {"id", id},
                  {"ms", (int)std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now() - t0).count()},
                  {"multilingual", whisper_is_multilingual(ctx) != 0}});
        } else if (op == "transcribe") {
            if (!ctx && !fake_mode()) {
                emit_error("not_loaded", "load a model first", id);
                continue;
            }
            const std::string stream = msg.value("stream", "default");
            Stream *s = nullptr;
            {
                std::lock_guard<std::mutex> lock(streams_mutex);
                auto it = streams.find(stream);
                if (it == streams.end()) {
                    if (streams.size() >= kMaxStreams) {
                        emit_error("too_many_streams", "at most 4 streams", id);
                        continue;
                    }
                    auto created = std::make_unique<Stream>(stream, ctx, threads, language, fake_delay_ms);
                    if (!created->ok()) {
                        emit_error("state_failed", "could not create a whisper state", id);
                        continue;
                    }
                    it = streams.emplace(stream, std::move(created)).first;
                }
                s = it->second.get();
            }
            Job job;
            job.id = id.is_number_integer() ? id.get<int64_t>() : 0;
            job.audio_ms = (int)(samples.size() / 16);
            job.pcm.resize(samples.size());
            for (size_t i = 0; i < samples.size(); ++i) job.pcm[i] = samples[i] / 32768.0f;
            s->push(std::move(job));
        } else if (op == "cancel") {
            std::lock_guard<std::mutex> lock(streams_mutex);
            const int64_t target = id.is_number_integer() ? id.get<int64_t>() : -1;
            for (auto &kv : streams)
                if (kv.second->cancel(target)) break;
        } else if (op == "crash" && fake_mode()) {
            std::abort(); // test hook
        } else if (op == "shutdown") {
            break;
        } else {
            emit_error("unknown_op", "unknown op '" + op + "'", id);
        }
    }

    // Shutdown (also reached on stdin EOF): abort running work, join threads,
    // then release the model.
    {
        std::lock_guard<std::mutex> lock(streams_mutex);
        streams.clear();
    }
    if (ctx) whisper_free(ctx);
    emit({{"event", "bye"}});
    return exit_code;
}
