# Morning job search, approval and sending

How it works end to end, what you must set up, and what it will not do.

```
7:00 AM search -> Today list -> you Approve -> resume + letter prepared -> you review -> you press Approve and send -> sent by email -> tracker updated
```

## Set up (once)
1. **Resume and search choices.** Jobs & Resume → My resume (paste or open a file). Jobs & Resume → Find jobs: pick job types, location, keywords. The morning search reuses these choices.
2. **Morning search.** Settings → Job applications: turn on "Search for new jobs every morning" and pick the time.
3. **Keep Kinviva running.** The search runs only while Kinviva is open. Add Kinviva to the Mac's Login Items (System Settings → General → Login Items) so it starts when you sign in. If the Mac was asleep or Kinviva was closed at that time, the search runs as soon as Kinviva is running again that day. If it can't run, nothing happens and nothing is sent.
4. **Email (only if you want email sending).** In the same Settings section: your name, email address, mail server, port, user name and password. Gmail and some others need an **app password** instead of your normal password. The password goes to the operating system's credential store. Press "Send a test message to myself" to check it.

## The morning
- At the chosen time Kinviva searches the public job feeds with your saved choices (and Apify if you turned it on), keeps the jobs you haven't seen before, and shows a macOS notification such as "12 new jobs matched your search".
- Open Jobs & Resume → **Today**. Jobs are ranked by match estimate, each with the full description and the skills your resume lacks.
- **Approve: prepare my resume** tailors your resume to that posting (using only what your resume already says) and writes a cover letter. Nothing is sent. The pack waits in the Tracker under "Preparing".
- **Skip** hides a job. **Open posting** opens it in your browser.

## Review and send
Tracker → a "Preparing" card → **Review and send**.
- You see the recipient, subject and message, and a warning if the resume or message mentions a skill or number your own resume does not.
- The recipient is filled in only if the posting names an email address. Otherwise use **Save files for a form** (saves the resume and letter as Word files in a folder) and upload them on the employer's page, then press **I applied myself**.
- **Approve and send** starts a 10 second countdown you can cancel. Then the message goes out through your own mail account with the resume attached.
- Daily cap (default 10, Settings). The same application is never sent twice. Every send is logged on this computer.

## What it will not do
- It does not apply on LinkedIn, Indeed or any employer's online form, and it does not get around captchas or logins.
- It does not send anything unless you press Approve and send for that application.
- It does not search or send when Kinviva is closed or the Mac is off.

## Where the data lives
The resume, tracker, preferences, today's digest, skipped jobs and the send log are in Kinviva's local database (not only in the window's browser storage). A copy of the older browser-storage data is imported once and left in place. Mail passwords, Firecrawl and Apify keys are in the credential store.

## Not tested with real services
The job feeds, the answer engine, Apify, Firecrawl and a real mail server have not been exercised from this build. Unit tests cover sending against a local test mail server, the daily cap, the duplicate rule, header safety, the morning schedule rules and storage. Try one send to yourself first.
