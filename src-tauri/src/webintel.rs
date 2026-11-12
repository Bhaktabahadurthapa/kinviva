//! Web intelligence providers: Firecrawl (clean page content and search) and Apify (structured
//! collection by an actor the user picks). Both are optional, off by default, use the user's own
//! key from the credential store, run only when the user turns the feature on and presses a button,
//! and stop at a daily call limit the user sets. Everything they return is untrusted data.
//!
//! Local features and the answer engine work without any of this configured.

use crate::jobs::Job;
use crate::websearch::WebSource;
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::Path;
use std::time::Duration;
use tokio_util::sync::CancellationToken;

pub const FIRECRAWL_BASE: &str = "https://api.firecrawl.dev/v1";
pub const APIFY_BASE: &str = "https://api.apify.com/v2";
const SNIPPET_CHARS: usize = 600;
const PAGE_CHARS: usize = 8000;
const MAX_ITEMS: usize = 40;

fn clip(s: &str, n: usize) -> String {
    let s = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if s.chars().count() <= n { s } else { format!("{}…", s.chars().take(n).collect::<String>().trim_end()) }
}

fn https_only(u: &str) -> Option<String> {
    let p = url::Url::parse(u.trim()).ok()?;
    (p.scheme() == "https" && p.host_str().is_some_and(|h| h.contains('.'))).then(|| p.to_string())
}

// ---- Daily call limit (kept in a small file, so it survives restarts) ----

/// Counts one provider call for `day` (YYYY-MM-DD). Refuses once `limit` calls were made that day.
/// A limit of 0 means no calls at all.
pub fn spend_call(dir: &Path, day: &str, limit: u32) -> Result<u32, String> {
    let file = dir.join("webintel-usage.json");
    let mut v: Value = std::fs::read_to_string(&file).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null);
    let used = if v.get("day").and_then(|d| d.as_str()) == Some(day) { v.get("calls").and_then(|c| c.as_u64()).unwrap_or(0) as u32 } else { 0 };
    if used >= limit {
        return Err(format!("The daily limit of {limit} web provider calls is used up. Raise it in Settings → Web providers, or try tomorrow."));
    }
    v = json!({ "day": day, "calls": used + 1 });
    std::fs::write(&file, v.to_string()).map_err(|e| format!("Could not record usage: {e}"))?;
    Ok(used + 1)
}

fn http() -> Result<reqwest::Client, String> {
    reqwest::Client::builder().connect_timeout(Duration::from_secs(5)).timeout(Duration::from_secs(40)).user_agent("Kinviva").build().map_err(|e| e.to_string())
}

/// A readable error that never contains the key or the full request address.
fn describe(status: u16, who: &str) -> String {
    match status {
        401 | 403 => format!("{who} rejected the key (HTTP {status})."),
        402 => format!("{who} says the account is out of credit (HTTP 402)."),
        404 => format!("{who} could not find what was asked for (HTTP 404). Check the name in Settings."),
        429 => format!("{who} is rate limited. Try again later."),
        c => format!("{who} returned HTTP {c}."),
    }
}

async fn send(req: reqwest::RequestBuilder, who: &str, cancel: &CancellationToken) -> Result<String, String> {
    let run = async {
        let r = req.send().await.map_err(|e| if e.is_timeout() { format!("{who} timed out.") } else { format!("{who} failed: {}", e.without_url()) })?;
        let status = r.status().as_u16();
        let body = r.text().await.unwrap_or_default();
        if (200..300).contains(&status) { Ok(body) } else { Err(describe(status, who)) }
    };
    tokio::select! {
        _ = cancel.cancelled() => Err("cancelled".to_string()),
        r = run => r,
    }
}

// ---- Firecrawl ----

#[derive(Deserialize)]
struct FcSearch {
    #[serde(default)]
    data: Vec<FcItem>,
}
#[derive(Deserialize)]
struct FcItem {
    #[serde(default)]
    url: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    markdown: String,
}

/// Search results from Firecrawl as reference sources. Only https links with some text are kept.
pub fn parse_firecrawl_search(body: &str, max: usize) -> Result<Vec<WebSource>, String> {
    let r: FcSearch = serde_json::from_str(body).map_err(|_| "Firecrawl sent a response Kinviva could not read.".to_string())?;
    Ok(r.data
        .into_iter()
        .filter_map(|i| {
            let url = https_only(&i.url)?;
            let text = if i.markdown.trim().is_empty() { i.description.clone() } else { i.markdown.clone() };
            if text.trim().is_empty() {
                return None;
            }
            Some(WebSource { title: clip(if i.title.is_empty() { &url } else { &i.title }, 120), url, snippet: clip(&text, SNIPPET_CHARS) })
        })
        .take(max)
        .collect())
}

pub async fn firecrawl_search(base: &str, key: &str, query: &str, max: usize, cancel: &CancellationToken) -> Result<Vec<WebSource>, String> {
    let req = http()?.post(format!("{base}/search")).bearer_auth(key).json(&json!({ "query": clip(query, 300), "limit": max, "scrapeOptions": { "formats": ["markdown"], "onlyMainContent": true } }));
    parse_firecrawl_search(&send(req, "Firecrawl", cancel).await?, max)
}

/// The main text of one public page as plain markdown.
pub fn parse_firecrawl_scrape(body: &str) -> Result<String, String> {
    let v: Value = serde_json::from_str(body).map_err(|_| "Firecrawl sent a response Kinviva could not read.".to_string())?;
    let md = v.pointer("/data/markdown").and_then(|m| m.as_str()).unwrap_or("").trim();
    if md.is_empty() { Err("Firecrawl returned no text for that page.".into()) } else { Ok(md.chars().take(PAGE_CHARS).collect()) }
}

pub async fn firecrawl_scrape(base: &str, key: &str, page: &str, cancel: &CancellationToken) -> Result<String, String> {
    let page = https_only(page).ok_or("Only https pages can be read.")?;
    let req = http()?.post(format!("{base}/scrape")).bearer_auth(key).json(&json!({ "url": page, "formats": ["markdown"], "onlyMainContent": true }));
    parse_firecrawl_scrape(&send(req, "Firecrawl", cancel).await?)
}

// ---- Apify ----

/// "user~actor" or "user/actor" names only.
pub fn valid_actor(id: &str) -> Option<String> {
    let t = id.trim().replace('/', "~");
    let ok = !t.is_empty() && t.len() <= 100 && t.matches('~').count() <= 1 && t.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '~' | '-' | '_'));
    ok.then_some(t)
}

/// Fills `{{keywords}}`, `{{location}}` and `{{limit}}` in the user's input template. The template must be a JSON object.
pub fn build_input(template: &str, keywords: &str, location: &str, limit: usize) -> Result<Value, String> {
    let t = if template.trim().is_empty() { r#"{"queries":["{{keywords}}"],"location":"{{location}}","maxItems":{{limit}}}"# } else { template };
    let esc = |s: &str| serde_json::to_string(s).map(|q| q[1..q.len() - 1].to_string()).unwrap_or_default();
    let filled = t.replace("{{keywords}}", &esc(keywords)).replace("{{location}}", &esc(location)).replace("{{limit}}", &limit.to_string());
    let v: Value = serde_json::from_str(&filled).map_err(|_| "The Apify input in Settings is not valid JSON.".to_string())?;
    if v.is_object() { Ok(v) } else { Err("The Apify input must be a JSON object.".into()) }
}

fn first_str(v: &Value, keys: &[&str]) -> String {
    keys.iter().find_map(|k| v.get(*k).and_then(|x| x.as_str()).map(str::trim).filter(|s| !s.is_empty())).unwrap_or("").to_string()
}

/// Jobs from an actor's dataset. Actors name fields differently, so common names are accepted. Rows without a title or an https link are dropped; nothing is made up.
pub fn parse_apify_jobs(body: &str, source: &str) -> Vec<Job> {
    let v: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    v.as_array()
        .map(|a| {
            a.iter()
                .take(MAX_ITEMS)
                .filter_map(|j| {
                    let title = first_str(j, &["title", "positionName", "jobTitle", "position", "name"]);
                    let url = https_only(&first_str(j, &["url", "link", "jobUrl", "applyUrl", "applicationLink", "externalApplyLink"]))?;
                    if title.is_empty() {
                        return None;
                    }
                    let company = first_str(j, &["company", "companyName", "employer", "organization"]);
                    let location = first_str(j, &["location", "jobLocation", "city"]);
                    let desc = crate::jobs::html_to_text(&first_str(j, &["description", "descriptionText", "descriptionHtml", "jobDescription"]), 6000);
                    let remote = location.to_lowercase().contains("remote") || j.get("remote").and_then(|r| r.as_bool()).unwrap_or(false);
                    Some(Job { id: format!("{source}:{url}"), title, company, location, url, description: desc, source: source.to_string(), posted_ms: None, remote })
                })
                .collect()
        })
        .unwrap_or_default()
}

pub async fn apify_run(base: &str, token: &str, actor: &str, input: &Value, cancel: &CancellationToken) -> Result<String, String> {
    let actor = valid_actor(actor).ok_or("The Apify actor name in Settings is not valid. Use the form username~actor-name.")?;
    let req = http()?.post(format!("{base}/acts/{actor}/run-sync-get-dataset-items")).bearer_auth(token).query(&[("timeout", "60")]).json(input);
    send(req, "Apify", cancel).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    async fn serve(status: &'static str, body: &'static str) -> (String, std::sync::Arc<std::sync::Mutex<String>>) {
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = l.local_addr().unwrap();
        let seen = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
        let s2 = seen.clone();
        tokio::spawn(async move {
            let (mut sock, _) = l.accept().await.unwrap();
            let mut buf = vec![0u8; 16384];
            let n = sock.read(&mut buf).await.unwrap_or(0);
            *s2.lock().unwrap() = String::from_utf8_lossy(&buf[..n]).to_string();
            let resp = format!("HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}", body.len());
            let _ = sock.write_all(resp.as_bytes()).await;
        });
        (format!("http://{addr}"), seen)
    }

    #[test]
    fn daily_limit_counts_resets_and_refuses() {
        let dir = std::env::temp_dir().join(format!("kv-usage-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let _ = std::fs::remove_file(dir.join("webintel-usage.json"));
        assert_eq!(spend_call(&dir, "2026-11-12", 2), Ok(1));
        assert_eq!(spend_call(&dir, "2026-11-12", 2), Ok(2));
        assert!(spend_call(&dir, "2026-11-12", 2).unwrap_err().contains("daily limit of 2"));
        assert_eq!(spend_call(&dir, "2026-11-13", 2), Ok(1));
        assert!(spend_call(&dir, "2026-11-13", 0).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn firecrawl_results_keep_only_https_with_text() {
        let r = parse_firecrawl_search(
            r##"{"success":true,"data":[{"url":"https://kubernetes.io/docs/a","title":"Pods","markdown":"# Pods\nA pod is..."},{"url":"http://insecure.com/x","title":"no","markdown":"x"},{"url":"https://e.com/empty","title":"e","markdown":" ","description":""},{"url":"https://e.com/d","title":"","description":"Only a description"}]}"##,
            5,
        )
        .unwrap();
        assert_eq!(r.len(), 2);
        assert_eq!(r[0].title, "Pods");
        assert_eq!(r[1].title, "https://e.com/d");
        assert!(parse_firecrawl_search("nope", 3).is_err());
        assert_eq!(parse_firecrawl_scrape(r##"{"data":{"markdown":"# Hi"}}"##).unwrap(), "# Hi");
        assert!(parse_firecrawl_scrape(r#"{"data":{}}"#).is_err());
    }

    #[test]
    fn apify_input_is_filled_safely_and_jobs_are_normalized() {
        let v = build_input("", "k8s \"ops\"", "Austin, TX", 25).unwrap();
        assert_eq!(v["queries"][0], "k8s \"ops\"");
        assert_eq!(v["maxItems"], 25);
        assert_eq!(build_input(r#"{"q":"{{keywords}}","n":{{limit}}}"#, "a", "b", 3).unwrap()["n"], 3);
        assert!(build_input("[1]", "a", "b", 3).is_err());
        assert!(build_input("{bad", "a", "b", 3).is_err());
        assert_eq!(valid_actor("apify/web-scraper"), Some("apify~web-scraper".into()));
        assert_eq!(valid_actor("a b"), None);
        assert_eq!(valid_actor("../x"), None);
        let jobs = parse_apify_jobs(
            r#"[{"positionName":"SRE","company":"Acme","location":"Remote","url":"https://jobs.example.com/1","description":"<p>Run <b>things</b></p>"},{"title":"No link","url":"javascript:x"},{"url":"https://x.io/y"},{"jobTitle":"Dev","applyUrl":"https://x.io/dev","companyName":"Beta"}]"#,
            "Apify",
        );
        assert_eq!(jobs.len(), 2);
        assert!(jobs[0].remote && jobs[0].description == "Run things" && jobs[0].id.starts_with("Apify:"));
        assert_eq!(jobs[1].company, "Beta");
        assert!(parse_apify_jobs("{}", "Apify").is_empty());
    }

    #[tokio::test]
    async fn search_sends_the_key_only_as_a_bearer_header_and_reads_results() {
        let (base, seen) = serve("200 OK", r#"{"data":[{"url":"https://docs.aws.amazon.com/x","title":"EKS","markdown":"Managed Kubernetes"}]}"#).await;
        let r = firecrawl_search(&base, "fc-secret", "eks upgrade", 3, &CancellationToken::new()).await.unwrap();
        assert_eq!(r[0].url, "https://docs.aws.amazon.com/x");
        let req = seen.lock().unwrap().to_lowercase();
        assert!(req.contains("authorization: bearer fc-secret") && req.contains("post /search") && req.contains("eks upgrade"));
    }

    #[tokio::test]
    async fn provider_errors_are_readable_and_never_leak_the_key() {
        for (status, want) in [("401 Unauthorized", "rejected the key"), ("402 Payment Required", "out of credit"), ("429 Too Many Requests", "rate limited"), ("500 Internal Server Error", "HTTP 500")] {
            let (base, _) = serve(status, "{}").await;
            let e = firecrawl_search(&base, "fc-secret", "q", 3, &CancellationToken::new()).await.unwrap_err();
            assert!(e.contains(want) && !e.contains("fc-secret"), "{e}");
        }
        let (base, seen) = serve("404 Not Found", "{}").await;
        let e = apify_run(&base, "ap-secret", "user~actor", &json!({}), &CancellationToken::new()).await.unwrap_err();
        assert!(e.contains("Apify") && e.contains("404") && !e.contains("ap-secret"));
        assert!(seen.lock().unwrap().contains("/acts/user~actor/run-sync-get-dataset-items"));
        assert!(apify_run("http://127.0.0.1:1", "t", "bad name", &json!({}), &CancellationToken::new()).await.unwrap_err().contains("not valid"));
        assert!(firecrawl_scrape("http://127.0.0.1:1", "k", "http://insecure.example/x", &CancellationToken::new()).await.unwrap_err().contains("https"));
    }

    #[tokio::test]
    async fn a_cancelled_call_stops() {
        let c = CancellationToken::new();
        c.cancel();
        let (base, _) = serve("200 OK", "{}").await;
        assert_eq!(firecrawl_search(&base, "k", "q", 1, &c).await.unwrap_err(), "cancelled");
    }
}
