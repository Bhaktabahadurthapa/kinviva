#!/usr/bin/env bash
# Compares the main tables of two Kinviva/MeetingLens databases, for example after the first-launch data copy.
# Usage: scripts/verify-migration.sh <old data folder> <new data folder>
set -euo pipefail
old="${1:?old data folder}"; new="${2:?new data folder}"
olddb="$old/meetinglens.sqlite"; newdb="$new/kinviva.sqlite"
[ -f "$olddb" ] || { echo "missing $olddb"; exit 2; }
[ -f "$newdb" ] || { echo "missing $newdb"; exit 2; }
status=0
for t in meetings segments ai_messages records documents settings; do
  a=$(sqlite3 -readonly "$olddb" "select count(*) from $t" 2>/dev/null || echo "n/a")
  b=$(sqlite3 -readonly "$newdb" "select count(*) from $t" 2>/dev/null || echo "n/a")
  if [ "$a" = "$b" ]; then echo "ok   $t: $a"; else echo "DIFF $t: old=$a new=$b"; status=1; fi
done
exit $status
