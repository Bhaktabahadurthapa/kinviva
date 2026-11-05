#!/usr/bin/env python3
"""Generates the multi-page website in site/ (features, interview, video, privacy, download).
index.html is hand-written. Run: python3 scripts/gen-site.py"""
import html, pathlib

SITE = pathlib.Path(__file__).resolve().parent.parent / "site"
VERSION = "0.1.5"
REL = "https://github.com/Bhaktabahadurthapa/meetinglens/releases"
GH = "https://github.com/Bhaktabahadurthapa/meetinglens"

NAV = [("features.html", "Features"), ("interview.html", "Interview"), ("video.html", "Video"), ("privacy.html", "Privacy"), (GH, "GitHub")]

def head(title, desc, page):
    return f'''<!doctype html>
<html lang="en" class="no-js">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html.escape(title)} · MeetingLens</title>
  <meta name="description" content="{html.escape(desc)}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="{html.escape(title)} · MeetingLens">
  <meta property="og:description" content="{html.escape(desc)}">
  <meta property="og:image" content="https://bhaktathapa.com.np/meetinglens/media/app-live.jpg">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="theme-color" content="#0b1530">
  <link rel="icon" href="logo.svg" type="image/svg+xml">
  <link rel="stylesheet" href="style.css">
  <script>document.documentElement.className = "js";</script>
</head>
<body>
  <a class="skip" href="#main">Skip to content</a>
  <header class="nav">
    <div class="wrap">
      <a class="brand" href="index.html" aria-label="MeetingLens home"><img src="logo.svg" width="32" height="32" alt=""><span>Meeting<em>Lens</em></span></a>
      <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav" aria-label="Menu"><span></span><span></span><span></span></button>
      <nav id="site-nav" aria-label="Primary">
''' + "\n".join(
        f'        <a href="{href}"{" aria-current=\"page\"" if href == page else ""}>{label}</a>' for href, label in NAV
    ) + f'''
        <a class="btn btn-small" href="download.html"{" aria-current=\"page\"" if page == "download.html" else ""}>Download</a>
      </nav>
    </div>
  </header>
  <main id="main">
'''

FOOT = f'''  </main>
  <footer>
    <div class="wrap foot-grid">
      <div>
        <p class="foot-brand"><img src="logo.svg" width="28" height="28" alt=""> <b>MeetingLens</b></p>
        <p>Hear it. Understand it. Answer it.</p>
        <p>© 2026 Bhakta Thapa. All rights reserved. Built by <b>BKT AI</b></p>
      </div>
      <div>
        <p><b>Explore</b></p>
        <p><a href="features.html">Features</a> · <a href="interview.html">Interview</a> · <a href="video.html">Video</a> · <a href="privacy.html">Privacy</a> · <a href="download.html">Download</a></p>
      </div>
      <div>
        <p><b>Project</b></p>
        <p><a href="{GH}">Source on GitHub</a> · <a href="{GH}/blob/main/LICENSE">License</a> · <a href="{GH}/blob/main/THIRD_PARTY_NOTICES.md">Third-party notices</a> · <a href="{GH}/blob/main/SECURITY.md">Security</a> · <a href="{REL}">Releases</a></p>
      </div>
    </div>
  </footer>
  <script src="site.js"></script>
</body>
</html>
'''

def page_hero(eyebrow, title, lead):
    return f'''    <section class="page-hero">
      <div class="wrap">
        <p class="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p class="lead">{lead}</p>
      </div>
    </section>
'''

def ticks(items):
    return '<ul class="ticks">' + "".join(f"<li>{i}</li>" for i in items) + "</ul>"

# ---------------------------------------------------------------- Features
FEATURES = [
 ("simple", "Simple words, automatically", "meeting", "audio",
  "When someone finishes a thought, its meaning appears in short, plain sentences a 10-year-old could follow, so you understand it while the call is still going.",
  ["Writes what each person said in simple words, hands-free", "Explains hard terms in a few simple words", "Keeps the newest note on top without jumping while you read", "Works for the other side's audio; your own microphone is captured separately"], "app-live.jpg", "The Meeting screen: transcript on the left, simple-word notes on the right."),
 ("answers", "Answers you can say", "meeting", "chat",
  "Questions get a spoken-style answer: a direct first sentence, the reasoning, a key takeaway and the sources used. It never invents your own experience.",
  ["60 to 100 words by default, longer for design questions", "Key takeaway in one sentence", "Sources listed, checked by the app", "If it needs facts only you know, it asks you instead of guessing"], "app-live.jpg", "A written answer with key takeaway and hard words."),
 ("hardwords", "Hard words, made simple", "meeting", "search",
  "Every answer rereads itself, finds the difficult words and adds a short plain meaning for each, so you can say them with confidence.",
  ["Technical terms, acronyms, tools and business words", "Common words like API or latency are included too", "Up to six per answer, hardest first", "Same in Meeting and Interview"], "app-live.jpg", "The Hard words list under an answer."),
 ("interview", "Interview mode", "interview", "person",
  "A screen of its own. Press Start interview and each question the interviewer asks is answered automatically, with the reasoning behind it.",
  ["Say it, Understand it, Trade-offs, Hard words and the likely follow-up", "Answer styles: Simple, Professional, Technical, STAR", "Mock practice and feedback on your own answers", "Download practice notes to study later"], "app-interview.jpg", "The Interview screen with a spoken answer and its reasoning."),
 ("screen", "Read my screen", "interview", "monitor",
  "When someone shows a coding problem, a terminal command or an error and asks you to explain it, MeetingLens reads your screen and explains it.",
  ["Button, or the Cmd+Shift+S shortcut from any app", "Optional automatic mode when they say 'look at this'", "Explains what it is, what it means and what you could say", "The screenshot goes to your AI provider only when you ask, and is deleted right after"], "app-screen.jpg", "A terminal command explained in simple words."),
 ("overlay", "Clear floating overlay", "meeting", "layers",
  "A small always-on-top window beside your call. Turn it fully see-through and only the words show over whatever is behind.",
  ["Opens by itself when you minimize the app", "Transparency slider from fully clear to solid", "Read my screen and Ask work inside it", "Can ask your system to keep it out of screen sharing (not guaranteed)"], "app-overlay.jpg", "The overlay over a shared coding page."),
 ("knowledge", "Your documents and courses", "documents", "file",
  "Add PDF, Word, text or Markdown files. Class sessions use one course and one week, and answers cite the file and page.",
  ["Courses with weekly resources, kept separate from your general library", "Citations are checked by the app, so a made-up page cannot appear", "Optional web search for fresh facts", "Everything is searched on your computer"], "app-knowledge.jpg", "Knowledge: courses, weeks and resources."),
 ("notes", "Notes you can download", "documents", "download",
  "Every meeting and practice session is saved on your computer. Download it as Word, Markdown or plain text.",
  ["Scripts you can say", "Key points and answers to your questions", "Recap and references", "Your notes and the full transcript"], None, None),
 ("themes", "Light, dark and readable", "privacy", "sun",
  "Match your Mac or pick a theme, text size and font. Colors are checked for contrast in both themes.",
  ["Light and dark themes", "Small, normal and large text", "System font or an easy-to-read font", "Pause, transcript search and resizable panels"], "app-settings.jpg", "Settings → Appearance."),
 ("private", "Private by default", "privacy", "lock",
  "Use local speech and local AI and nothing leaves your computer. If you choose a cloud service, the app says exactly what is sent.",
  ["No account and no telemetry", "API keys stay in your system keychain", "Recordings are off unless you turn them on", "Nothing is ever typed or said into your call"], "app-live-dark.jpg", "Dark theme with capture indicators."),
]
ICONS = {
 "audio": '<path d="M4 12h2M8 8v8M12 5v14M16 8v8M20 12h-2"/>',
 "chat": '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M9 11h6M9 14h4"/>',
 "search": '<path d="M4 5h16M4 12h10M4 19h7"/><circle cx="18" cy="17" r="3"/><path d="M20.2 19.2L22 21"/>',
 "person": '<circle cx="12" cy="8" r="3.4"/><path d="M5 20c.6-3.6 3.4-5.4 7-5.4s6.4 1.8 7 5.4"/>',
 "monitor": '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4M9 9l-2 2 2 2M15 9l2 2-2 2"/>',
 "layers": '<rect x="3" y="5" width="18" height="14" rx="2" stroke-dasharray="3 3"/><path d="M13 9h5M13 12h5M13 15h3"/>',
 "file": '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
 "download": '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
 "sun": '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>',
 "lock": '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
}
def svg(name):
    return f'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{ICONS[name]}</svg>'

def features_page():
    chips = [("all", "All"), ("meeting", "Meeting"), ("interview", "Interview"), ("documents", "Documents"), ("privacy", "Look and privacy")]
    out = head("Features", "Every MeetingLens feature: simple words, answers you can say, interview mode, read my screen, clear overlay, documents, notes and privacy.", "features.html")
    out += page_hero("Features", "Everything MeetingLens does.", "Pick a feature to see how it works. Filter by what you are doing: a meeting, an interview, your documents, or how it looks and protects your data.")
    out += '''    <section class="explorer">
      <div class="wrap">
        <div class="chips" role="group" aria-label="Filter features">
''' + "".join(f'          <button type="button" class="chip{" is-on" if k=="all" else ""}" data-filter="{k}" aria-pressed="{"true" if k=="all" else "false"}">{v}</button>\n' for k, v in chips) + '''        </div>
        <div class="tabs-layout" data-tabs>
          <div class="tablist" role="tablist" aria-label="Features" aria-orientation="vertical">
'''
    for i, (fid, name, cat, icon, *_rest) in enumerate(FEATURES):
        out += f'            <button type="button" role="tab" id="tab-{fid}" aria-controls="panel-{fid}" aria-selected="{"true" if i==0 else "false"}" tabindex="{0 if i==0 else -1}" data-cat="{cat}"><span class="icon">{svg(icon)}</span><span>{html.escape(name)}</span></button>\n'
    out += '          </div>\n          <div class="panels">\n'
    for i, (fid, name, cat, icon, text, bullets, img, cap) in enumerate(FEATURES):
        out += f'            <article class="panel" role="tabpanel" id="panel-{fid}" aria-labelledby="tab-{fid}" data-cat="{cat}"{"" if i==0 else " hidden"}>\n'
        out += f'              <h2>{html.escape(name)}</h2>\n              <p class="lead">{html.escape(text)}</p>\n              {ticks([html.escape(b) for b in bullets])}\n'
        if img:
            out += f'              <figure class="shot"><img src="media/{img}" loading="lazy" width="1800" height="1125" alt="{html.escape(cap)}"><figcaption>{html.escape(cap)}</figcaption></figure>\n'
        else:
            out += '''              <div class="doc-card" aria-label="Contents of a downloaded notes file">
                <p class="doc-title">Notes file contents</p>
                <ol><li>Scripts you can say</li><li>Key points</li><li>Answers to your questions</li><li>Recap</li><li>References</li><li>Your notes</li><li>Full transcript</li></ol>
                <p class="fine">Formats: Word (.docx), Markdown (.md), plain text (.txt)</p>
              </div>
'''
        out += '            </article>\n'
    out += '''          </div>
        </div>
        <p class="no-match" id="no-match" hidden>No feature matches this filter.</p>
      </div>
    </section>
    <section class="cta-band">
      <div class="wrap">
        <h2>Try it on your own call.</h2>
        <p class="lead">Free for Mac and Windows. No account.</p>
        <a class="btn btn-big" href="download.html">Download MeetingLens</a>
      </div>
    </section>
'''
    return out + FOOT

# ---------------------------------------------------------------- Interview
STYLES = [
 ("simple", "Simple", "Short, clear, everyday words.",
  "I would give each team its own walled-off space with its own build workers and secrets. Then I would set limits and show each team its bill. It takes more setup, but it is safer and cheaper to run."),
 ("professional", "Professional", "Natural and confident.",
  "I would isolate each team in its own namespace and cloud account, with separate runners and secrets, so one team cannot affect another. I would add per-team quotas and cost reports to keep spending under control. The trade-off is more setup per team, which I accept for the security it buys."),
 ("technical", "Technical", "More engineering depth, still plain words.",
  "One namespace and one cloud account or subscription per team, with its own roles and short-lived credentials. Build runners are ephemeral and auto-scale, builds are signed, and a policy check gates every deploy. Quotas and a monthly cost report per team cap spend. I would verify isolation with a test that one team's runner cannot read another team's secrets."),
 ("star", "STAR", "For behavioral questions. Uses only your own notes.",
  "Situation: [from your notes] Task: [from your notes] Action: [from your notes] Result: [from your notes]. If your notes do not hold the facts, MeetingLens does not invent any. It tells you what to fill in from your real experience."),
]
SKILLS = [("Cloud and DevOps", "Rollouts, CI/CD, Kubernetes, observability, incidents, security and cost."), ("System design", "Requirements, scale, data, trade-offs and failure modes."), ("AI engineering", "RAG, evaluation, hallucinations, latency, cost and safety."), ("Coding", "Approach, complexity, code and tests in Python, Java or C++.")]

def interview_page():
    out = head("Interview", "MeetingLens Interview mode: automatic answers to the interviewer's questions, answer styles, mock practice and downloadable practice notes.", "interview.html")
    out += page_hero("Interview", "Practice, and answer, like an expert.", "Interview has its own screen. Start it, and each question the interviewer asks is answered as it is asked, in the style you choose.")
    out += '''    <section>
      <div class="wrap">
        <div class="sec-head"><p class="eyebrow">Answer styles</p><h2>One question, four ways to answer it.</h2><p class="lead">The sample question is: <em>"Design a multi-tenant CI/CD platform for internal teams. Focus on isolation, security and cost."</em></p></div>
        <div class="style-demo" data-tabs>
          <div class="tablist row" role="tablist" aria-label="Answer style">
'''
    for i, (sid, name, hint, _) in enumerate(STYLES):
        out += f'            <button type="button" role="tab" id="st-{sid}" aria-controls="sp-{sid}" aria-selected="{"true" if i==0 else "false"}" tabindex="{0 if i==0 else -1}"><b>{name}</b><small>{html.escape(hint)}</small></button>\n'
    out += '          </div>\n'
    for i, (sid, name, hint, ans) in enumerate(STYLES):
        out += f'          <div class="answer-card" role="tabpanel" id="sp-{sid}" aria-labelledby="st-{sid}"{"" if i==0 else " hidden"}><p class="label">Say it</p><p class="answer">{html.escape(ans)}</p></div>\n'
    out += '''        </div>
        <p class="fine" style="margin-top:14px">These are written examples to show the styles. Real answers are written live by your AI model from your question, notes and documents.</p>
      </div>
    </section>
    <section class="alt">
      <div class="wrap show">
        <div class="show-text">
          <p class="eyebrow">How it works</p>
          <h2>Start it and keep talking.</h2>
          <ol class="flow">
            <li><b>Press Start interview.</b> You stay on the Interview screen.</li>
            <li><b>The interviewer asks.</b> The question is detected from the other side's audio.</li>
            <li><b>The answer appears.</b> Say it, Understand it, Trade-offs, Hard words and the likely follow-up.</li>
            <li><b>Keep notes.</b> Download your practice notes as Word, Markdown or text.</li>
          </ol>
          <p class="fine" style="margin-top:16px">Use it for practice and preparation, and follow the rules of your interviewer or employer.</p>
        </div>
        <figure class="shot"><img src="media/app-interview.jpg" loading="lazy" width="1800" height="1125" alt="Interview screen with an answer, trade-offs and hard words."><figcaption>The Interview screen.</figcaption></figure>
      </div>
    </section>
    <section>
      <div class="wrap">
        <div class="sec-head"><p class="eyebrow">Coaching skills</p><h2>Four areas, each with its own coach.</h2></div>
        <div class="grid">
'''
    for name, text in SKILLS:
        out += f'          <article class="card"><h3>{name}</h3><p>{text}</p></article>\n'
    out += '''        </div>
        <div class="grid" style="margin-top:22px">
          <article class="card"><h3>Mock practice</h3><p>Get a question for your role, write your own answer, then get feedback on correctness, missing points, structure and clarity. Feedback is coaching, not a hiring score.</p></article>
          <article class="card"><h3>STAR without made-up facts</h3><p>For behavioral questions it uses only your own notes and documents. If they do not hold the facts, it asks you instead of inventing a job, date or result.</p></article>
          <article class="card"><h3>Read my screen</h3><p>If the interviewer shows a coding problem or command, one shortcut explains it. The screenshot is sent only when you ask.</p></article>
        </div>
      </div>
    </section>
    <section class="cta-band"><div class="wrap"><h2>Practice with it today.</h2><p class="lead">Free for Mac and Windows.</p><a class="btn btn-big" href="download.html">Download MeetingLens</a></div></section>
'''
    return out + FOOT

# ---------------------------------------------------------------- Video
CHAPTERS = [(0, "Meeting", "Live transcript and answers in simple words"), (5, "Interview", "Automatic answers to the interviewer's question"), (10, "Read my screen", "A command shown on screen, explained"), (15, "Overlay", "Only the words, over a shared screen"), (20, "Dark theme", "The same screen in dark mode")]
def video_page():
    out = head("Video", "Watch MeetingLens: a short walkthrough of Meeting, Interview, Read my screen and the overlay, plus the original real-call demo.", "video.html")
    out += page_hero("Video", "See MeetingLens in action.", "A short walkthrough of the current version, and the original recording of a real call.")
    out += '''    <section>
      <div class="wrap">
        <div class="player" data-player>
          <div class="video-card"><video id="walk" controls preload="metadata" poster="media/meetinglens-walkthrough-poster.jpg" width="1600" height="1000"><source src="media/meetinglens-walkthrough.mp4" type="video/mp4">Your browser can't play this video. <a href="media/meetinglens-walkthrough.mp4">Download it</a>.</video></div>
          <div class="chapters" role="list" aria-label="Chapters">
'''
    for i, (t, name, desc) in enumerate(CHAPTERS):
        out += f'            <button type="button" role="listitem" class="chapter{" is-on" if i==0 else ""}" data-t="{t}"><span class="ct">{t//60}:{t%60:02d}</span><span><b>{name}</b><small>{html.escape(desc)}</small></span></button>\n'
    out += '''          </div>
        </div>
        <p class="fine" style="margin-top:14px">The walkthrough is built from real captures of version ''' + VERSION + ''' and has no sound. Choose a chapter to jump to it.</p>
      </div>
    </section>
    <section class="alt">
      <div class="wrap show">
        <div class="show-text">
          <p class="eyebrow">Original demo</p>
          <h2>A real call, start to finish.</h2>
          <p>Every screen is a capture of the real app, with audio transcribed by whisper.cpp and answers from a local model. It shows the earlier look of the app, before the new design.</p>
        </div>
        <div class="video-card"><video controls preload="none" poster="media/meetinglens-demo-poster.jpg" width="1280" height="720"><source src="media/meetinglens-demo.mp4" type="video/mp4">Your browser can't play this video. <a href="media/meetinglens-demo.mp4">Download it</a>.</video></div>
      </div>
    </section>
    <section class="cta-band"><div class="wrap"><h2>Ready to try it?</h2><p class="lead">Free for Mac and Windows.</p><a class="btn btn-big" href="download.html">Download MeetingLens</a></div></section>
'''
    return out + FOOT

# ---------------------------------------------------------------- Privacy
MODES = [
 ("local", "Fully local", "Local speech engine and a local AI model.",
  [("Your voice", "stays", "Processed by whisper.cpp on your computer."), ("Transcript text", "stays", "Sent to the model running on your computer."), ("Screenshots", "stays", "Sent only to your local model, and only if it accepts images."), ("Saved sessions", "stays", "Stored in a local database.")]),
 ("cloudai", "Cloud AI model", "Local speech engine, cloud AI such as Gemini.",
  [("Your voice", "stays", "Processed by whisper.cpp on your computer."), ("Transcript text", "leaves", "The newest lines are sent to your AI provider to be explained and answered."), ("Screenshots", "leaves", "Only when you press Read my screen, use its shortcut, or turn on its automatic mode."), ("Saved sessions", "stays", "Stored in a local database.")]),
 ("cloudall", "Cloud speech and AI", "Deepgram speech and a cloud AI model.",
  [("Your voice", "leaves", "Streamed to Deepgram for transcription."), ("Transcript text", "leaves", "The newest lines are sent to your AI provider."), ("Screenshots", "leaves", "Only when you ask, as above."), ("Saved sessions", "stays", "Stored in a local database.")]),
]
FAQ = [
 ("Does MeetingLens record my calls?", "Not unless you turn on 'Save audio recordings' in Settings. By default it transcribes and saves text, not audio."),
 ("Where are my API keys stored?", "In your system keychain (macOS Keychain, Windows Credential Manager). They are never written to the database, settings files or logs."),
 ("Is there telemetry or an account?", "No. There is no account and no analytics. The app only contacts the speech and AI services you configure."),
 ("Can others see MeetingLens during screen sharing?", "You can ask your system to keep the app and overlay out of screen capture. This works with most tools but is not guaranteed, so check it before an important call."),
 ("What does Read my screen send?", "A shrunken screenshot of your main display, with the last few things said, to your AI provider. It runs only when you ask, or when you turn on its automatic mode. The image is deleted right after it is read."),
 ("Do I need to tell people I'm using it?", "Some places require everyone's consent to record or transcribe a conversation, and some interviewers or employers have rules about assistance. You are responsible for following them."),
]
def privacy_page():
    out = head("Privacy", "How MeetingLens handles your data: local by default, no account, no telemetry, and clear about what leaves your computer.", "privacy.html")
    out += page_hero("Privacy", "Your meeting stays yours.", "MeetingLens is local-first. Choose a setup to see exactly what stays on your computer and what is sent.")
    out += '''    <section>
      <div class="wrap">
        <div class="mode-demo" data-tabs>
          <div class="tablist row" role="tablist" aria-label="Setup">
'''
    for i, (mid, name, hint, _) in enumerate(MODES):
        out += f'            <button type="button" role="tab" id="m-{mid}" aria-controls="mp-{mid}" aria-selected="{"true" if i==0 else "false"}" tabindex="{0 if i==0 else -1}"><b>{name}</b><small>{html.escape(hint)}</small></button>\n'
    out += '          </div>\n'
    for i, (mid, name, hint, rows) in enumerate(MODES):
        out += f'          <div class="flow-card" role="tabpanel" id="mp-{mid}" aria-labelledby="m-{mid}"{"" if i==0 else " hidden"}>\n'
        for what, where, why in rows:
            label = "Stays on your computer" if where == "stays" else "Sent to a service you chose"
            out += f'            <div class="flow-row is-{where}"><span class="flow-what">{what}</span><span class="flow-badge">{label}</span><span class="flow-why">{html.escape(why)}</span></div>\n'
        out += '          </div>\n'
    out += '''        </div>
      </div>
    </section>
    <section class="alt">
      <div class="wrap">
        <div class="sec-head"><p class="eyebrow">Principles</p><h2>What we never do.</h2></div>
        <div class="grid">
          <article class="card"><h3>No telemetry, no account</h3><p>Nothing is collected about you or your meetings.</p></article>
          <article class="card"><h3>Never speaks for you</h3><p>Text is shown to you only. Nothing is typed or said into your call.</p></article>
          <article class="card"><h3>Always visible</h3><p>Capture indicators show when audio is being heard, and where audio and text go.</p></article>
          <article class="card"><h3>Keys stay in the keychain</h3><p>Never in files, logs or exports.</p></article>
        </div>
      </div>
    </section>
    <section>
      <div class="wrap narrow">
        <div class="sec-head"><p class="eyebrow">Questions</p><h2>Straight answers.</h2></div>
        <div class="faq">
'''
    for q, a in FAQ:
        out += f'          <details><summary>{html.escape(q)}</summary><p>{html.escape(a)}</p></details>\n'
    out += '''        </div>
        <p class="fine" style="margin-top:22px">Security issue? See <a href="''' + GH + '''/blob/main/SECURITY.md">SECURITY.md</a>.</p>
      </div>
    </section>
'''
    return out + FOOT

# ---------------------------------------------------------------- Download
def download_page():
    out = head("Download", "Download MeetingLens " + VERSION + " for Mac or Windows. Free, no account. Install steps, requirements and checksums.", "download.html")
    out += page_hero("Download", "Get MeetingLens.", f"Version {VERSION}. Free for Mac and, as an experiment, Windows. No account.")
    mac = REL + "/latest/download/MeetingLens.dmg"
    win = REL + "/latest/download/MeetingLens-Windows-Setup.exe"
    out += f'''    <section>
      <div class="wrap">
        <div class="os-demo" data-tabs data-auto-os>
          <div class="tablist row" role="tablist" aria-label="Operating system">
            <button type="button" role="tab" id="os-mac" aria-controls="op-mac" aria-selected="true" tabindex="0"><b>Mac</b><small>macOS 13+, Apple Silicon</small></button>
            <button type="button" role="tab" id="os-win" aria-controls="op-win" aria-selected="false" tabindex="-1"><b>Windows <span class="tag-exp">experimental</span></b><small>Windows 10/11, 64-bit</small></button>
          </div>
          <div class="dl-panel" role="tabpanel" id="op-mac" aria-labelledby="os-mac">
            <div class="dl-main">
              <a class="btn btn-big" data-download="mac" href="{mac}" download="MeetingLens.dmg">Download MeetingLens.dmg</a>
              <p class="fine">Version {VERSION} · 9.5 MB</p>
            </div>
            <ol class="install">
              <li>Open the downloaded <b>.dmg</b> and drag <b>MeetingLens</b> onto <b>Applications</b>.</li>
              <li>Open it. macOS says it can't verify the app because this early version isn't notarized by Apple yet. Click <b>Done</b>.</li>
              <li>Open <b>System Settings → Privacy &amp; Security</b>, scroll down and click <b>Open Anyway</b> next to MeetingLens.</li>
              <li>Allow <b>Microphone</b> and <b>Screen &amp; System Audio Recording</b> when asked, then quit and reopen once.</li>
              <li>Add an AI key (for example Gemini) in <b>Settings → AI provider</b>, or set up <a href="https://ollama.com">Ollama</a> and <a href="https://github.com/ggml-org/whisper.cpp">whisper.cpp</a> for a fully local setup.</li>
            </ol>
          </div>
          <div class="dl-panel" role="tabpanel" id="op-win" aria-labelledby="os-win" hidden>
            <div class="dl-main">
              <a class="btn btn-big" data-download="win" href="{win}" download="MeetingLens-Windows-Setup.exe">Download for Windows</a>
              <p class="fine">Version {VERSION} · 6.1 MB · Built and unit-tested on a Windows server, not yet tried on a real laptop. Read my screen is Mac-only for now.</p>
            </div>
            <ol class="install">
              <li>Run the installer. Windows shows <b>"Windows protected your PC"</b> because it isn't signed yet: click <b>More info → Run anyway</b>. It installs for your user only.</li>
              <li>Open MeetingLens and allow <b>Microphone</b> access when Windows asks.</li>
              <li>System audio is captured from your default output device, so play the call through your normal speakers or headphones.</li>
              <li>Add an AI key in <b>Settings → AI provider</b>, or set up <a href="https://ollama.com/download">Ollama for Windows</a> and <a href="https://github.com/ggml-org/whisper.cpp/releases">whisper.cpp</a> and set the paths in <b>Settings → Speech recognition</b>.</li>
            </ol>
          </div>
        </div>
        <p class="notice" id="platform-note" hidden></p>
      </div>
    </section>
    <section class="alt">
      <div class="wrap">
        <div class="sec-head"><p class="eyebrow">Before you install</p><h2>What you need.</h2></div>
        <div class="grid">
          <article class="card"><h3>An AI model</h3><p>A key for a cloud model such as Gemini, or a local model through Ollama. A vision-capable model is needed for Read my screen.</p></article>
          <article class="card"><h3>Speech recognition</h3><p>The built-in whisper.cpp engine on Mac, or Deepgram if you prefer the cloud.</p></article>
          <article class="card"><h3>Permissions</h3><p>Microphone and, on Mac, Screen &amp; System Audio Recording. MeetingLens never changes your system permissions for you.</p></article>
        </div>
        <div class="verify">
          <h3>Verify your download</h3>
          <p>Every release lists SHA-256 checksums. On a Mac, run this in Terminal and compare the result with the release notes:</p>
          <pre><code>shasum -a 256 ~/Downloads/MeetingLens.dmg</code></pre>
          <p class="fine"><a href="{REL}/tag/v{VERSION}">Release notes and checksums for v{VERSION}</a> · <a href="{REL}">All releases</a> · <a href="{GH}#install-as-a-mac-app">Build it yourself</a></p>
        </div>
      </div>
    </section>
    <div class="toast" id="started" role="status" aria-live="polite" hidden>
      <div><b>Your download has started.</b><p>Open it from your Downloads and follow the steps on this page.</p></div>
      <button type="button" aria-label="Dismiss">×</button>
    </div>
'''
    return out + FOOT

if __name__ == "__main__":
    pages = {"features.html": features_page, "interview.html": interview_page, "video.html": video_page, "privacy.html": privacy_page, "download.html": download_page}
    for name, fn in pages.items():
        (SITE / name).write_text(fn(), encoding="utf-8")
        print("wrote", name)
