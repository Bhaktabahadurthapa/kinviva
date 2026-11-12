# Web providers (Firecrawl, Apify) and research sources

All of this is optional and off by default. Kinviva works fully without any of it. Settings → Answer engine and Settings → Web providers.

## What each part does
| Part | Used for | Needs | When it runs |
|---|---|---|---|
| OpenAlex | Peer-reviewed papers for an answer | Nothing | Only when "Back answers with research papers and web sources" is on and you ask for a reply or question |
| Tavily or Firecrawl search | Current web pages for an answer | Your own key | Same as above; you pick one |
| Firecrawl scrape | Read the page of a job listing that came without a description (at most 5 per search) | Your Firecrawl key | Only during a job search that used Apify |
| Apify | Collect job listings with an actor you choose | Your Apify token and the actor name | Only when you tick "Also collect listings with my Apify actor" and press Search |

Firecrawl and Apify are not both called for every request. Keys go to the OS credential store (never settings, logs or the database). Calls stop at the daily limit (default 20) set in Settings; the count is kept in `webintel-usage.json` in the app data folder. A paid provider may bill your account; Kinviva cannot see or change your bill.

## Trust and safety
- Everything a provider returns is untrusted data. It is added to the prompt in a block marked as untrusted, and instructions inside it are never followed.
- Only https links are kept. A listing without a title and a link is dropped; nothing is invented.
- Errors never include the key or the full request address. Calls time out and can be cancelled.
- Web research is not proof about your live systems. In Technical Copilot answers it is a cited reference, separate from what was said in the meeting or verified in your own documents.
- No meeting audio or transcript is sent to these providers. Only the question text and (for Apify) your search words and location.

## Not built
Automatic submission to job sites. Provider-side cost caps beyond the local daily limit. Controlled multi-page crawling.
