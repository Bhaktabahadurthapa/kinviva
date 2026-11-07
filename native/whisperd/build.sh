#!/usr/bin/env bash
# Builds kinviva-whisperd (static whisper.cpp) and copies it to
# native/whisperd/dist/ with the target-triple name Tauri expects for sidecars.
#   ./native/whisperd/build.sh
# Needs: cmake, a C++17 compiler, git, network access (fetches whisper.cpp).
set -euo pipefail
cd "$(dirname "$0")"

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64)  TRIPLE=aarch64-apple-darwin ;;
  Darwin-x86_64) TRIPLE=x86_64-apple-darwin ;;
  MINGW*-x86_64|MSYS*-x86_64) TRIPLE=x86_64-pc-windows-msvc ;;
  *) echo "unsupported host: $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac

mkdir -p dist
case "$TRIPLE" in
  *windows*)
    # Visual Studio generator (multi-config); the sidecar needs the .exe suffix.
    cmake -S . -B build -A x64 >/dev/null
    cmake --build build --config Release --target kinviva-whisperd
    OUT="dist/kinviva-whisperd-$TRIPLE.exe"
    cp build/Release/kinviva-whisperd.exe "$OUT"
    ;;
  *)
    cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release >/dev/null
    cmake --build build --target kinviva-whisperd -j
    OUT="dist/kinviva-whisperd-$TRIPLE"
    cp build/kinviva-whisperd "$OUT"
    strip -x "$OUT" 2>/dev/null || true
    ;;
esac
ls -lh "$OUT"
"$OUT" --version
