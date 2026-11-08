# Competitor research for the website comparison

Checked: 2026-11-08, from each vendor's own website and help centre. This file records only what those pages say. "Not verified" means we did not find the point on a page we read; it is **not** a claim that the product lacks it. Vendors change their products and plans, so re-check before reusing any line. We make no claim that Kinviva is faster, more accurate or more secure than any of these tools, and have no test results that would support one.

## What each vendor's own pages say

| Capability | Otter.ai | Fireflies.ai | Granola | Fathom |
|---|---|---|---|---|
| Live transcription | "Live transcription in multiple languages, and speaker recognition" ([otter.ai](https://otter.ai/)) | "Live transcripts" update as people speak in Live Assist ([guide](https://guide.fireflies.ai/articles/6032274417-learn-about-fireflies-live-assist-get-real-time-suggestions-answers-and-notes-live-during-the-meeting)) | Transcribed "in real time on Mac and Windows" ([Granola blog](https://www.granola.ai/blog/local-first-ai-notetaker-vs-cloud)) | Not verified (pages read describe post-call summaries; "Unlimited recordings + transcriptions") ([pricing](https://fathom.ai/pricing)) |
| Real-time help during the meeting | AI Chat lets participants "ask questions and collaborate in real-time with the transcription" ([Otter help](https://help.otter.ai/hc/en-us/articles/17016733191703-Otter-AI-Chat-FAQs)) | Live Assist: real-time suggestions, Catch Up, Action Items, Ask Fred answers; Dynamic Topic Suggestions are paid-only (guide above) | Not verified (notes and actions "ready the moment the meeting ends") ([granola.ai](https://www.granola.ai/)) | Not verified |
| Notes and summaries | Yes ("clear summary with decisions, action items, and insights") | Yes (live AI notes, summaries) | Yes | Yes ("Instant AI call summaries") |
| Action items | "automatically captured and assigned" | Action Items listed in real time | "Notes, action items, and follow-ups" after the meeting | "AI Action Items" are listed under Premium; Free gets advanced summaries for the first 5 calls each month ([Fathom help](https://help.fathom.video/en/articles/5290881), also "AI generated action items post-call" on the [pricing page](https://fathom.ai/pricing)) |
| Works without a meeting bot | Yes: desktop app "without bots joining the call" | Yes: desktop app and Chrome extension "work without the bot" (guide above), but Live Assist needs the Notetaker to join for meetings it covers | Yes: "Uses your computer audio, so doesn't invite a bot" | Choice of bot-free "(in beta)" or bot capture ([pricing](https://fathom.ai/pricing)) |
| Where processing and storage happen | "secure cloud storage"; prompts and transcript go to third-party AI providers only when a question is asked (Otter help above) | Not verified | Capture on device; "Transcription and AI summaries use secure cloud processing"; notes stored in a US-hosted AWS environment (Granola blog above) | "All Fathom data is stored in the United States" ([Fathom help](https://help.fathom.video/en/articles/296512)) |
| Starts automatically | Not verified | Connects to the calendar or conferencing tool; the Notetaker joins (guide above) | Manual: "You start Granola yourself for each meeting" (Granola blog) | Not verified |

## What Kinviva does (from this repository, version 0.1.5)

Sources: `docs/FEATURE_AUDIT.md`, `docs/PRIVACY.md`, `README.md`.

- Live transcript, explanations, question detection, suggested replies, recap, saved history: implemented.
- Speech recognition on the device (whisper.cpp), or Deepgram with the user's own key; answer engine can be a local model or any OpenAI-compatible service with the user's own key. Nothing is sent to a Kinviva server (there is none).
- Technical Copilot (explain, read-only troubleshooting plans, incident tracker, architecture diagrams): implemented, partly tested.
- Action items with verified quotes: implemented. Agent-driven, human-approved workflows: **planned** (Pro), not built.
- Does not detect or join meetings automatically; the user presses Start.

## Not claimed anywhere on the site
Speed, accuracy, security superiority, or that any competitor lacks a feature we did not verify.
