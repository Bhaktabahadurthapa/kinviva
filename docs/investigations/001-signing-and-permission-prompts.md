# Investigation 001: why macOS keeps asking for permissions after an update

Status: complete. Method: REA (read-only static inspection). No process was launched or attached to.

## Research question
Users and the maintainer see macOS ask again for Microphone, Screen & System Audio Recording and Keychain access after installing a new build of Kinviva. What in the shipped app causes this?

## Target and authorization
`dist-mac/Kinviva.app`, built from this repository on the maintainer's own Mac (version 0.1.6). It is the project's own software, so inspection is authorized. Nothing third-party was examined.

## Tools used
REA MCP server (`rea-agents`, pinned to 6.7.0 in the Claude Code configuration): `open_binary`, `inspect_plist`, `inspect_signature`, `inspect_artifact`, `close_binary`. Nothing was executed.

## Observations (evidence ids are REA's)
| # | Observation | Evidence |
|---|---|---|
| 1 | Bundle id `app.kinviva.desktop`, version 0.1.6, minimum macOS 13.0, arm64 executable `kinviva` (sha256 `e3a28b0c...d7e765`). | `ev_42ecc573...` |
| 2 | `Info.plist` has `NSMicrophoneUsageDescription` and `NSAudioCaptureUsageDescription` with plain-language reasons. | `ev_42ecc573...` |
| 3 | The executable is signed (`signed: true`) but with **no team identifier**, **no authorities**, **no entitlements** and **hardened runtime off**. | `ev_cab22010...` |
| 4 | The designated requirement is `cdhash H"3a0f8bf2..."`, that is, the identity is the hash of this exact build. | `ev_cab22010...` |
| 5 | The bundle has 35 entries (12 nodes), with no integrity contradictions. | `ev_9cb5025a...` |

## Verified facts
- The app is ad-hoc signed. Its code identity is only the hash of the build.

## Reasonable inferences (not verified by this investigation)
- macOS ties privacy grants (TCC) and Keychain "Always Allow" to the code identity. Because the identity is a build hash, every rebuild looks like a different app, so the prompts return after each update.
- A Developer ID signature (stable team identifier) would make the designated requirement stable across versions and remove most repeat prompts.

## Unknowns and limits
- Not tested: how macOS actually treats a second ad-hoc build on a clean machine.
- Entitlements were not readable in this pass (REA notes they need a separate bounded command).
- Static inspection only; no runtime behavior observed.

## Recommended independent implementation
1. Sign releases with a Developer ID certificate and notarize (needs a paid Apple Developer account; the maintainer's decision, see `docs/RELEASE_READINESS.md`).
2. Until then, keep telling users to expect prompts after updating and add the one-line explanation to the README.
3. Re-run this investigation on the signed build to confirm the designated requirement now names the team identifier.

## Reproduce
In Claude Code with the REA MCP server enabled: `open_binary` the `.app`, then `inspect_plist` (Contents/Info.plist), `inspect_signature`, `inspect_artifact`, then `close_binary`. See `docs/INVESTIGATIONS.md`.
