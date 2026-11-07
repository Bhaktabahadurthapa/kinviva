# Licensing review

Date: 2026-11-07. This is an engineering review, not legal advice. A lawyer should confirm the points marked **Legal**.
No license, visibility or history has been changed by this review.

## 1. Where the repository stands today

- `LICENSE` is **"Kinviva Proprietary Software License, all rights reserved"** (copyright 2026 Bhakta Thapa).
- The repository on GitHub is **public**. Public source with an all-rights-reserved license means people can read it but have no right to use, copy or modify it beyond what the license grants.
- `CONTRIBUTING.md` asks contributors to grant the copyright owner a perpetual license to their work "under any terms". That is the right idea for open-core, but it should be a real written agreement (see 4).
- Consequence: the Community Edition is **not open source today**, and the website must not say it is. The website now says the Community Edition is free to download, that the source is public, and that open-source licensing is being decided.

## 2. Recommendation for the Community code

| Option | Good | Watch out |
|---|---|---|
| **Apache-2.0** (recommended) | Permissive, includes an explicit patent grant and a clear contributor clause. Common for infrastructure and AI tools. | Requires keeping notices. Others may build competing products from it. |
| MIT | Shortest, most familiar. | No patent grant. |
| AGPL-3.0 | Prevents closed hosted clones. | Scares off companies and contributors; complicates a private Pro module that links with the app. |
| Open core with a "source-available" license (for example BSL) | Protects against clones. | Not open source; weaker community goodwill. |

Recommended: **Apache-2.0 for the Community code**, and a separate proprietary license for the private Pro and Business modules. This is **not applied**. Applying it means replacing `LICENSE`, adding headers, and telling contributors. That needs the owner's decision and **Legal** review.

## 3. Ownership
- All commits so far are by the owner, written in this repository, with AI assistance (Claude Code). Ownership of AI-assisted output follows the owner's agreement with the AI provider and local law. **Legal**: confirm that nothing generated reproduces third-party code. The code was written for this project and not copied from other repositories.
- Contributions: none received from others yet. Before accepting any, adopt a DCO or a short CLA (see 4).

## 4. Contributor terms (needed before accepting outside code)
- Use the **Developer Certificate of Origin** (sign-off on each commit) for Community contributions, plus an explicit statement that the owner may distribute contributions under the Community license and may also use them in proprietary editions. A CLA is stronger for relicensing but adds friction. **Legal** to choose.

## 5. Third-party licenses (from the real dependency lists)

Rust (557 packages) and npm (552 packages) were scanned from `Cargo.lock` and `package-lock.json`.

| Family | Count | Obligation |
|---|---|---|
| MIT, Apache-2.0, "MIT or Apache-2.0", BSD, ISC, Zlib, Unlicense, Unicode-3.0, CDLA-Permissive-2.0 | the large majority | Keep notices (listed in `THIRD_PARTY_NOTICES.md`). |
| **MPL-2.0**: `cssparser`, `selectors`, `dtoa-short`, `option-ext` (Rust, through Tauri's web view stack); `dompurify` (MPL-2.0 or Apache-2.0, chosen: Apache-2.0) | few | File-level copyleft: if we ever modify those files, the modified files must be shared. We do not modify them. |
| **EPL-2.0 or GPL-3.0-or-later**: `elkjs` (through Mermaid) | 1 | Use under **EPL-2.0** (weak copyleft, file level) and do not modify it. Do not choose the GPL option. |
| **MIT or GPL-3.0 (JSZip, through pptxgenjs)** | 1 | Use under **MIT**. |
| **SIL OFL-1.1** fonts: Inter, Atkinson Hyperlegible, IBM Plex Mono | 3 | Fonts may be bundled; the fonts must not be sold on their own. Keep the license text. |
| Packages with no license field in metadata: `fuzzy`, `khroma` | 2 | Both are MIT in their source repositories; **verify** and record in the notices. |
| whisper.cpp (statically built into the speech helper) | 1 | MIT; notice included. |
| Excalidraw, Recharts, TipTap, ProseMirror, Mermaid, PptxGenJS | - | MIT; listed in the notices. |
| Whisper model files, answer-engine models | not bundled | The user downloads them under their own terms. Documented in the app. |

No GPL, AGPL or LGPL code is linked into the app in a way that forces the app's license. Re-run this scan before every release (the CI job should fail on a new copyleft family).

## 6. Items that need attention

1. **`docs/FINDINGS.md` and the reference investigation of NexQ (high attention, Legal).** The document records static analysis of a competitor's released application, including the sha256 of its installer, done with a reverse-engineering tool. The document says no source, assets or prompts were copied. Reverse engineering a proprietary app can breach its license terms even if no code is copied, and publishing the record is a risk for a product that will compete with it. Recommended: ask a lawyer; consider replacing the file with a short statement of the product's own design decisions and removing the competitor's installer hash and analysis details from the public repository. Not done here because it changes published history and content.
2. **Bundled interview skills** (`src-tauri/skills/*/SKILL.md`): confirm they were written for this project and are covered by the project license. They are the project's own text as far as the repository shows.
3. **Release assets.** Old releases were removed at the owner's request; Git history still holds earlier media and files.
4. **Trademark.** "Kinviva" has not been searched. Search trademark databases and domain names before investing in the brand. **Legal**.
5. **`REA` tool.** Used on the owner's machine as a developer tool, not bundled or redistributed. Its license (MIT) does not affect this product.
6. **Third-party content in the app.** Discover shows titles, summaries and small pictures from public feeds with the source and link; it does not republish full articles. Keep it that way.
7. **Video Assist** opens third-party sites (for example YouTube) in an embedded web view. Their terms apply to the user. Kinviva does not download, record or redistribute the video; it hears only the audio the computer plays.

## 7. Practical next steps (all need owner approval)
1. Decide Apache-2.0 for the Community code. 2. Pick DCO or CLA and add it to CONTRIBUTING. 3. Have a lawyer review sections 1, 3, 4 and item 1 of section 6.
4. Add license headers and a `NOTICE` file when the license changes. 5. Create the private `kinviva-pro` repository with a proprietary license.
6. Add a CI check for new dependency licenses.
