# Privacy and consent

Plain statement of what Kinviva does with your data. Written from the code as of version 0.1.5. If the code changes, this file changes with it.

## The app (Community Edition)

**Kinviva has no accounts, no analytics, no telemetry and no crash reporting, and it does not contact any Kinviva server.** (The source contains no such code.)

### Stays on your computer
- Sessions, transcripts, notes, boards, charts, documents and settings: a local database in `~/Library/Application Support/app.kinviva.desktop/` (Windows: the equivalent app data folder).
- API keys: the operating system's credential store (macOS Keychain, Windows Credential Manager). They are never written to the database, settings or logs.
- Audio: kept only if you turn on "save audio". Transcription by the built-in engine happens on your computer.

### Leaves your computer only when you set it up that way
| What | Goes to | When |
|---|---|---|
| Text of what was said, your notes, and the few document passages that match | The answer engine **you** chose (a local one on your machine, or a cloud provider with your key) | Whenever an answer is requested. If Automatic help is on, that is after each thing the other side says. Turn Automatic help off in the Meetings screen to send nothing until you press a button. |
| A screenshot of your main display | The same answer engine | When you press "Read my screen", or automatically if you turn on automatic screen help |
| Audio | Deepgram, only if you pick it as the speech provider and add your key | While a session is running |
| A search query | The web search provider you add a key for | Only for answers you request, only if you enabled web search |
| Requests for public RSS feeds and GitHub search, and pictures for items | Public sources (for example the Kubernetes blog, GitHub) | Only if you turn on Discover, then about once an hour while the app is open. Your interests are used to match items on your computer; they are not sent as a profile. |
| The page of the video you open | The site you chose (for example YouTube) inside an embedded web view; for YouTube the app also asks YouTube's public oEmbed address for the title and channel | When you press Play in Video Assist. That site's own terms and cookies apply. |

Kinviva does not download, record or redistribute videos. It hears only the audio your computer plays, like any other sound.

### What the answer engine sees
Whatever the provider you chose receives is governed by that provider's terms. For full privacy choose a local model. The app states in Settings which endpoint is in use.

### Your controls
Delete any session (Trash, then delete permanently, optionally with linked notes); delete notes; turn Discover, web search, automatic help and audio saving off; remove keys in Settings; export your data (Word, Markdown, text, CSV, PowerPoint); remove everything by deleting the app data folder.

### The overlay
The overlay can be hidden from screen sharing using the operating system's "exclude from capture" flag. It does not stop a person from photographing a screen or from capture methods that ignore the flag.

## The website
`bhaktathapa.com.np/kinviva/` is a static site on GitHub Pages with no cookies of its own and no analytics. GitHub, as host, processes requests under its own policy.

## Early Access form (planned service, not yet deployed)

Purpose: to learn who wants advanced features and to contact selected participants as access becomes available.

- **Collected**: name, email address, use case (a short list or free choice), optional company, the time and the version of the consent text you agreed to. A hashed form of your network address is used for a short time to limit abuse and is not stored with your signup.
- **Consent**: a required checkbox, unticked by default: "I agree that Kinviva stores my name, email and answers so it can contact me about Early Access. I can ask for deletion at any time." Version id `ea-2026-11-v1`.
- **Use**: contacting selected participants about Early Access, and planning. No selling, no advertising lists, no sharing except with the hosting provider that runs the service.
- **Retention**: until you ask for deletion, or 12 months after the program ends, whichever is first (the owner may set a shorter period).
- **Deletion and access**: email the address given on the Early Access page. Records are deleted on request.
- **Security**: server-side validation, rate limiting, duplicate handling, HTTPS only, minimal fields, no logging of personal data.
- **Children**: the form is not meant for people under 16.

Pro and Business are **planned**. Joining the list does not buy or reserve anything.
