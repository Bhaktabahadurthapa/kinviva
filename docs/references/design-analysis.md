# Design analysis

| Source | Pattern observed | Why | Kinviva implementation | Compatibility / accessibility / license |
|---|---|---|---|---|
| Impeccable detector (Apache-2.0) | Flags thick one-sided colored card borders and decorative grid backgrounds as generated-UI tells | Objective critique before polish | Removed all four `border-left` accents and the full-window grid overlay from `styles.css` | Regex scan only on source (undercount); run again against the dev server for contrast and tiny-text rules |
| Linear / Raycast style (observation, no code) | Dense, quiet lists; one accent; text hierarchy by weight and colour | Reading answers during a call needs calm UI | Single blue accent token; 14px body; 6/8/10px radii; no decorative badges or glow | Contrast tokens chosen to keep body text above 4.5:1 |
| shadcn/ui (MIT) | Semantic tokens (`bg`, `surface`, `line`, `text-2/3`, accent) in both themes | Easy theming | Existing `--c-*` tokens re-valued: light default, dark via `prefers-color-scheme`; navy sidebar in both | Pattern only, no code copied |
| Radix primitives (MIT) | Tabs/menus need roving focus and visible focus rings | Keyboard use | Global `:focus-visible` ring kept; nav items are real buttons | Radix not adopted; tabs in Settings/Interview still to audit |
| Native macOS sidebars | Fixed dark sidebar, one active row | Predictable navigation | Five destinations: Meeting, Interview, Sessions, Knowledge, Settings | Sidebar colour is theme independent |
