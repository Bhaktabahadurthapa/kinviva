# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Report them
privately through GitHub's
[private vulnerability reporting](https://github.com/Bhaktabahadurthapa/kinviva/security/advisories/new)
for this repository. Include steps to reproduce, the affected version or
commit, and the impact you expect.

You can expect an acknowledgement within 7 days. Please allow time for a fix
before any public disclosure.

## Scope

Of particular interest:

- Exposure of API keys (credential store handling, logs, IPC to the web view)
- Meeting audio or text reaching a destination the user did not choose
- Local data at rest (`~/Library/Application Support/app.kinviva.desktop/`)
- Tauri capability or content-security-policy bypasses

## Supported versions

Only the latest commit on `main` is supported while the project is pre-1.0.
