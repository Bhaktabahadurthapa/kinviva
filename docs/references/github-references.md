# GitHub references (verified 2026-11-04 with the GitHub API)

| Project | License | What it is | How MeetingLens uses it |
|---|---|---|---|
| [pbakaus/impeccable](https://github.com/pbakaus/impeccable) | Apache-2.0 | Design vocabulary for coding agents plus a `detect` CLI that finds generated-UI patterns | `npx impeccable detect src/` run as a critique tool; findings in `design-analysis.md`. Agent commands (`/impeccable critique` etc.) need `npx impeccable install` and a reload of the coding tool; not available inside this session. |
| [shadcn-ui/ui](https://github.com/shadcn-ui/ui) | MIT | Copy-in React component patterns and design tokens | Pattern reference only (token naming, focus rings, density). No code copied. |
| [radix-ui/primitives](https://github.com/radix-ui/primitives) | MIT | Accessible unstyled React primitives | Reference for dialog/menu/tabs keyboard behaviour. Not added as a dependency. |
| [Bhaktabahadurthapa/rea](https://github.com/Bhaktabahadurthapa/rea) | MIT | Reverse-engineering toolkit for binaries, apps and runtimes | Not a UI-pattern tool. Used only to inspect MeetingLens' own app bundle (signature, Mach-O). UI references were studied manually. |

Rules followed: licenses checked before any reuse; no third-party branding or code imported; original components only.
