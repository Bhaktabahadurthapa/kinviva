#!/usr/bin/env bash
# Builds Kinviva.app and a drag-to-install Kinviva.dmg for macOS.
#
#   ./scripts/build-mac-app.sh
#
# Output: dist-mac/Kinviva.app, dist-mac/Kinviva_<version>_<arch>.dmg and
# dist-mac/Kinviva.dmg (same file; upload both to a release so the permanent
# link .../releases/latest/download/Kinviva.dmg always works).
# The app is ad-hoc signed (free, not notarized): fine for your own Mac;
# other Macs need the "Open anyway" steps in the README, or a paid Apple
# Developer ID signature + notarization for a warning-free download.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/opt/rustup/bin:$PATH"

[ "$(uname -s)" = "Darwin" ] || { echo "macOS only" >&2; exit 1; }
VERSION=$(node -p "require('./package.json').version")
ARCH=$(uname -m); [ "$ARCH" = "arm64" ] && ARCH=aarch64

# The bundled speech engine (C++, static whisper.cpp). Built once; rebuild with
# native/whisperd/build.sh after changing it.
TRIPLE=$([ "$(uname -m)" = "arm64" ] && echo aarch64-apple-darwin || echo x86_64-apple-darwin)
[ -x "native/whisperd/dist/kinviva-whisperd-$TRIPLE" ] || ./native/whisperd/build.sh

# The overlay adds the engine as a sidecar for this build only, so development
# runs and the Windows build (which has no engine yet) are unaffected.
npm run tauri build -- --bundles app --config src-tauri/tauri.sidecar.conf.json
APP="src-tauri/target/release/bundle/macos/Kinviva.app"

# The engine must be inside the app and runnable from there.
ENGINE="$APP/Contents/MacOS/kinviva-whisperd"
[ -x "$ENGINE" ] || { echo "speech engine missing from the app bundle" >&2; exit 1; }
"$ENGINE" --version

# Seal the whole bundle with a stable identifier. Without this the bundle
# is only partly signed and macOS may forget microphone permissions.
# Optional, for a warning-free download (needs a paid Apple Developer account):
#   KINVIVA_SIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)"
#   KINVIVA_NOTARY_PROFILE=<name from: xcrun notarytool store-credentials>
# Without them the app is ad-hoc signed (free; other Macs need "Open Anyway").
# The Developer ID path has not been run: it needs credentials this repo does not have.
if [ -n "${KINVIVA_SIGN_IDENTITY:-}" ]; then
  codesign --force --options runtime --timestamp --sign "$KINVIVA_SIGN_IDENTITY" "$ENGINE"
  codesign --force --options runtime --timestamp --deep --sign "$KINVIVA_SIGN_IDENTITY" \
    --entitlements src-tauri/entitlements.plist --identifier app.kinviva.desktop "$APP"
elif LOCAL_ID=$(security find-identity -p codesigning 2>/dev/null | awk '/"Kinviva Dev"/ {print $2; exit}') && [ -n "$LOCAL_ID" ]; then
  # A local self-signed certificate ("Kinviva Dev" in Keychain Access) gives
  # every build the same designated requirement, so macOS keeps the Screen
  # Recording, Microphone and Keychain permissions across rebuilds.
  # (Ad-hoc signing changes the identity on every build and resets them.)
  codesign --force --deep --sign "$LOCAL_ID" --identifier app.kinviva.desktop "$APP"
else
  codesign --force --deep --sign - --identifier app.kinviva.desktop "$APP"
fi
codesign --verify --deep --strict "$APP"

OUT="dist-mac"
rm -rf "$OUT" && mkdir -p "$OUT"
cp -R "$APP" "$OUT/"

# Tauri's own DMG script fails on recent macOS, so build a plain one.
STAGE="$(mktemp -d)"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
DMG="$OUT/Kinviva_${VERSION}_${ARCH}.dmg"
hdiutil create -volname "Kinviva" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null 2>&1
rm -rf "$STAGE"
hdiutil verify "$DMG" >/dev/null 2>&1
if [ -n "${KINVIVA_SIGN_IDENTITY:-}" ] && [ -n "${KINVIVA_NOTARY_PROFILE:-}" ]; then
  codesign --force --timestamp --sign "$KINVIVA_SIGN_IDENTITY" "$DMG"
  xcrun notarytool submit "$DMG" --keychain-profile "$KINVIVA_NOTARY_PROFILE" --wait
  xcrun stapler staple "$DMG"
fi
cp "$DMG" "$OUT/Kinviva.dmg"

echo "Built:"
ls -lh "$OUT"
shasum -a 256 "$DMG"
