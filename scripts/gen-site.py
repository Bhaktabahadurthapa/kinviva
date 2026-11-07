#!/usr/bin/env python3
"""Generates the whole Kinviva website in site/ (home, features, technical, whiteboard, discover,
interview, video, privacy, download). Only site files are written. Run: python3 scripts/gen-site.py"""
import html, os, pathlib

SITE = pathlib.Path(__file__).resolve().parent.parent / "site"
GH = "https://github.com/Bhaktabahadurthapa/kinviva"
REL = GH + "/releases"
INSTALLER = "0.1.5"   # the version people can download today (the first one named Kinviva)
NEXT = "0.1.5"        # features added since 0.1.4 carry a "New in" badge
DMG = REL + "/latest/download/Kinviva.dmg"
EXE = REL + "/latest/download/Kinviva-Windows-Setup.exe"
CURRENT_BASE = "https://bhaktathapa.com.np/kinviva/"
# Public address of the site. Stays on the current address until the owner approves the move to kinviva.tech;
# then build with KINVIVA_SITE_BASE=https://kinviva.tech/ (see docs/kinviva-launch/MOVE-TO-KINVIVA-TECH.md).
BASE = os.environ.get("KINVIVA_SITE_BASE", CURRENT_BASE)
if not BASE.endswith("/"): BASE += "/"
MOVED = BASE != CURRENT_BASE
OG = CURRENT_BASE + "media/v2-dashboard.jpg"
# Address of the deployed Early Access service. Empty until the owner approves deploying it; the form then stays closed.
EA_ENDPOINT = os.environ.get("KINVIVA_EA_ENDPOINT", "")
EA_MESSAGE = "Discover what's next with Kinviva. Join Early Access for advanced AI workflows, technical copilots, and productivity features. We'll contact selected participants as access becomes available."

NAV = [("index.html", "Product"), ("features.html", "Features"), ("community.html", "Community"), ("early-access.html", "Pro Early Access"), ("docs.html", "Documentation"), (GH, "GitHub")]

ICON = {
 "home": "M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10",
 "mic": "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3",
 "chat": "M4 5h16v10H9l-5 4zM8 9h8M8 12h5",
 "cap": "M3 8l9-5 9 5-9 5zM7 10.5V16c0 1 2.2 3 5 3s5-2 5-3v-5.5",
 "code": "M8 8l-4 4 4 4M16 8l4 4-4 4M14 5l-4 14",
 "present": "M3 4h18v11H3zM12 15v5M8 20h8",
 "board": "M3 5h18v12H3zM8 21h8M12 17v4M7 12l3-3 3 3 3-4",
 "compass": "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM15.5 8.5l-2 5-5 2 2-5z",
 "book": "M3 18V6a2 2 0 0 1 2-2h14v14H5a2 2 0 0 0-2 2zM8 8h7M8 12h5",
 "note": "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
 "chart": "M4 20V10M10 20V4M16 20v-7M22 20H2",
 "diagram": "M4 4h6v5H4zM14 4h6v5h-6zM9 15h6v5H9zM7 9v3h10V9M12 12v3",
 "search": "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4",
 "lock": "M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3",
 "shield": "M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z",
 "alert": "M12 3l10 18H2zM12 10v5M12 18h.01",
 "monitor": "M3 5h18v12H3zM8 21h8M12 17v4",
 "layers": "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5",
 "sun": "M12 3v2M12 19v2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M3 12h2M19 12h2M5.6 18.4L7 17M17 7l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
 "cloud": "M7 18a4 4 0 1 1 .8-7.9A6 6 0 0 1 19 11a3.5 3.5 0 0 1-.5 7z",
 "download": "M12 4v12M7 11l5 5 5-5M5 20h14",
 "check": "M5 12.5l4.5 4.5L19 7.5",
 "clock": "M12 7v5l3 2M21 12a9 9 0 1 1-3-6.7M21 4v5h-5",
 "star": "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z",
}
def svg(name, size=24):
    return f'<svg viewBox="0 0 24 24" width="{size}" height="{size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="{ICON[name]}"/></svg>'

def esc(s): return html.escape(s, quote=True)

def head(title, desc, page, og=OG):
    links = "\n".join(f'        <a href="{h}"{" aria-current=\"page\"" if h == page else ""}>{l}</a>' for h, l in NAV)
    return f'''<!doctype html>
<html lang="en" class="no-js">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{esc(title)}</title>
  <meta name="description" content="{esc(desc)}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="{esc(title)}">
  <meta property="og:description" content="{esc(desc)}">
  <link rel="canonical" href="{BASE}{"" if page == "index.html" else page}">
  <meta property="og:url" content="{BASE}{"" if page == "index.html" else page}">
  <meta property="og:image" content="{og.replace(CURRENT_BASE, BASE)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="theme-color" content="#232a40">
  <link rel="icon" href="logo.svg" type="image/svg+xml">
  <link rel="stylesheet" href="style.css">
  <script>document.documentElement.className = "js";</script>
</head>
<body>
  <a class="skip" href="#main">Skip to content</a>
  <header class="nav">
    <div class="wrap">
      <a class="brand" href="index.html" aria-label="Kinviva home"><img src="logo.svg" width="34" height="34" alt=""><span>Kin<em>viva</em></span></a>
      <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav" aria-label="Menu"><span></span><span></span><span></span></button>
      <nav id="site-nav" aria-label="Primary">
{links}
        <a class="btn btn-primary btn-small" href="download.html">Download</a>
      </nav>
    </div>
  </header>
  <main id="main">
'''

def foot():
    return f'''  </main>
  <footer>
    <div class="wrap">
      <div class="foot-grid">
        <div>
          <p class="foot-brand"><img src="logo.svg" width="30" height="30" alt=""> <b>Kinviva</b></p>
          <p>Hear it. Understand it. Visualize it. Keep it.</p>
          <p>Local-first. The Community Edition is free and needs no account.</p>
        </div>
        <div class="foot-links"><p><b>Product</b></p><a href="features.html">All features</a><a href="technical.html">Technical Copilot</a><a href="whiteboard.html">Whiteboard &amp; charts</a><a href="discover.html">Discover &amp; skills</a></div>
        <div class="foot-links"><p><b>Use cases</b></p><a href="interview.html">Interview</a><a href="features.html#classroom">Classroom</a><a href="features.html#presentation">Presentation</a></div>
        <div class="foot-links"><p><b>Project</b></p><a href="download.html">Download</a><a href="community.html">Community</a><a href="early-access.html">Pro Early Access</a><a href="docs.html">Documentation</a><a href="privacy.html">Privacy</a><a href="{GH}">Source on GitHub</a><a href="{GH}/blob/main/THIRD_PARTY_NOTICES.md">Third-party notices</a></div>
      </div>
      <p class="legal">© 2026 Bhakta Thapa · Built by BKT AI. Screenshots on this site use sample data. Use Kinviva within the rules of your school, employer and local law on recording.</p>
    </div>
  </footer>
  <script src="site.js"></script>
</body>
</html>
'''

def page_head(eyebrow, title, lead, toc=None):
    t = ""
    if toc:
        t = '<nav class="toc" aria-label="On this page">' + "".join(f'<a href="#{a}">{l}</a>' for a, l in toc) + "</nav>"
    return f'''    <div class="page-head"><div class="wrap"><p class="eyebrow">{eyebrow}</p><h1>{title}</h1><p class="lead">{lead}</p>{t}</div></div>
'''

def card(icon, tone, title, text, href=None, badge=None, more="Learn more"):
    b = f'<span class="badge {"b-now" if badge == "now" else "b-next"}">{"In the current installer" if badge == "now" else "New in " + NEXT}</span>' if badge else ""
    inner = f'<span class="ico t-{tone}">{svg(icon)}</span>{b}<h3>{title}</h3><p>{text}</p>' + (f'<span class="more">{more} →</span>' if href else "")
    return f'<a class="card reveal" href="{href}">{inner}</a>' if href else f'<article class="card reveal">{inner}</article>'

def spot(img, alt, eyebrow, title, text, bullets, flip=False, badge=None, caption="Sample data", link=None):
    b = f'<span class="badge {"b-now" if badge == "now" else "b-next"}">{"In the current installer" if badge == "now" else "New in " + NEXT}</span>' if badge else ""
    li = "".join(f"<li>{x}</li>" for x in bullets)
    more = f'<p><a class="btn btn-small" href="{link[0]}">{link[1]} →</a></p>' if link else ""
    return f'''        <div class="spot reveal{" flip" if flip else ""}">
          <div class="spot-text"><p class="eyebrow">{eyebrow}</p>{b}<h2>{title}</h2><p class="lead">{text}</p><ul>{li}</ul>{more}</div>
          <figure class="shot"><img src="media/{img}" alt="{esc(alt)}" loading="lazy" width="1800" height="1125"><figcaption>{caption}</figcaption></figure>
        </div>
'''

def cta(title="Free, local-first, and yours.", lead=f"Download the Kinviva Community Edition for Mac or Windows. No account, no subscription."):
    return f'''    <section><div class="wrap"><div class="cta-band reveal"><h2>{title}</h2><p class="lead">{lead}</p><a class="btn btn-primary btn-big" href="download.html">Download Kinviva</a></div></div></section>
'''

def write(name, content):
    (SITE / name).write_text(content)

NOTICE = f'''<div class="notice"><b>About versions</b><p>The installer you can download today is <b>{INSTALLER}</b>, the first release named Kinviva (it was MeetingLens before). Features marked <b>New in {NEXT}</b> were added since 0.1.4.</p></div>'''

# ------------------------------------------------------------------ Home
def home():
    o = head("Kinviva: your local-first workspace for important conversations",
             "Kinviva listens to meetings, interviews and lectures, explains them in plain words, draws diagrams and whiteboards, and helps you learn. Free for Mac and Windows, no account.", "index.html")
    o += f'''    <section class="hero">
      <div class="wrap">
        <p class="eyebrow">Free · Local-first · No account</p>
        <h1>Hear it. Understand it. <span>Visualize it.</span></h1>
        <p class="lead">Kinviva listens to your meetings, interviews and lectures, explains every point in plain words, and turns what was said into diagrams, whiteboards, notes and notes. It all stays on your computer.</p>
        <div class="cta"><a class="btn btn-primary btn-big" href="download.html">Download for free</a><a class="btn btn-ghost btn-big" href="features.html">See every feature</a></div>
        <p class="fine">Mac and Windows · Current installer {INSTALLER} · <a href="{GH}">Source on GitHub</a></p>
        <div class="stage">
          <div class="tabs on-dark" role="tablist" aria-label="Theme" data-tabs>
            <button role="tab" id="tab-light" aria-selected="true" aria-controls="p-light">Light</button>
            <button role="tab" id="tab-dark" aria-selected="false" aria-controls="p-dark" tabindex="-1">Dark</button>
          </div>
          <div class="frame"><div class="frame-bar"><i></i><i></i><i></i><span>Kinviva · Dashboard (sample data)</span></div>
            <div id="p-light" class="panel" role="tabpanel" aria-labelledby="tab-light"><img src="media/v2-dashboard.jpg" alt="The Kinviva Dashboard in light mode: activity counts, recent sessions, an assistant and discover cards" width="1800" height="1125"></div>
            <div id="p-dark" class="panel" role="tabpanel" aria-labelledby="tab-dark" hidden><img src="media/v2-dashboard-dark.jpg" alt="The Kinviva Dashboard in dark mode" width="1800" height="1125" loading="lazy"></div>
          </div>
        </div>
      </div>
    </section>
    <section class="facts"><div class="wrap">
      <div class="fact"><b>Local-first</b><span>Your sessions, notes and boards live on your computer.</span></div>
      <div class="fact"><b>No account</b><span>No sign-up, no subscription, no telemetry.</span></div>
      <div class="fact"><b>Your own AI</b><span>Use a cloud key or a local model. You choose.</span></div>
      <div class="fact"><b>Honest by design</b><span>Every answer shows where it came from.</span></div>
    </div></section>

    <section>
      <div class="wrap">
        <div class="sec-head center"><p class="eyebrow">One workspace</p><h2>Everything around a conversation, in one place.</h2><p class="lead">Capture it, understand it, draw it, keep it, and learn from it. Each part works with the others.</p></div>
        <div class="grid g3">
          {card("mic", "blue", "Meetings", "Live transcript, plain-English explanations, suggested replies, recaps, and decisions with owners.", "features.html#meetings")}
          {card("chat", "rose", "Interviews", "Questions are answered as they are asked, in the style you choose, without inventing your experience.", "interview.html")}
          {card("code", "teal", "Technical Copilot", "Explain terms, plan safe troubleshooting, track incidents and draw architecture from what was said.", "technical.html", "next")}
          {card("board", "blue", "Whiteboard", "An editable board with diagrams drawn from your sessions. Change them in words, with a preview first.", "whiteboard.html", "next")}
          {card("chart", "rose", "Charts", "Bar, line and pie charts built only from numbers that really appear in your material.", "whiteboard.html#charts", "next")}
          {card("compass", "purple", "Discover", "Real articles and projects from official engineering sources, matched to the skills you follow.", "discover.html", "next")}
          {card("cap", "green", "Classroom", "Lecture notes, study guides and practice quizzes from the lecture and your course files.", "features.html#classroom", "next")}
          {card("present", "amber", "Presentation", "Speaker notes, rehearsal feedback and answers to audience questions, from your own slides.", "features.html#presentation", "next")}
        </div>
      </div>
    </section>

    <section class="alt">
      <div class="wrap">
        <div class="sec-head"><p class="eyebrow">Tour</p><h2>See what it does.</h2></div>
{spot("v2-meeting.jpg", "Meetings screen with a live transcript on the left and explanations in simple words on the right", "Meetings", "Understand it while it is said.", "A live transcript on one side and plain-English insights on the other. Hard words are explained, and your answers come out ready to say.", ["<b>Explain, Suggest reply, Recap and Ask</b> from the bar at the bottom", "<b>Decisions &amp; actions</b>: a decision needs a real quote, an owner only if someone said it", "<b>Important words are highlighted</b> so you can scan an answer in a second"], False, None, f"Sample data. Decisions and highlights arrive in {NEXT}.")}
{spot("v2-troubleshoot.jpg", "Technical Copilot troubleshooting plan with possible causes, evidence to collect and read-only commands", "Technical Copilot", "Solve it safely.", "Describe a problem and get a plan: possible causes marked as hypotheses, the evidence to collect, and read-only commands you copy and run yourself.", ["<b>Never runs a command</b> and removes any that could change something", "<b>Incident tracker</b> with a root cause that stays locked until the evidence supports it", "<b>Architecture diagrams</b> with verified, mentioned and inferred parts clearly marked"], True, "next", link=("technical.html", "Explore Technical Copilot"))}
{spot("v2-whiteboard.jpg", "An editable whiteboard with a flowchart generated from a conversation and an AI panel on the right", "Whiteboard", "Draw it, then make it yours.", "Turn a meeting, an interview or a lecture into an editable diagram on a real whiteboard. Move it, rename it, and extend it with a sentence.", ["<b>Changes are previewed</b> in plain words before anything is applied", "<b>Your drawings are never overwritten</b>, and versions are saved before every change", "<b>Export</b> to PNG, SVG, an editable file or Mermaid text"], False, "next", link=("whiteboard.html", "Explore the Whiteboard"))}
{spot("v2-discover.jpg", "Discover page with interests and news items with pictures", "Discover", "Keep learning what matters to you.", "Add any skill you want to grow. Kinviva finds real articles and open-source projects from official sources and ranks them for you, on your computer.", ["<b>Real sources only</b>: eight official engineering blogs and GitHub", "<b>Any skill or topic</b>, not just a fixed list", "<b>Explain, save to notes, draw it or add it to a learning plan</b>"], True, "next", link=("discover.html", "Explore Discover"))}
      </div>
    </section>

    <section>
      <div class="wrap">
        <div class="sec-head center"><p class="eyebrow">Honest by design</p><h2>Every part of a diagram says where it came from.</h2><p class="lead">Kinviva never presents a guess as a fact. When it draws your architecture, each box and line carries one of three labels, decided by code, not by the model.</p></div>
        <div class="legend reveal">
          <div class="ev v"><b>Verified</b><p>A document you selected mentions it.</p></div>
          <div class="ev m"><b>Mentioned</b><p>Someone in the conversation said it, in those words.</p></div>
          <div class="ev i"><b>Inferred</b><p>Kinviva suggests it. Drawn dashed, never called a fact.</p></div>
        </div>
      </div>
    </section>

    <section class="alt">
      <div class="wrap">
        <div class="sec-head center"><p class="eyebrow">How it works</p><h2>Three steps. Nothing to set up first.</h2></div>
        <div class="steps">
          <div class="step reveal"><h3>Start</h3><p>Press Start. Kinviva listens to the call and your microphone and writes the transcript on your computer.</p></div>
          <div class="step reveal"><h3>Understand</h3><p>Each finished thought is explained in plain words. Ask a question, get a reply to say, or request a recap.</p></div>
          <div class="step reveal"><h3>Keep and use</h3><p>Save notes, draw a diagram, make a quiz. It is all searchable.</p></div>
        </div>
      </div>
    </section>

    <section class="dark">
      <div class="wrap">
        <div class="sec-head center"><p class="eyebrow">Privacy</p><h2>Your conversations stay yours.</h2><p class="lead">Use local speech and a local model and nothing leaves your computer. If you choose a cloud service, the app tells you exactly what is sent.</p></div>
        <div class="grid g4">
          {card("lock", "purple", "Raw audio stays local", "Recordings are off unless you turn them on.")}
          {card("shield", "teal", "Keys in the keychain", "Never in files, logs or exports.")}
          {card("cloud", "blue", "No account, no telemetry", "Nothing is collected about you.")}
          {card("check", "green", "Never speaks for you", "Text is shown to you only. Nothing is typed into your call.")}
        </div>
        <p style="margin-top:28px;text-align:center"><a class="btn btn-ghost" href="privacy.html">Read the privacy details</a></p>
      </div>
    </section>

    <section>
      <div class="wrap">
        <div class="sec-head center"><p class="eyebrow">Questions</p><h2>Straight answers.</h2></div>
        <div class="faq">
          <details><summary>Is Kinviva really free?</summary><p>Yes. There is no account, no subscription and no paid tier. You only pay for any cloud AI service you choose to connect, such as Gemini. You can also use a local model for free.</p></details>
          <details><summary>What can I download today?</summary><p>The current installer is {INSTALLER}. It includes everything shown on this site: Meetings, Interviews, Technical Copilot, Classroom, Presentation, Whiteboard, Visuals, Notes and Discover.</p></details>
          <details><summary>Does it record my calls?</summary><p>Not unless you turn on "Save audio recordings" in Settings. By default it saves text, not audio.</p></details>
          <details><summary>Is it accurate?</summary><p>Answers are suggestions from the AI service you connect and can be wrong. Kinviva labels what it knows and what it guesses, and never invents your own experience, but you decide what to say or do.</p></details>
          <details><summary>Which computers does it run on?</summary><p>Macs with Apple silicon (macOS 13 or later). A Windows installer is available as an experiment.</p></details>
        </div>
      </div>
    </section>
{editions_band()}
{cta()}'''
    o += foot()
    write("index.html", o)

# ------------------------------------------------------------------ Features
GROUPS = [
 ("meetings", "Meetings", "mic", "blue", "now", "Understand every point while the call is still going.", [
   ("Live transcript", "Two sources, Them and Me, written as people speak. Search the transcript and resize the panels.", "now"),
   ("Plain-English insights", "Each finished thought is explained in simple words with its hard words listed. Auto-assist works hands-free.", "now"),
   ("Ask, Explain, Suggest reply, Recap", "Ask about the meeting and the answer comes only from what was said. Answers show in the reading view, with key words highlighted.", "next"),
   ("Decisions &amp; action items", "Confirmed decisions with the quote that proves them, and action items with an owner or a deadline only when someone said it.", "next"),
   ("Pause and resume", "Stop transcribing for a moment without closing the capture.", "now"),
   ("Session saved pop-up", "When a session ends, download your notes as Word, Markdown or text in one click.", "next")]),
 ("interviews", "Interviews", "chat", "rose", "now", "Practise and answer like an expert, without inventing a thing.", [
   ("Automatic answers", "Press Start interview and each question is answered as it is asked: say it, understand it, trade-offs, hard words and a likely follow-up.", "now"),
   ("Answer styles", "Simple, Professional, Technical or STAR. STAR uses only your own notes and never invents facts.", "now"),
   ("Mock practice", "Get a question for your role, write your answer, then get feedback on correctness, missing points and clarity.", "now"),
   ("Job description analysis", "Paste a job description: skills they want, likely questions and what to prepare, compared with your own documents.", "next"),
   ("Ask bar", "Ask, Explain, Suggest reply and Recap are also on the Interview screen.", "next")]),
 ("technical", "Technical Copilot", "code", "teal", "next", "Explain, troubleshoot, track and draw engineering discussions.", [
   ("Explain", "A term or the latest point, in simple words first and then more depth.", "next"),
   ("Safe troubleshooting", "Causes are hypotheses. Commands are read-only and are copied, never run.", "next"),
   ("Incident tracker", "Symptoms, hypotheses, evidence, actions and decisions. A root cause needs supporting evidence.", "next"),
   ("Architecture diagrams", "Mermaid diagrams from the conversation with verified, mentioned and inferred labels.", "next")]),
 ("classroom", "Classroom", "cap", "green", "next", "Study help from the lecture and your course files.", [
   ("Lecture notes", "Clean notes with definitions, examples and review questions.", "next"),
   ("Study guides", "Key concepts and self-check questions. A reminder says it is study help, not finished coursework.", "next"),
   ("Practice quizzes", "Multiple choice questions with explanations. Your score stays on your computer.", "next"),
   ("Course sessions", "Choose a course and a week, and answers cite your files by name and page.", "now")]),
 ("presentation", "Presentation", "present", "amber", "next", "Prepare, rehearse and handle questions.", [
   ("Speaker notes", "Notes for every slide, transitions and likely questions, only from your own material.", "next"),
   ("Rehearsal feedback", "Paste what you said and get feedback on clarity, structure and pace.", "next"),
   ("Audience questions", "Suggested answers grounded in your slides, with a flag when your material does not cover it.", "next")]),
 ("visuals", "Whiteboard &amp; charts", "board", "blue", "next", "Draw, edit and chart what matters.", [
   ("Editable whiteboard", "Draw freely, or generate a diagram from a session, a note or a saved architecture.", "next"),
   ("Edit with words", "Describe a change, see it in plain words, then apply it. Only the targeted objects change.", "next"),
   ("Versions and export", "Versions are saved before every automatic change. Export PNG, SVG, an editable file or Mermaid.", "next"),
   ("Charts with sources", "Bar, line and pie charts built only from numbers in your material, each marked as sourced or entered by you.", "next")]),
 ("knowledge", "Knowledge", "search", "teal", "next", "Find anything you kept.", [
   ("All Notes", "Autosaved notes. Save any answer, plan or decision to notes in one click.", "next"),
   ("Global search", "One search over sessions, transcripts, notes, documents, diagrams and boards.", "next"),
   ("Documents", "Add PDF, Word, text or Markdown files. Answers cite the file and page, checked by the app.", "now")]),
 ("discover", "Discover &amp; skills", "compass", "purple", "next", "Learn the skills you choose.", [
   ("Discover", "Articles with pictures and projects from official sources, ranked for the skills you follow.", "next"),
   ("Your own skills", "Add any skill or topic. It matches articles and searches GitHub for it.", "next")]),
 ("control", "Comfort &amp; control", "sun", "amber", "now", "Make it look and work the way you like.", [
   ("Light, dark or match your Mac", "One-click switch in the top bar.", "next"),
   ("Hide the menu, full screen", "Collapse the menu (Cmd/Ctrl+B) and take the whiteboard or notes full screen.", "next"),
   ("Clear overlay", "A see-through window beside your call. Turn it fully clear and only the words show.", "now"),
   ("Read my screen", "Explains a coding problem, command or error on your screen with one shortcut (Mac).", "now"),
   ("Text size and fonts", "Small, normal or large text, and an easy-to-read font.", "now")]),
]
def features():
    o = head("Features · Kinviva", "Every Kinviva feature: meetings, interviews, Technical Copilot, Classroom, Presentation, Whiteboard, charts, Discover, notes and search.", "features.html")
    o += page_head("Features", "Everything Kinviva does.", "Nine areas, one workspace. Features marked New in 0.1.5 were added since the previous version.", [(g[0], g[1]) for g in GROUPS])
    o += f'    <section><div class="wrap">{NOTICE}</div></section>\n'
    for i, (gid, name, ic, tone, badge, tag, items) in enumerate(GROUPS):
        o += f'''    <section id="{gid}"{' class="alt"' if i % 2 == 0 else ""} style="padding:72px 0"><div class="wrap">
      <div class="sec-head"><span class="ico t-{tone}">{svg(ic)}</span><h2>{name}</h2><p class="lead">{tag}</p></div>
      <div class="grid g3">
'''
        for t, d, b in items:
            o += card("check", tone, t, d, None, b) + "\n"
        o += "      </div></div></section>\n"
    o += f'''    <section><div class="wrap">
      <div class="sec-head center"><p class="eyebrow">Gallery</p><h2>A closer look.</h2><p class="lead">Screenshots use sample data.</p></div>
      <div class="grid g2">
        <figure class="shot reveal"><img src="media/v2-notes.jpg" alt="All Notes with a list and an editor" loading="lazy" width="1800" height="1125"><figcaption>All Notes: autosaved, searchable, full screen on demand</figcaption></figure>
        <figure class="shot reveal"><img src="media/v2-classroom.jpg" alt="Classroom tools: lecture notes, study guide, practice questions and explain a concept" loading="lazy" width="1800" height="1125"><figcaption>Classroom: notes, study guide and practice quizzes</figcaption></figure>
        <figure class="shot reveal"><img src="media/v2-presentation.jpg" alt="Presentation tools: speaker notes, rehearsal feedback and audience questions" loading="lazy" width="1800" height="1125"><figcaption>Presentation: speaker notes and rehearsal feedback</figcaption></figure>
        <figure class="shot reveal"><img src="media/v2-meeting-dark.jpg" alt="Meetings in dark mode" loading="lazy" width="1800" height="1125"><figcaption>Dark mode, one click from the top bar</figcaption></figure>
      </div>
    </div></section>
'''
    o += cta()
    o += foot()
    write("features.html", o)

# ------------------------------------------------------------------ Technical
def technical():
    o = head("Technical Copilot · Kinviva", "Explain engineering terms, plan safe read-only troubleshooting, track incidents and draw architecture with verified, mentioned and inferred labels.", "technical.html", "https://bhaktathapa.com.np/kinviva/media/v2-troubleshoot.jpg")
    o += page_head("Technical Copilot", "Understand and solve engineering problems, safely.", "For Kubernetes, AWS, Azure, Linux, networking, Terraform, CI/CD, databases, monitoring and more. It explains, it plans, it draws, and it never touches your systems.", [("explain", "Explain"), ("troubleshoot", "Troubleshoot"), ("incidents", "Incidents"), ("architecture", "Architecture")])
    o += f'    <section><div class="wrap">{NOTICE}</div></section>\n'
    o += f'''    <section id="explain" style="padding-top:20px;padding-bottom:20px"><div class="wrap"><div class="grid g3">
      {card("code", "teal", "Explain a term or a point", "Paste a command, an error or a design question, or leave it empty to explain the latest technical point from the conversation.", None, "next")}
      {card("book", "blue", "Simple words first, then depth", "A short plain explanation, then how it works with an example and one common mistake, and the key terms in a word list.", None, "next")}
      {card("chat", "rose", "Covers the stack", "Kubernetes, AWS, Azure, Linux, networking, Terraform, CI/CD, DevSecOps, SRE, monitoring, databases, microservices, AI agents and MCP.", None, "next")}
    </div></div></section>
    <section id="troubleshoot" style="padding-top:20px"><div class="wrap">
'''
    o += spot("v2-troubleshoot.jpg", "A troubleshooting plan with hypotheses and read-only commands", "Troubleshoot", "A plan you can trust, not a guess.", "Describe the symptom. You get possible causes, the evidence to collect, commands to try, and how to confirm a fix.", ["Causes are labelled <b>hypotheses, not confirmed</b>", "Each command shows its purpose, what to expect and a risk level", "A command that could change anything is <b>removed and counted</b>", "Kinviva <b>never runs a command</b>. You review it and run it yourself", "Save the plan to notes, or track it as an incident"], False, "next")
    o += "      </div></section>\n"
    o += '''    <section class="alt"><div class="wrap">
      <div class="sec-head"><p class="eyebrow">Safety rules</p><h2>What counts as read-only.</h2><p class="lead">A command is kept only if it looks at things without changing them. The check is code, not the model, and it is tested against dozens of examples.</p></div>
      <table class="table reveal"><thead><tr><th>Kept</th><th>Removed</th></tr></thead><tbody>
        <tr><td><code>kubectl get pods -n prod</code><br><code>kubectl describe pod web-1</code><br><code>kubectl logs deploy/api --tail=100</code></td><td><code>kubectl delete pod web-1</code><br><code>kubectl apply -f x.yaml</code><br><code>kubectl rollout restart deploy/api</code></td></tr>
        <tr><td><code>aws ec2 describe-instances</code><br><code>az aks show -n c1 -g rg1</code></td><td><code>aws ec2 terminate-instances</code><br><code>terraform apply</code> · <code>terraform destroy</code></td></tr>
        <tr><td><code>dig example.com</code> · <code>ss -tulpn</code> · <code>df -h</code> · <code>ping -c 3 host</code></td><td>Anything with <code>sudo</code>, pipes, redirects, chaining, <code>rm</code>, or an endless <code>ping</code> or <code>tail -f</code></td></tr>
      </tbody></table>
    </div></section>
'''
    o += f'''    <section id="incidents"><div class="wrap">
      <div class="grid g2">
        {card("alert", "rose", "Incident tracker", "Keep symptoms, hypotheses, evidence, investigative actions, decisions, open questions and follow-ups in one place. Fill it from the conversation, and it only adds what people actually said.", None, "next")}
        {card("shield", "green", "Never a root cause without evidence", "The root cause field stays locked until one hypothesis is marked supported and some evidence is recorded. A wrong confident answer is worse than no answer.", None, "next")}
      </div>
    </div></section>
    <section class="alt" id="architecture"><div class="wrap">
{spot("v2-architecture.jpg", "An architecture diagram of a load balancer, ingress, services and a database with an explanation panel", "Architecture", "Draw the system people describe.", "Say it out loud: a load balancer, an ingress controller, Kubernetes services and PostgreSQL. Kinviva drafts the diagram and explains it in simple words.", ["Flowcharts and sequence diagrams from the conversation", "Zoom, pan, full screen, edit the Mermaid source, export SVG or PNG", "Saved with your session, with plain-English concerns such as single points of failure", "Updates while you talk, only after a quiet moment and never more than every 45 seconds"], True, "next")}
      <div class="sec-head center" style="margin-top:80px"><h2>Facts and guesses are never mixed.</h2><p class="lead">The label on each part is decided by code that checks the transcript and your documents.</p></div>
      <div class="legend reveal"><div class="ev v"><b>Verified</b><p>A document you selected mentions it.</p></div><div class="ev m"><b>Mentioned</b><p>The conversation used those words.</p></div><div class="ev i"><b>Inferred</b><p>Kinviva suggests it. Dashed, with a warning when there is little evidence.</p></div></div>
      <div class="grid g2" style="margin-top:20px">
        {card("lock", "purple", "Locked down", "Diagram source is checked before it is drawn: no links, scripts, HTML or directives, and a size limit. The picture is cleaned again before it is shown.")}
        {card("search", "teal", "Illustrative when thin", "If there is little evidence, the diagram is clearly marked illustrative and confidence is lowered.")}
      </div>
    </div></section>
{cta("Bring a real problem.")}'''
    o += foot()
    write("technical.html", o)

# ------------------------------------------------------------------ Whiteboard
def whiteboard():
    o = head("Whiteboard & charts · Kinviva", "An editable whiteboard that turns meetings, interviews and lectures into diagrams, with previewed edits, versions, export, and charts built from real numbers.", "whiteboard.html", "https://bhaktathapa.com.np/kinviva/media/v2-whiteboard.jpg")
    o += page_head("Whiteboard &amp; charts", "Turn what was said into something you can see.", "A real whiteboard, with diagrams drawn from your sessions. Edit them by hand or with a sentence, and never lose your own work.", [("board", "Whiteboard"), ("ai", "Edit with words"), ("charts", "Charts"), ("export", "Export")])
    o += f'    <section><div class="wrap">{NOTICE}</div></section>\n    <section id="board" style="padding-top:20px"><div class="wrap">\n'
    o += spot("v2-whiteboard.jpg", "Whiteboard with a generated flowchart and generation tools on the right", "Whiteboard", "A canvas that starts with your conversation.", "Open Visuals &amp; Diagrams, pick a live meeting, interview, lecture or saved session, and press one button. The diagram appears on a new board, ready to edit.", ["Flowchart, concept map, decision tree, timeline or sequence", "Every object is editable: move, resize, rename, add arrows, sticky notes and handwriting", "Mouse, trackpad and keyboard, and a stylus. Apple Pencil works through Sidecar or a compatible iPad", "Autosave, <b>full screen</b>, and an uncluttered tool panel"], False, "next")
    o += '''      </div></section>
    <section class="alt" id="ai"><div class="wrap">
      <div class="sec-head"><p class="eyebrow">Edit with words</p><h2>Say the change. Check it. Apply it.</h2></div>
      <div class="steps">
        <div class="step reveal"><h3>Describe it</h3><p>“Add a cache between the API and the database” or “highlight the single point of failure”.</p></div>
        <div class="step reveal"><h3>Preview it</h3><p>Kinviva lists each change in plain words: add, rename, remove, connect, highlight or explain.</p></div>
        <div class="step reveal"><h3>Apply it</h3><p>Only the targeted objects change. Your own drawings are never overwritten, and a version is saved first.</p></div>
      </div>
    </div></section>
'''
    o += f'''    <section id="charts"><div class="wrap">
{spot("v2-charts.jpg", "A bar chart with an editable data table showing where each number came from", "Charts", "Numbers you can trace.", "Build bar, line and pie charts from a conversation or text you paste. A number is marked as sourced only when it really appears in your material.", ["Each row says: from your material, not found, or entered by you", "Edit labels, colors, units and values. An edited value is clearly flagged", "No numbers in the material? It says so instead of inventing some", "Charts with nothing sourced are labelled illustrative"], True, "next")}
    </div></section>
    <section class="alt" id="export"><div class="wrap">
      <div class="sec-head center"><h2>Keep it, share it, take it with you.</h2></div>
      <div class="grid g4">
        {card("download", "purple", "PNG and SVG", "Clean images for documents and slides.")}
        {card("board", "blue", "Editable file", "Save an .excalidraw file and open it elsewhere.")}
        {card("code", "teal", "Mermaid text", "Copy a connected diagram as Mermaid source.")}
        {card("clock", "amber", "Versions", "Thirty versions kept per board, saved before every automatic change.")}
      </div>
      <p class="muted" style="margin-top:22px;text-align:center">Built on the open-source Excalidraw editor, Mermaid and Recharts. PDF export is not offered.</p>
    </div></section>
{cta()}'''
    o += foot()
    write("whiteboard.html", o)

# ------------------------------------------------------------------ Discover
def discover():
    o = head("Discover & skills · Kinviva", "Real articles and projects from official engineering sources for the skills you choose.", "discover.html", "https://bhaktathapa.com.np/kinviva/media/v2-discover.jpg")
    o += page_head("Discover &amp; skills", "Keep growing the skills you care about.", "Real articles and open-source projects from official sources, ranked on your computer for the interests you pick.", [("discover", "Discover"), ("sources", "Sources")])
    o += f'    <section><div class="wrap">{NOTICE}</div></section>\n    <section id="discover" style="padding-top:20px"><div class="wrap">\n'
    o += spot("v2-discover.jpg", "Discover with interest chips and news items with pictures", "Discover", "Your interests, your feed.", "Choose from twelve topics or add any skill of your own, such as Rust, Terraform or Prompt engineering. Discover matches articles and GitHub projects for it.", ["<b>Pictures</b> from the articles and project logos, saved as small thumbnails on your computer", "<b>Ranked locally</b> by freshness, source quality and your interests", "<b>Explain, draw it, save to notes</b> or <b>add to a learning plan</b> on every item", "Mark read, save for later, and see trending topics counted from real posts"], False, "next")
    o += '''      </div></section>
    <section class="alt" id="sources"><div class="wrap">
      <div class="sec-head"><p class="eyebrow">Sources</p><h2>Real sources. Nothing invented.</h2><p class="lead">Discover is off until you turn it on, and it lists where it will look. Every item links to its source with the date the source gave. Trends are counts of what was fetched, not a guess.</p></div>
      <table class="table reveal"><thead><tr><th>Source</th><th>What it provides</th></tr></thead><tbody>
        <tr><td>Kubernetes Blog · CNCF</td><td>Project news and announcements</td></tr>
        <tr><td>AWS News Blog · Azure Blog</td><td>Cloud service announcements</td></tr>
        <tr><td>HashiCorp Blog · Docker Blog</td><td>Infrastructure and container tooling</td></tr>
        <tr><td>GitHub Blog · Cloudflare Blog</td><td>Engineering and platform posts</td></tr>
        <tr><td>GitHub search</td><td>Well-starred, recently updated projects for your interests</td></tr>
        <tr><td>Official certification and learning pages</td><td>Links to AWS, Microsoft, CNCF and HashiCorp pages. No dates or claims copied.</td></tr>
      </tbody></table>
    </div></section>
'''
    o += foot()
    write("discover.html", o)

# ------------------------------------------------------------------ Interview
STYLES = [
 ("simple", "Simple", "Short, clear, everyday words.", "I would give each team its own walled-off space with its own build workers and secrets. Then I would set limits and show each team its bill. It takes more setup, but it is safer and cheaper to run."),
 ("pro", "Professional", "Natural and confident.", "I would isolate each team in its own namespace and cloud account, with separate runners and secrets, so one team cannot affect another. I would add per-team quotas and cost reports to keep spending under control. The trade-off is more setup per team, which I accept for the security it buys."),
 ("tech", "Technical", "More engineering depth, still plain words.", "One namespace and one cloud account or subscription per team, with its own roles and short-lived credentials. Build runners are ephemeral and auto-scale, builds are signed, and a policy check gates every deploy. Quotas and a monthly cost report per team cap spend. I would verify isolation with a test that one team's runner cannot read another team's secrets."),
 ("star", "STAR", "For behavioral questions. Uses only your own notes.", "Situation: [from your notes] Task: [from your notes] Action: [from your notes] Result: [from your notes]. If your notes do not hold the facts, Kinviva does not invent any. It tells you what to fill in from your real experience."),
]
def interview():
    o = head("Interview · Kinviva", "Practise and answer interview questions in four styles. Automatic answers, mock practice and STAR responses that never invent your experience.", "interview.html", "https://bhaktathapa.com.np/kinviva/media/v2-interview.jpg")
    o += page_head("Interview", "Practise, and answer, like an expert.", "Interview has its own screen. Start it, and each question the interviewer asks is answered as it is asked, in the style you choose.")
    o += '    <section><div class="wrap">\n'
    o += spot("v2-interview.jpg", "Interview screen with answer controls on the left and Say it and Understand it cards on the right", "Interview", "The answer, and the reasoning behind it.", "Questions are detected from the other side's audio. Each answer has what to say, how to understand it, the trade-offs, hard words and a likely follow-up.", ["Press <b>Start interview</b> and stay on the Interview screen", "<b>Ask, Explain, Suggest reply and Recap</b> are at the bottom of the answers (new in " + NEXT + ")", "<b>Notes</b> download as Word, Markdown or text", "Use it for practice and preparation, and follow the rules of your interviewer or employer"], False, "now")
    o += f'''      </div></section>
    <section class="alt"><div class="wrap">
      <div class="sec-head"><p class="eyebrow">Answer styles</p><h2>One question, four ways to answer it.</h2><p class="lead">The sample question: “Design a multi-tenant CI/CD platform for internal teams. Focus on isolation, security and cost.”</p></div>
      <div data-tabs>
        <div class="tabs" role="tablist" aria-label="Answer style">
'''
    for i, (k, n, d, a) in enumerate(STYLES):
        o += f'          <button role="tab" id="tab-{k}" aria-selected="{"true" if i == 0 else "false"}" aria-controls="p-{k}"{"" if i == 0 else " tabindex=\"-1\""}>{n}</button>\n'
    o += "        </div>\n"
    for i, (k, n, d, a) in enumerate(STYLES):
        o += f'        <div id="p-{k}" class="panel card" role="tabpanel" aria-labelledby="tab-{k}"{"" if i == 0 else " hidden"}><p class="muted">{d}</p><h3>Say it</h3><p style="font-size:19px">{a}</p></div>\n'
    o += f'''      </div>
      <p class="muted" style="margin-top:14px">These are written examples to show the styles. Real answers are written live by the answer engine you connect, from your question, notes and documents.</p>
    </div></section>
    <section><div class="wrap">
      <div class="sec-head"><p class="eyebrow">Coaching skills</p><h2>Four areas, each with its own coach.</h2></div>
      <div class="grid g4">
        {card("code", "teal", "Cloud &amp; DevOps", "Rollouts, CI/CD, Kubernetes, observability, incidents, security and cost.")}
        {card("diagram", "blue", "System design", "Requirements, scale, data, trade-offs and failure modes.")}
        {card("star", "purple", "AI engineering", "RAG, evaluation, hallucinations, latency, cost and safety.")}
        {card("chat", "rose", "Coding", "Approach, complexity, code and tests in Python, Java or C++.")}
      </div>
      <div class="grid g3" style="margin-top:20px">
        {card("check", "green", "STAR without made-up facts", "For behavioral questions it uses only your own notes and documents. If they do not hold the facts, it asks you instead of inventing a job, date or result.")}
        {card("monitor", "amber", "Read my screen", "If the interviewer shows a coding problem or command, one shortcut explains it. The screenshot is sent only when you ask.")}
        {card("search", "blue", "Job description analysis", "Paste a job description and get skills, likely questions and what to prepare, compared with your own documents.", None, "next")}
      </div>
    </div></section>
{cta("Practise with it today.")}'''
    o += foot()
    write("interview.html", o)

# ------------------------------------------------------------------ Video
CH = [(0, "Meeting", "Live transcript and answers in simple words"), (5, "Interview", "Automatic answers to the interviewer's question"), (10, "Read my screen", "A command shown on screen, explained"), (15, "Overlay", "A see-through window beside your call")]

# ------------------------------------------------------------------ Privacy
SETUPS = [
 ("local", "Fully local", "Local speech engine and a local AI model.", [("Your voice", "Stays on your computer", "Processed by whisper.cpp on your computer."), ("Transcript text", "Stays on your computer", "Sent to the model running on your computer."), ("Screenshots", "Stays on your computer", "Sent only to your local model, and only if it accepts images."), ("Saved sessions", "Stays on your computer", "Stored in a local database.")]),
 ("cloud", "Cloud answer engine", "Local speech engine, cloud answers such as Gemini.", [("Your voice", "Stays on your computer", "Processed by whisper.cpp on your computer."), ("Transcript text", "Sent to a service you chose", "The newest lines are sent to your answer engine to be explained and answered."), ("Screenshots", "Sent to a service you chose", "Only when you press Read my screen, use its shortcut, or turn on its automatic mode."), ("Saved sessions", "Stays on your computer", "Stored in a local database.")]),
 ("both", "Cloud speech and answers", "Deepgram speech and a cloud answer engine.", [("Your voice", "Sent to a service you chose", "Streamed to Deepgram for transcription."), ("Transcript text", "Sent to a service you chose", "The newest lines are sent to your answer engine."), ("Screenshots", "Sent to a service you chose", "Only when you ask, as above."), ("Saved sessions", "Stays on your computer", "Stored in a local database.")]),
]
def privacy():
    o = head("Privacy · Kinviva", "Kinviva is local-first. See exactly what stays on your computer and what is sent in each setup, plus the new Discover and diagram features.", "privacy.html")
    o += page_head("Privacy", "Your meeting stays yours.", "Kinviva is local-first. Choose a setup to see exactly what stays on your computer and what is sent.")
    o += '    <section><div class="wrap"><div data-tabs>\n        <div class="tabs" role="tablist" aria-label="Setup">\n'
    for i, (k, n, d, rows) in enumerate(SETUPS):
        o += f'          <button role="tab" id="tab-{k}" aria-selected="{"true" if i == 0 else "false"}" aria-controls="p-{k}"{"" if i == 0 else " tabindex=\"-1\""}>{n}</button>\n'
    o += "        </div>\n"
    for i, (k, n, d, rows) in enumerate(SETUPS):
        o += f'        <div id="p-{k}" class="panel" role="tabpanel" aria-labelledby="tab-{k}"{"" if i == 0 else " hidden"}><p class="lead" style="margin-bottom:18px">{d}</p><table class="table"><thead><tr><th>Data</th><th>Where it goes</th><th>Details</th></tr></thead><tbody>'
        for a, b, c in rows:
            cls = "ok-t" if b.startswith("Stays") else "no-t"
            o += f'<tr><td><b>{a}</b></td><td class="{cls}">{b}</td><td>{c}</td></tr>'
        o += "</tbody></table></div>\n"
    o += f'''      </div></div></section>
    <section class="alt"><div class="wrap">
      <div class="sec-head"><p class="eyebrow">New workspace</p><h2>The new features, and what they send.</h2></div>
      <table class="table reveal"><thead><tr><th>Feature</th><th>What happens</th></tr></thead><tbody>
        <tr><td><b>Discover</b></td><td>Off until you turn it on. Then it downloads headlines from the listed official sources and searches GitHub for your interests (the search includes the topic names). Pictures are saved as small thumbnails on your computer, and no remote image is loaded while you browse.</td></tr>
        <tr><td><b>Whiteboard, charts, notes</b></td><td>Stored in your local database. Generating or editing sends only the text needed, to your answer engine.</td></tr>
        <tr><td><b>Technical Copilot</b></td><td>Never runs a command. Suggested commands are read-only and are only copied by you.</td></tr>
        <tr><td><b>Diagrams</b></td><td>Diagram source is checked and cleaned before it is drawn: no links, scripts or HTML.</td></tr>
        <tr><td><b>Early Access form</b></td><td>Only if you fill it in on this website: your name, email, use case, optional company and your consent are stored by the Early Access service so we can contact selected participants. Nothing from the app is sent. <a href="{GH}/blob/main/docs/PRIVACY.md">Full details and deletion</a>.</td></tr>
      </tbody></table>
    </div></section>
    <section><div class="wrap">
      <div class="sec-head"><p class="eyebrow">Principles</p><h2>What we never do.</h2></div>
      <div class="grid g4">
        {card("shield", "teal", "No telemetry, no account", "Nothing is collected about you or your meetings.")}
        {card("chat", "rose", "Never speaks for you", "Text is shown to you only. Nothing is typed or said into your call.")}
        {card("monitor", "blue", "Always visible", "Indicators show when audio is heard and where audio and text go.")}
        {card("lock", "purple", "Keys in the keychain", "Never in files, logs or exports.")}
      </div>
    </div></section>
    <section class="alt"><div class="wrap">
      <div class="sec-head center"><p class="eyebrow">Questions</p><h2>Straight answers.</h2></div>
      <div class="faq">
        <details><summary>Does Kinviva record my calls?</summary><p>Not unless you turn on "Save audio recordings" in Settings. By default it transcribes and saves text, not audio.</p></details>
        <details><summary>Where are my API keys stored?</summary><p>In your system keychain (macOS Keychain, Windows Credential Manager). They are never written to the database, settings files or logs.</p></details>
        <details><summary>Is there telemetry or an account?</summary><p>No. There is no account and no analytics. The app only contacts the speech and answer services you configure, and Discover if you turn it on.</p></details>
        <details><summary>Can others see Kinviva during screen sharing?</summary><p>You can ask your system to keep the app and overlay out of screen capture. This works with most tools but is not guaranteed, so check it before an important call.</p></details>
        <details><summary>What does Read my screen send?</summary><p>A shrunken screenshot of your main display, with the last few things said, to your answer engine. It runs only when you ask, or when you turn on its automatic mode. The image is deleted right after it is read.</p></details>
        <details><summary>Do I need to tell people I'm using it?</summary><p>Some places require everyone's consent to record or transcribe a conversation, and some interviewers or employers have rules about assistance. You are responsible for following them.</p></details>
      </div>
      <p class="muted" style="text-align:center;margin-top:24px">Security issue? See <a href="{GH}/blob/main/SECURITY.md">SECURITY.md</a>.</p>
    </div></section>
'''
    o += foot()
    write("privacy.html", o)

# ------------------------------------------------------------------ Download
def download():
    note = NOTICE.replace(" Each feature below says which one it belongs to.", " The Features pages say which one each feature belongs to.")
    o = head("Download · Kinviva", f"Download Kinviva {INSTALLER} for Mac or Windows. Free, no account. Build the full new workspace from source today.", "download.html")
    o += page_head("Download", "Get Kinviva.", f"Version {INSTALLER}. Free for Mac and, as an experiment, Windows. No account.")
    o += f'''    <section><div class="wrap">
      {note}
      <div style="height:28px"></div>
      <div data-tabs data-auto-os>
        <div class="tabs" role="tablist" aria-label="Operating system">
          <button role="tab" id="tab-mac" aria-selected="true" aria-controls="os-mac">Mac</button>
          <button role="tab" id="os-win" aria-selected="false" aria-controls="p-win" tabindex="-1">Windows <span class="badge b-exp">experimental</span></button>
        </div>
        <div id="os-mac" class="panel card os-card" role="tabpanel" aria-labelledby="tab-mac">
          <h3>Kinviva for Mac</h3><p class="muted">macOS 13 or later, Apple silicon</p>
          <p><a class="btn btn-primary btn-big" href="{DMG}" data-download>Download Kinviva.dmg</a></p>
          <p class="muted">Version {INSTALLER} · about 9.5 MB</p>
          <ol class="steps-ol">
            <li>Open the downloaded <code>.dmg</code> and drag <b>Kinviva</b> onto <b>Applications</b>.</li>
            <li>Open it. macOS says it can't verify the app because this early version isn't notarized by Apple yet. Click <b>Done</b>.</li>
            <li>Open <b>System Settings → Privacy &amp; Security</b>, scroll down and click <b>Open Anyway</b> next to Kinviva.</li>
            <li>Allow <b>Microphone</b> and <b>Screen &amp; System Audio Recording</b> when asked, then quit and reopen once.</li>
            <li>Add an answer engine key (for example Gemini) in <b>Settings → AI provider</b> (renamed Answer engine in {NEXT}), or set up <b>Ollama</b> and <b>whisper.cpp</b> for a fully local setup.</li>
          </ol>
        </div>
        <div id="p-win" class="panel card os-card" role="tabpanel" aria-labelledby="os-win" hidden>
          <h3>Kinviva for Windows <span class="badge b-exp">experimental</span></h3><p class="muted">Windows 10 or 11, 64-bit</p>
          <p><a class="btn btn-primary btn-big" href="{EXE}" data-download>Download for Windows</a></p>
          <p class="muted">Version {INSTALLER} · about 6 MB · built and unit-tested on a Windows server, not yet tried on a real laptop. Read my screen is Mac-only for now.</p>
          <ol class="steps-ol">
            <li>Run the installer. Windows shows “Windows protected your PC” because it isn't signed yet: click <b>More info → Run anyway</b>. It installs for your user only.</li>
            <li>Open Kinviva and allow <b>Microphone</b> access when Windows asks.</li>
            <li>System audio is captured from your default output device, so play the call through your normal speakers or headphones.</li>
            <li>Add a key in <b>Settings → AI provider</b>, or set up Ollama for Windows and whisper.cpp and set the paths in <b>Settings → Speech recognition</b>.</li>
          </ol>
        </div>
      </div>
    </div></section>
    <section class="alt"><div class="wrap">
      <div class="sec-head"><p class="eyebrow">Prefer to build it yourself?</p><h2>Build it from source.</h2><p class="lead">Everything on the Features pages is in the public source code. If you are comfortable with developer tools, you can build version {NEXT} yourself.</p></div>
      <div class="card reveal"><ol class="steps-ol">
        <li>Install <b>Node.js</b> and <b>Rust</b> (rustup).</li>
        <li><code>git clone {GH}.git</code> and open the folder.</li>
        <li><code>npm install</code></li>
        <li><code>npm run tauri build</code> builds the app for your computer. The README has the details, including the macOS permissions note.</li>
      </ol></div>
    </div></section>
    <section><div class="wrap">
      <div class="sec-head"><p class="eyebrow">Before you install</p><h2>What you need.</h2></div>
      <div class="grid g3">
        {card("chat", "blue", "An answer engine", "A key for a cloud model such as Gemini, or a local model through Ollama. A model that can read images is needed for Read my screen.")}
        {card("mic", "rose", "Speech recognition", "The built-in whisper.cpp engine on Mac, or Deepgram if you prefer the cloud.")}
        {card("shield", "teal", "Permissions", "Microphone and, on Mac, Screen &amp; System Audio Recording. Kinviva never changes your system permissions for you.")}
      </div>
      <div class="card reveal" style="margin-top:20px"><h3>Verify your download</h3><p>Every release lists SHA-256 checksums. On a Mac, run this in Terminal and compare the result with the release notes:</p><p><code>shasum -a 256 ~/Downloads/Kinviva.dmg</code></p><p><a href="{REL}">Release notes and checksums</a> · <a href="{REL}">All releases</a> · <a href="{GH}">Source code</a></p></div>
    </div></section>
    <div class="toast" id="started" role="status" hidden><b>Your download has started.</b><span>Open it from your Downloads and follow the steps on this page.</span><button type="button" aria-label="Close">×</button></div>
'''
    o += foot()
    write("download.html", o)

# ------------------------------------------------------------------ Editions, Community, Early Access, Documentation
def editions_band():
    return f"""    <section class="alt"><div class="wrap">
      <div class="sec-head"><p class="eyebrow">Editions</p><h2>Free today. More to come.</h2><p class="lead">The Community Edition is the whole app you can download now. Pro and Business are planned and are not available yet.</p></div>
      <div class="grid g3">
        {card("check", "green", "Community", "Local transcription, bring your own answer engine, explanations and history, interview and classroom help, technical troubleshooting and diagrams, Notes, Whiteboard. Free, no account.", "community.html", None, "About Community")}
        {card("code", "purple", "Pro (planned)", "Advanced technical investigations, richer diagrams and reports, enhanced interview and learning workflows, an optional managed AI service. Not built yet.", "early-access.html", None, "Join Early Access")}
        {card("board", "blue", "Business (planned)", "Organization accounts, central administration, shared workflows, usage management and security policies. Not built yet.", "early-access.html", None, "Join Early Access")}
      </div>
    </div></section>
"""

def community():
    o = head("Community Edition · Kinviva", "The free Kinviva Community Edition: local transcription, your own AI, explanations, history, interview and classroom help, and basic technical tools.", "community.html")
    o += page_head("Community", "The Community Edition.", "Everything you can download today. Free to use, local-first, with no account. Nothing in it is a trial.")
    o += f"""    <section><div class="wrap">
      <div class="grid g3">
        {card("mic", "blue", "Local transcription", "A built-in speech engine on your computer. Or add Deepgram with your own key.")}
        {card("chat", "purple", "Your own AI", "Connect a local model or any OpenAI-compatible service with your own key. Your keys stay in the system keychain.")}
        {card("note", "teal", "Explanations and history", "Plain-English explanations, replies, recaps, decisions, saved sessions, a Trash, and exports to Word, Markdown and text.")}
        {card("chat", "rose", "Interview and classroom", "Practise and answer interview questions; lecture notes, study guides, flashcards and quizzes.")}
        {card("code", "teal", "Technical basics", "Safe read-only troubleshooting plans, an incident tracker, and architecture diagrams from the conversation.")}
        {card("board", "amber", "Notes, whiteboard, visuals", "Rich notes with folders and tags, an editable whiteboard, charts from your own numbers, and a presentation maker.")}
      </div>
    </div></section>
    <section class="alt"><div class="wrap">
      <div class="sec-head"><p class="eyebrow">Our promise</p><h2>What stays free.</h2></div>
      <table class="table reveal"><tbody>
        <tr><td><b>Everything above</b></td><td>It stays in the Community Edition. Paid editions will add new things; they will not take these away.</td></tr>
        <tr><td><b>Your data</b></td><td>Reading, exporting and deleting your own data is never paid.</td></tr>
        <tr><td><b>Privacy</b></td><td>No telemetry and no Kinviva account in the Community Edition. <a href="privacy.html">See exactly what is sent in each setup.</a></td></tr>
      </tbody></table>
    </div></section>
    <section><div class="wrap">
      <div class="sec-head"><p class="eyebrow">Source and licence</p><h2>The code is public. The licence is being decided.</h2><p class="lead">The source is on GitHub for you to read. It is currently published under an all-rights-reserved licence, so it is <b>not yet open source</b>. We are choosing an open-source licence for the Community code. We will announce it here when it is decided.</p></div>
      <div class="grid g3">
        {card("book", "blue", "Read the code", "Browse the source, the architecture notes and the third-party notices.", GH, None, "Open GitHub")}
        {card("check", "green", "Report an issue", "Bug reports and ideas are welcome. Please never paste keys or private meeting content.", GH + "/issues", None, "Open issues")}
        {card("shield", "teal", "Security", "Report a vulnerability privately. We reply within 7 days.", GH + "/security/policy", None, "Security policy")}
      </div>
      <p class="muted" style="margin-top:20px">Contributing: see <a href="{GH}/blob/main/CONTRIBUTING.md">CONTRIBUTING.md</a>. Outside pull requests can be reviewed now; merging starts once contributor terms are in place.</p>
    </div></section>
{cta()}"""
    o += foot()
    write("community.html", o)

USE_CASES = [("meetings", "Meetings"), ("interviews", "Interviews"), ("learning", "Learning and classes"), ("technical", "Technical work (engineering, operations)"), ("team", "My team or company"), ("other", "Something else")]

def early_access():
    ep = esc(EA_ENDPOINT)
    opts = "".join(f'<option value="{k}">{v}</option>' for k, v in USE_CASES)
    open_ = bool(EA_ENDPOINT)
    notice = "" if open_ else '<p class="notice-line" role="status"><b>Registrations are temporarily unavailable.</b> The form will start accepting sign-ups once the Early Access service is switched on. Nothing you type here is sent anywhere until then. Please check back soon.</p>'
    o = head("Pro Early Access · Kinviva", "Join Early Access for advanced AI workflows, technical copilots, and productivity features in future Kinviva editions.", "early-access.html")
    o += page_head("Pro Early Access", "Discover what's next with Kinviva.", esc(EA_MESSAGE))
    o += f"""    <section><div class="wrap ea-wrap">
      <div class="ea-form card">
        <h2>Join Early Access</h2>
        {notice}
        <form id="ea-form" data-endpoint="{ep}" novalidate>
          <label>Your name<input name="name" type="text" autocomplete="name" maxlength="100" required></label>
          <label>Email<input name="email" type="email" autocomplete="email" maxlength="254" required></label>
          <label>What would you use Kinviva for?<select name="use_case" required><option value="">Choose one</option>{opts}</select></label>
          <label>Company (optional)<input name="company" type="text" autocomplete="organization" maxlength="100"></label>
          <label class="ea-hp" aria-hidden="true">Leave this empty<input name="website" type="text" tabindex="-1" autocomplete="off"></label>
          <label class="ea-consent"><input name="consent" type="checkbox" required> <span>I agree that Kinviva stores my name, email and answers so it can contact me about Early Access. I can ask for deletion at any time. <a href="{GH}/blob/main/docs/PRIVACY.md">How my data is used</a>.</span></label>
          <button class="btn btn-primary btn-big" type="submit"{"" if open_ else " disabled"}>Join Early Access</button>
          <p id="ea-status" class="ea-status" role="status" aria-live="polite"></p>
        </form>
        <noscript><p>This form needs JavaScript.</p></noscript>
      </div>
      <aside class="ea-side">
        <h2>What is planned</h2>
        <p class="muted">These are planned for future editions. <b>None of them is available yet</b>, and joining does not buy or reserve anything.</p>
        <ul class="ea-list">
          <li><b>Pro:</b> agent-driven technical investigations, advanced diagrams and reports, enhanced interview and learning workflows, an optional managed AI service.</li>
          <li><b>Business:</b> organization accounts, central administration, shared workflows, usage management and security policies.</li>
        </ul>
        <h2>What stays free</h2>
        <p class="muted">Everything in the <a href="community.html">Community Edition</a>.</p>
        <h2>Your data</h2>
        <p class="muted">We collect your name, email, use case and optional company, the time you agreed, and nothing else. We use it only to contact selected participants. See the <a href="privacy.html">privacy page</a>.</p>
      </aside>
    </div></section>
"""
    o += foot()
    write("early-access.html", o)

def docs_page():
    B = GH + "/blob/main/"
    items = [
        ("Get started", [("README: install, set up and build", B + "README.md"), ("Download Kinviva", "download.html"), ("What you need before you install", "download.html")]),
        ("Using Kinviva", [("Features", "features.html"), ("Answers: how they are made and checked", B + "docs/ANSWERS.md"), ("Interview mode", B + "docs/INTERVIEW.md"), ("Sessions and courses", B + "docs/SESSIONS.md")]),
        ("Privacy and security", [("What is sent in each setup", "privacy.html"), ("Privacy and consent (full text)", B + "docs/PRIVACY.md"), ("Security policy", B + "SECURITY.md")]),
        ("For developers", [("Architecture", B + "docs/ARCHITECTURE.md"), ("Feature audit", B + "docs/FEATURE_AUDIT.md"), ("Open-core plan", B + "docs/OPEN_CORE_PLAN.md"), ("Contributing", B + "CONTRIBUTING.md"), ("Third-party notices", B + "THIRD_PARTY_NOTICES.md")]),
        ("Releases", [("Release notes and downloads", REL), ("Release readiness checklist", B + "docs/RELEASE_READINESS.md")]),
    ]
    o = head("Documentation · Kinviva", "Guides, architecture and policies for Kinviva.", "docs.html")
    o += page_head("Documentation", "Guides and references.", "Everything is written down in the open. Most documents live in the GitHub repository.")
    o += '    <section><div class="wrap"><div class="grid g3">\n'
    for title, links in items:
        li = "".join(f'<li><a href="{h}">{esc(l)}</a></li>' for l, h in links)
        o += f'      <article class="card reveal"><h3>{title}</h3><ul class="doc-list">{li}</ul></article>\n'
    o += "    </div></div></section>\n"
    o += foot()
    write("docs.html", o)

if __name__ == "__main__":
    PAGES = (home, features, technical, whiteboard, discover, interview, privacy, download, community, early_access, docs_page)
    for f in PAGES:
        f()
    print("Wrote 11 pages to", SITE)
    if MOVED:  # only when building for the new address
        urls = "".join(f"  <url><loc>{BASE}{'' if f.__name__ == 'home' else {'docs_page': 'docs', 'early_access': 'early-access'}.get(f.__name__, f.__name__) + '.html'}</loc></url>\n" for f in PAGES)
        (SITE / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls + "</urlset>\n")
        (SITE / "robots.txt").write_text(f"User-agent: *\nAllow: /\nSitemap: {BASE}sitemap.xml\n")
