# Contributing to Kinviva

Thanks for your interest. Kinviva is proprietary software whose source is
public to read (see [LICENSE](LICENSE)). Contributions are welcome on these
terms:

- **Issues** — bug reports and feature ideas are always welcome. Please
  include your OS version, audio setup (speakers or headphones), speech and
  AI provider, and the exact steps. Never paste API keys or private meeting
  content.
- **Pull requests** — open an issue first for anything beyond a small fix.
  By submitting a pull request you confirm the work is your own and you grant
  the copyright owner a perpetual, worldwide, royalty-free license to use,
  modify and distribute it as part of Kinviva under any terms.

## Open-core note

Kinviva is moving to an open-core model (see [docs/OPEN_CORE_PLAN.md](docs/OPEN_CORE_PLAN.md)). The Community code may later be released
under an open-source license; paid editions would live in separate private repositories. Until the owner adopts a Developer
Certificate of Origin or a contributor agreement (see [docs/LICENSING_REVIEW.md](docs/LICENSING_REVIEW.md)), outside pull requests may
be reviewed but cannot be merged.

## Development

```bash
npm install && npm run tauri dev
```

Before opening a pull request, run:

```bash
npm test && npx tsc --noEmit && npm run check:versions && (cd src-tauri && cargo test --lib && cargo clippy --all-targets -- -D warnings)
```

## Guidelines

- Match the surrounding code style and the design tokens in
  [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md).
- Keep secrets in the OS credential store; never log keys or meeting content.
- Label demo data clearly and never present mocked results as real.
- Describe what you verified with real audio and what you could not.
- Never describe a planned Pro or Business feature as available. Planned features are labelled planned everywhere.
- Anything that sends data off the computer must say so in the UI and in [docs/PRIVACY.md](docs/PRIVACY.md).

Participation is covered by the [Code of conduct](CODE_OF_CONDUCT.md).
