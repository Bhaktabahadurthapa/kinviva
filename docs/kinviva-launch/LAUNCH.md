# Kinviva launch checklist

Stage 1 (this branch, `kinviva-launch`, not pushed): the website, README and workflows already use the new repo address
(`Bhaktabahadurthapa/kinviva`), the new site path (`bhaktathapa.com.np/kinviva/`) and the new installer names
(`MeetingLens.dmg`, `MeetingLens-Windows-Setup.exe` until the 0.1.5 release (then switch to `Kinviva.dmg`, `Kinviva-Windows-Setup.exe`)). Screenshots are retaken with the Kinviva wordmark. My Learning is removed from the site.

Do NOT push this branch to `main` before steps 2 and 3, or the live download links and repo links will point to things that do not exist yet.

## 2. Rename the repository (owner action or approved by the owner)
1. GitHub, repository Settings, Repository name: `kinviva`. GitHub redirects the old address.
2. Locally: `git remote set-url origin https://github.com/Bhaktabahadurthapa/kinviva.git`
3. Check Settings, Pages: the custom domain and source stay as they were; the path becomes `/kinviva/`.

## 3. Publish the site at the new path
1. Merge `kinviva-launch` into `main` and push. The Pages workflow publishes the site at `/kinviva/`.
2. In the repo that serves `bhaktathapa.com.np` (your root site), add `meetinglens/index.html` from
   `docs/kinviva-launch/old-site-redirect/index.html` so the old address shows "We are now Kinviva" and forwards.

## 4. Release 0.1.5 as Kinviva
Build `Kinviva.dmg` and the Windows installer (`scripts/build-mac-app.sh`, the Windows workflow), publish the release with those exact names,
then the site download buttons work. Until then the live downloads are v0.1.4 named MeetingLens.

## 5. Later: internal app ID
The bundle id and keychain service are still `app.kinviva.desktop`, and the data file is `meetinglens.sqlite`.
Change them only together with a first-launch migration (copy the data folder, re-save the API keys) and tell users to grant
microphone and screen recording again.
