#!/usr/bin/env bash
# Cargo "runner" for development on macOS (see .cargo/config.toml).
#
# Signs the freshly built dev binary with the local "MeetingLens Dev"
# certificate before running it. macOS ties Keychain approval ("Always
# Allow") to the program's signature; without a stable one every rebuild looks
# like a new program and asks for your login password again.
#
# Create the certificate once (self-signed, free): see docs/TESTING.md.
# Without it, this just runs the binary unsigned, exactly as before.
bin="$1"
if [ "$(uname -s)" = "Darwin" ] && [ "$(basename "$bin")" = "meetinglens" ]; then
  id=$(security find-identity -p codesigning 2>/dev/null | awk '/"MeetingLens Dev"/ {print $2; exit}')
  [ -n "$id" ] && codesign --force --sign "$id" --identifier app.meetinglens.desktop "$bin" >/dev/null 2>&1
fi
exec "$@"
