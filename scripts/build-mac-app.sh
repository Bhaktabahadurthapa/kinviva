#!/usr/bin/env bash
# Builds MeetingLens.app and a drag-to-install MeetingLens.dmg for macOS.
#
#   ./scripts/build-mac-app.sh
#
# Output: dist-mac/MeetingLens.app and dist-mac/MeetingLens_<version>.dmg
# The app is ad-hoc signed (free, not notarized): fine for your own Mac;
# other Macs need the "Open anyway" steps in the README, or a paid Apple
# Developer ID signature + notarization for a warning-free download.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/opt/rustup/bin:$PATH"

[ "$(uname -s)" = "Darwin" ] || { echo "macOS only" >&2; exit 1; }
VERSION=$(node -p "require('./package.json').version")
ARCH=$(uname -m); [ "$ARCH" = "arm64" ] && ARCH=aarch64

npm run tauri build -- --bundles app
APP="src-tauri/target/release/bundle/macos/MeetingLens.app"

# Seal the whole bundle with a stable identifier. Without this the bundle
# is only partly signed and macOS may forget microphone permissions.
codesign --force --deep --sign - --identifier app.meetinglens.desktop "$APP"
codesign --verify --deep --strict "$APP"

OUT="dist-mac"
rm -rf "$OUT" && mkdir -p "$OUT"
cp -R "$APP" "$OUT/"

# Tauri's own DMG script fails on recent macOS, so build a plain one.
STAGE="$(mktemp -d)"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
DMG="$OUT/MeetingLens_${VERSION}_${ARCH}.dmg"
hdiutil create -volname "MeetingLens" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null 2>&1
rm -rf "$STAGE"
hdiutil verify "$DMG" >/dev/null 2>&1

echo "Built:"
ls -lh "$OUT"
shasum -a 256 "$DMG"
