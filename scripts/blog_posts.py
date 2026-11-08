"""Blog posts for the Kinviva website. Each post is plain data: the generator wraps it in the site layout.

Rules for every post (see docs/WEBSITE_DESIGN.md): describe only what is in the shipped app (version 0.1.5, see docs/FEATURE_AUDIT.md),
label anything planned or partly tested, make no speed, accuracy or security claims, and name no individual.
"""

DATE = "8 November 2026"
ISO = "2026-11-08"

POSTS = [
    {
        "slug": "what-is-kinviva",
        "tag": "Start here",
        "title": "What is Kinviva, and who is it for?",
        "summary": "A free desktop app that explains conversations while they happen, on your own computer. Here is the short version, in plain words.",
        "minutes": 4,
        "image": "v2-meeting-dark-panel.jpg",
        "image_alt": "The Kinviva Meetings screen with a live transcript on the left and plain-English explanations on the right, shown with sample data",
        "short": [
            "Kinviva listens to a meeting, call, interview or lecture on your computer.",
            "It explains each point in plain words and helps you prepare a reply.",
            "It is free for Mac and Windows, needs no account, and has no Kinviva server.",
        ],
        "body": """
<p>Most meeting tools tell you what <em>was</em> said. Kinviva is built to help while it is <em>being</em> said. You press Start, and it writes a live transcript of the call and of your own voice. As each point finishes, it explains it in simple words and, when someone asks a question, drafts an answer you can edit.</p>

<h2>The problem it is built for</h2>
<p>Conversations move faster than people can follow. A manager meets a term they do not know. A student loses the thread of a lecture. A candidate is asked something in an interview and needs a moment to think. A team lead leaves a call and cannot remember who agreed to what. Kinviva tries to help in each of these moments.</p>

<h2>What it does today</h2>
<ul>
  <li><b>Live transcript.</b> Two sources are kept apart: <em>Them</em> (the audio your computer plays) and <em>Me</em> (your microphone).</li>
  <li><b>Plain-English explanations.</b> Each finished point is explained, with hard words listed.</li>
  <li><b>Suggested replies.</b> A short draft grounded in what was said and in your own notes and documents. It is shown to you only. Nothing is typed into the call.</li>
  <li><b>Recaps, decisions and action items.</b> Decisions and actions come with the quote that proves them.</li>
  <li><b>Saved history.</b> Sessions are saved on your computer, searchable, and can be exported to Word, Markdown or text.</li>
  <li><b>Technical Copilot, interview practice, classroom tools and a presentation maker</b> for specific situations. Later posts explain each.</li>
</ul>

<h2>Who it is for</h2>
<p>Anyone who has to follow fast conversations and answer well: people at work, engineers in technical calls, job candidates, and students. It is not built for large teams yet. There are no shared workspaces and no integrations with tools such as Slack or a CRM.</p>

<h2>What you need</h2>
<p>A Mac with Apple silicon (macOS 13 or later), or a Windows 10 or 11 PC. The Windows version is experimental and has not been tested on real hardware by us. You also need an <em>answer engine</em>: either your own key for a cloud AI service, or a free local model. The first time you start, your computer asks for microphone and system-audio permission.</p>

<h2>What it does not do</h2>
<ul>
  <li>It does not join your call as a bot, and it does not start by itself. You press Start.</li>
  <li>Its answers come from the AI you connect and can be wrong. You decide what to say.</li>
  <li>It is built for English today.</li>
  <li>Pro and Business editions, including AI agents that complete tasks, are planned. They are not available.</li>
</ul>
""",
    },
    {
        "slug": "live-explanations",
        "tag": "How it works",
        "title": "How Kinviva explains a conversation while it happens",
        "summary": "From a live transcript to a plain-words note and a reply you can edit: what appears on screen, and what you control.",
        "minutes": 5,
        "image": "v2-meeting-panel.jpg",
        "image_alt": "The Kinviva Meetings screen in light mode showing a transcript, an explanation and a suggested reply, shown with sample data",
        "short": [
            "A live transcript on one side, plain-English insights on the other.",
            "Auto-assist works hands-free; you can switch it to Explain only or Off.",
            "Replies are drafts for you. Nothing is sent into the call.",
        ],
        "body": """
<p>The Meetings screen is split in two. On the left is the <b>live transcript</b>. On the right are the <b>live insights</b>. This post walks through what happens between them.</p>

<h2>1. Capture</h2>
<p>When you press Start, Kinviva listens to two things: the sound your computer plays (<em>Them</em>) and your microphone (<em>Me</em>). Each has its own status and level meter, so you can see at a glance that both are working. Speech recognition runs on your computer with the built-in engine, or with Deepgram if you add your own key.</p>

<h2>2. Explain</h2>
<p>When someone else finishes a sentence, Kinviva writes what it means below, in large, plain language. It keeps the speaker's meaning, lists hard words, and says so when the transcript left something unclear. You choose the level (Simple, Professional or Student) and the length (Short, Normal or Detailed).</p>

<h2>3. Answer</h2>
<p>When someone asks a question, Kinviva detects it and drafts an answer in a box labelled <em>You could say</em>, with a one-line key takeaway and its sources. The draft uses what was said, your notes and the passages of your own documents that match. If you ask it about your own past work and your notes do not say, it does not guess. It frames how to answer and asks one question.</p>

<h2>4. Ask, recap, decide</h2>
<p>You can also press a button at any time: <b>Explain</b> the latest point, <b>Suggest reply</b>, <b>Recap</b> so far, <b>Decisions</b> for confirmed decisions and action items, or type a question in the Ask bar. Answers to Ask come from what was said in the meeting.</p>

<h2>What you control</h2>
<ul>
  <li><b>Auto-assist</b> is on by default and works hands-free. Switch to <em>Explain only</em> or <em>Off</em> and the AI runs only when you press a button.</li>
  <li><b>Nothing is sent into the call.</b> Everything on screen is for you.</li>
  <li><b>Sources are checked by the app.</b> After an answer arrives, Kinviva rebuilds the source list itself and removes any file name or page the model typed that was not really used.</li>
</ul>

<div class="post-note"><b>Limits.</b> Answer quality depends on the AI you connect, and we have not measured it against a live model. Citations show where a passage came from; they do not prove the model used it correctly.</div>
""",
    },
    {
        "slug": "what-stays-on-your-computer",
        "tag": "Privacy",
        "title": "What stays on your computer, and what does not",
        "summary": "Kinviva has no server, no account and no tracking. Here is exactly what leaves your computer, and only when you set it up that way.",
        "minutes": 5,
        "image": None,
        "short": [
            "Transcripts, notes and keys stay on your computer.",
            "Text goes to an answer engine only if you pick a cloud one.",
            "A local model plus local speech recognition means nothing leaves.",
        ],
        "body": """
<p>Privacy is easy to claim and hard to check, so this post lists the facts. It is written from the app's own code and from <a href="https://github.com/Bhaktabahadurthapa/kinviva/blob/main/docs/PRIVACY.md">the privacy document</a> in the repository.</p>

<h2>Always local</h2>
<ul>
  <li>Sessions, transcripts, notes, boards, charts, documents and settings live in a local database on your computer.</li>
  <li>API keys are kept in the operating system's credential store (macOS Keychain or Windows Credential Manager), never in files, logs or exports.</li>
  <li>Audio is saved only if you turn on "Save audio recordings". The built-in speech engine transcribes on your computer.</li>
  <li>Kinviva has no accounts, no analytics, no telemetry and no crash reporting, and it does not contact any Kinviva server.</li>
</ul>

<h2>Leaves your computer only if you choose it</h2>
<table class="table post-table">
  <thead><tr><th>What</th><th>Goes to</th><th>When</th></tr></thead>
  <tbody>
    <tr><td>Text of what was said, your notes, and matching document passages</td><td>The answer engine you chose: a local one, or a cloud provider with your key</td><td>Whenever an answer is requested (after each thing the other side says, if Auto-assist is on)</td></tr>
    <tr><td>A screenshot of your main display</td><td>The same answer engine</td><td>When you press "Read my screen"</td></tr>
    <tr><td>Audio</td><td>Deepgram</td><td>Only if you select it and add your key</td></tr>
    <tr><td>A search query</td><td>The web search provider you add a key for</td><td>Only for answers you request, if you enabled web search</td></tr>
    <tr><td>Requests for public feeds and GitHub search</td><td>Public sources</td><td>Only if you turn on Discover</td></tr>
  </tbody>
</table>

<h2>The simplest fully private setup</h2>
<p>Choose the built-in speech engine and a local model (for example through Ollama). In that setup, the transcript, the notes and the AI processing all stay on your computer. We have not tested every combination of local model and hardware, so quality varies with the model you choose.</p>

<h2>If you pick a cloud answer engine</h2>
<p>Whatever that provider receives is covered by its own terms. Kinviva states in Settings which endpoint is in use. This is the same trade-off you accept with any cloud AI service: better answers from a larger model, in exchange for sending text to its owner.</p>

<h2>Your controls</h2>
<p>Delete any session (Trash first, then delete permanently, optionally with linked notes). Turn off Discover, web search, automatic help and audio saving. Remove keys in Settings. Export your data to Word, Markdown, text, CSV or PowerPoint. Or delete the app's data folder to remove everything.</p>

<div class="post-note"><b>Recording and consent.</b> Kinviva hears the audio your computer plays. Follow the rules of your school, employer and local law on recording, and tell people where required.</div>

<div class="post-note"><b>This website and Discord.</b> This website has no analytics. The Kinviva Discord is a separate, third-party service with its own privacy policy.</div>
""",
    },
    {
        "slug": "technical-copilot",
        "tag": "Features",
        "title": "Technical Copilot: troubleshooting without surprises",
        "summary": "How Kinviva helps in an engineering conversation: plain-English explanations, read-only plans, and diagrams that say how sure they are.",
        "minutes": 5,
        "image": "v2-troubleshoot-panel.jpg",
        "image_alt": "The Technical Copilot troubleshooting screen with possible causes, evidence to collect and read-only commands, shown with sample data",
        "short": [
            "Causes are hypotheses. Commands are read-only and copied, never run.",
            "Diagram boxes are labelled verified, mentioned or inferred.",
            "Available now, and still early: it has been tried but not measured.",
        ],
        "body": """
<p>Engineering talk is full of terms that sound alike and mean different things. Technical Copilot is for the moments when someone says, "our pods keep restarting after deployment," and you need to follow the problem, ask a good question or write it up.</p>

<h2>Explain</h2>
<p>Paste a term or the latest point and get it in simple words first, then more depth. This works for cloud, DevOps, system design and AI engineering topics.</p>

<h2>Plan a safe investigation</h2>
<p>Describe a problem and Kinviva builds a plan with four parts:</p>
<ul>
  <li><b>Possible causes</b>, each marked as a hypothesis, not a fact.</li>
  <li><b>Evidence to collect</b> before you conclude anything.</li>
  <li><b>Read-only commands</b> you can copy, such as <code>kubectl describe pod</code> or <code>kubectl logs --previous</code>.</li>
  <li><b>Questions to ask</b> the team.</li>
</ul>
<p>Kinviva <b>never runs a command</b>. You copy it, read it and run it yourself.</p>

<h2>Track the incident</h2>
<p>The incident tracker keeps symptoms, hypotheses, evidence, actions and decisions together. It does not let you mark a root cause without supporting evidence.</p>

<h2>Draw the architecture</h2>
<p>Kinviva can turn a conversation about AWS, Kubernetes, CI/CD, databases or an incident into a diagram you can zoom, edit as Mermaid text, and export as SVG or PNG. Every box and line carries one of three labels:</p>
<ul>
  <li><b>Verified:</b> a document you selected mentions it.</li>
  <li><b>Mentioned:</b> someone said it, in those words.</li>
  <li><b>Inferred:</b> Kinviva suggests it. It is drawn dashed and never called a fact.</li>
</ul>
<p>The labels are decided by code, not by the AI, so a guess is never shown as a fact.</p>

<div class="post-note"><b>Honest status.</b> Technical Copilot is in the current installer and has been tried by us, but its answer quality is not measured. Treat its output as a starting point and check important facts.</div>
""",
    },
    {
        "slug": "learn-from-a-video",
        "tag": "Features",
        "title": "Learning from a long video with Video Assist",
        "summary": "Watching a full lecture and a concept does not click? Play it inside Kinviva, with live explanations beside it.",
        "minutes": 4,
        "image": None,
        "short": [
            "The video plays on one side; explanations appear on the other.",
            "Pause and ask for another example, then keep notes and a quiz.",
            "Early: tried with YouTube, and it depends on the site allowing playback.",
        ],
        "body": """
<p>Lectures, tutorials and conference talks are long, and the hard part is rarely the first minute. Video Assist is for the moment a concept stops making sense and you would like an explainer beside you.</p>

<h2>How it works</h2>
<ol>
  <li><b>Open the video.</b> In the Video Assist layout, paste a link (for example a YouTube address). The video plays inside Kinviva, with Previous, Next and full screen.</li>
  <li><b>Kinviva listens.</b> It hears the video's sound on your computer, like any other sound, and writes the transcript there.</li>
  <li><b>Explanations appear beside it.</b> Each point is explained in simple words. You can pause, press Explain, ask a question, or ask for another example.</li>
  <li><b>Keep what you learned.</b> Save notes, build a study guide or a short quiz, and search them later.</li>
</ol>

<h2>An example</h2>
<p>The lecturer says: <em>"So we update the weights in the direction that reduces the loss."</em> Beside it you read: <em>The model nudges its settings a little at a time, always toward fewer mistakes.</em> You ask for an everyday example and get one. That is an invented illustration, not a recording.</p>

<h2>Study help, not finished coursework</h2>
<p>The classroom tools make notes, study guides, flashcards, practice quizzes and homework hints from the lecture and your own course files. They remind you that this is study help. Homework or exam dates are listed only if the teacher actually said them.</p>

<div class="post-note"><b>Honest limits.</b> Video Assist is partly tested: we tried it with YouTube. It depends on the video site allowing playback inside the app, and on clear audio. Explanations can be wrong, so check important facts. Kinviva does not download or redistribute videos.</div>
""",
    },
    {
        "slug": "interview-practice",
        "tag": "Features",
        "title": "Interview mode: practise and answer without inventing your experience",
        "summary": "See each question beside a draft answer in your own style, practise first, and keep notes. Kinviva never makes up what you have done.",
        "minutes": 4,
        "image": "v2-interview-panel.jpg",
        "image_alt": "The Kinviva Interview screen with the interviewer's question in a banner, practice modes and answer style choices, shown with sample data",
        "short": [
            "Each question appears in a banner beside your answer.",
            "Practise first or run a mock interview and get feedback.",
            "It never invents your experience. Everything is a draft for you.",
        ],
        "body": """
<p>Interviews are a conversation with a time limit. Interview mode gives you a place to see the question, think, and shape an answer in your own words.</p>

<h2>During an interview</h2>
<p>Press Start and each question the interviewer asks appears in a banner at the top, beside your answer area. Choose your role and category, and an answer style: Simple, Professional or Student. Kinviva drafts a spoken answer plus the reasoning behind it, which you can edit.</p>

<h2>Practise first</h2>
<ul>
  <li><b>Mock practice:</b> get a question for your role, write your answer, then get feedback on correctness, missing points and clarity.</li>
  <li><b>Job description analysis:</b> paste a job description to see the skills they want, likely questions and what to prepare, compared with your own documents.</li>
  <li><b>Practice notes:</b> download questions, your answers and the feedback as Markdown, Word or text.</li>
</ul>

<h2>What it will not do</h2>
<p>If a question is about your own past work and your notes and documents do not say, Kinviva does not guess. It shows how to frame the answer and asks one clarifying question. It never presents an invented qualification as yours, and nothing is typed into the interview for you.</p>

<h2>Skills behind the answers</h2>
<p>Four bundled coaching skills guide technical answers: cloud and DevOps, system design, AI engineering and coding. They were written for Kinviva and tell the AI what a good answer needs.</p>

<div class="post-note"><b>Be honest with employers.</b> Use Kinviva within the rules of the interview and local law. Some employers do not allow assistance during an interview. Practice mode is always safe to use.</div>
""",
    },
]
