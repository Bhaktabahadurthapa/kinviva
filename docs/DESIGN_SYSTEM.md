# MeetingLens design system — "Broadcast console"

A meeting assistant listens, so the interface borrows from a broadcast desk:
an ON AIR lamp, a timecode, per-channel strips with segmented level meters,
and a transcript drawn as timecoded tape. The AI's plain-English explanation
speaks in a serif "editorial" voice so it reads differently from what people
said. Warm ink surfaces and paper-coloured text keep long sessions calm. One
accent, signal vermilion, is reserved for live state and primary actions.

All tokens are CSS custom properties in `src/styles.css`. Light mode
("paper room") follows the OS appearance.

## Color

| Token | Dark (ink room) | Light (paper room) | Use |
|---|---|---|---|
| `--c-bg` / `--c-bg-2` | `#110f0d` / `#15120f` | `#f3ede2` / `#ede6d9` | App background, rail |
| `--c-surface` / `--c-raised` / `--c-sunken` | `#1b1814` / `#24201b` / `#0c0a08` | `#faf6ee` / `#fffdf8` / `#e7dfd1` | Panels / buttons / inputs, meters |
| `--c-line` / `--c-line-strong` | `#2e2923` / `#463e34` | `#ddd3c3` / `#c4b8a5` | Borders, tape dividers |
| `--c-text` / `-2` / `-3` | `#f2eadb` / `#bcb09d` / `#7d7467` | `#1d1915` / `#5a5045` / `#8b8073` | Primary / secondary / labels |
| `--c-signal` | `#ff5f2e` | `#d9461a` | Live lamp, primary button, focus, caret |
| `--c-them` / `--c-me` | paper / `#9cc8a0` | ink / `#3f7a48` | Speaker identity on the tape |
| `--c-ok` / `--c-warn` / `--c-bad` | `#9cd38a` / `#f2b84b` / `#ff6f61` | darker equivalents | Meters, cloud routing, errors |

Contrast: body text on surface is ≥ 12:1 in dark and ≥ 13:1 in light.
`--c-text-3` labels are ≥ 4.5:1 on `--c-bg`.

## Typography

| Role | Family | Notes |
|---|---|---|
| Display / AI voice | Fraunces Variable | Headings, meeting titles, the Simple meaning answer (`opsz` axis tuned per size) |
| Interface | Instrument Sans Variable | Controls, transcript text, forms |
| Data / labels | IBM Plex Mono | Timecodes, channel names, section labels, routing chips |

Scale (minor third from 14 px): 10.5 · 11.5 · 12.5 · **14** · 16.5 · 20 ·
24 · 29 · 35. Labels use uppercase mono with 0.14 em tracking. All fonts are
bundled locally (SIL OFL 1.1) so the app works offline under its strict
content-security policy.

## Space, radius, elevation

- Spacing: 4 px base on an 8-pt rhythm (`--s-1` 4 … `--s-7` 48).
- Radius: `--r-xs` 3 (tags), `--r-sm` 6 (controls), `--r-md` 10, `--r-lg` 16 (panels).
- Elevation: `--e-0` hairline highlight, `--e-1` controls, `--e-2` panels,
  `--e-signal` glow for primary hover. A fixed film-grain layer adds depth.

## Motion

`--m-fast` 120 ms (hover/press), `--m-base` 220 ms (new transcript lines,
banners), `--m-slow` 480 ms (panel entrance, staggered 70 ms). Easing
`--ease-out` is `cubic-bezier(.2,.7,.2,1)`. The live lamp and streaming
caret pulse. Everything is disabled under `prefers-reduced-motion`.

## Components

| Component | Anatomy |
|---|---|
| Console bar | Lamp (Standby / ON AIR) · timecode · title · channel strips · routing chips · Start/Stop |
| Channel strip | Mono channel name · state · 12-segment meter (8 green, 3 amber, 1 signal) |
| Routing chip | `audio →` and `ai text →` destination; green when local, amber when cloud |
| Tape line | Speaker tag (THEM boxed paper, ME outlined sage) · mono timecode · text; partial lines italic with a signal caret |
| AI panel | Mono label with status dot (pulses while streaming) · body (serif voice for meaning) · source footer |
| Reply card | Ruled draft paper, editable, Copy |
| Command dock | "?" ask field · Explain · Suggest reply (primary) · Recap |
| Overlay | Compact console header with Assist/Transcript segmented control |

## Tokens added in the November design pass

| Token | Value | Use |
|---|---|---|
| `--ds-r-sm / md / lg` | 10 / 14 / 20 px | Controls, tiles, cards |
| `--ds-e1` | soft two-layer shadow | Resting cards |
| `--ds-e2` | larger soft shadow | Hover and raised cards |
| `--ds-ease`, `--ds-t` | `cubic-bezier(.2,.7,.2,1)`, 180 ms | All hover and press motion |

Colour: sidebar `#0B1735`, workspace `#FFFFFF`, headings `#101B3C`, body `#475569`, accents `#2563EB` and `#6D28D9`. Type: Inter (lining numerals, no slashed zero). Home grid: hero, five mode cards, activity line, quick-create row, then Recent sessions beside Continue learning, with the Assistant column on the right. Menus close on an outside click or Escape.

## Semantic colour tokens

Defined once at the end of `src/styles.css` as `--mt-*` and mapped onto the older `--c-*` variables in the light theme (dark themes keep their own values).

| Token | Value | Use |
|---|---|---|
| `--mt-sidebar` | `#0B1735` | Side menu and logo cell |
| `--mt-workspace` | `#F8FAFC` | Page background |
| `--mt-surface` | `#FFFFFF` | Cards and panels |
| `--mt-text` / `--mt-text-2` | `#0F172A` / `#475569` | Primary and secondary text |
| `--mt-border` | `#E2E8F0` | Borders and dividers |
| `--mt-primary` | `#2563EB` | Primary buttons and links |
| `--mt-accent` | `#7C3AED` | Purple accent, active menu marker |
| `--mt-success` / `--mt-warning` / `--mt-error` | `#15803D` / `#B45309` / `#B91C1C` | Status |
