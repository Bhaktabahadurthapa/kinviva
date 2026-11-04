#!/usr/bin/env bash
# Builds meetinglens-whisperd (static whisper.cpp) and copies it to
# native/whisperd/dist/ with the target-triple name Tauri expects for sidecars.
#   ./native/whisperd/build.sh
# Needs: cmake, a C++17 compiler, git, network access (fetches whisper.cpp).
set -euo pipefail
cd "$(dirname "$0")"

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64)  TRIPLE=aarch64-apple-darwin ;;
  Darwin-x86_64) TRIPLE=x86_64-apple-darwin ;;
  *) echo "unsupported host: $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac

cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release >/dev/null
cmake --build build --target meetinglens-whisperd -j
mkdir -p dist
cp build/meetinglens-whisperd "dist/meetinglens-whisperd-$TRIPLE"
strip -x "dist/meetinglens-whisperd-$TRIPLE" 2>/dev/null || true
ls -lh "dist/meetinglens-whisperd-$TRIPLE"
"dist/meetinglens-whisperd-$TRIPLE" --version
