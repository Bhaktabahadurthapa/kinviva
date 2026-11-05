//! Discover: real articles from official engineering blogs (RSS/Atom) and repositories from the
//! GitHub search API, kept in the local database and ranked by freshness, source quality and the
//! user's interests. Nothing is invented: every row has a URL, a source and the date the source
//! gave. Trend numbers are counts of stored items per topic and time window, never model output.
//! The network is only used after the user turns Discover on in Settings.

use crate::db::Db;
use chrono::{DateTime, Utc};
use quick_xml::events::Event;
use quick_xml::Reader;
use rusqlite::params;
use serde::Serialize;

type R<T> = Result<T, String>;
fn e(x: rusqlite::Error) -> String {
    x.to_string()
}

pub struct Feed {
    pub name: &'static str,
    pub url: &'static str,
    /// 0 to 1: how much the source is trusted for technical news (all are official project or vendor blogs).
    pub quality: f64,
}

pub const FEEDS: &[Feed] = &[
    Feed { name: "Kubernetes Blog", url: "https://kubernetes.io/feed.xml", quality: 1.0 },
    Feed { name: "CNCF", url: "https://www.cncf.io/feed/", quality: 1.0 },
    Feed { name: "AWS News Blog", url: "https://aws.amazon.com/blogs/aws/feed/", quality: 1.0 },
    Feed { name: "Azure Blog", url: "https://azure.microsoft.com/en-us/blog/feed/", quality: 1.0 },
    Feed { name: "HashiCorp Blog", url: "https://www.hashicorp.com/blog/feed.xml", quality: 0.95 },
    Feed { name: "GitHub Blog", url: "https://github.blog/feed/", quality: 0.9 },
    Feed { name: "Cloudflare Blog", url: "https://blog.cloudflare.com/rss/", quality: 0.9 },
    Feed { name: "Docker Blog", url: "https://www.docker.com/blog/feed/", quality: 0.85 },
];

/// Topic name and the words that classify an item into it.
pub const TOPICS: &[(&str, &[&str])] = &[
    ("Kubernetes", &["kubernetes", "k8s", "kubectl", "helm", "kubelet", "ingress", "operator", "pod"]),
    ("AWS", &["aws", "amazon", "ec2", "s3", "lambda", "eks", "cloudformation", "bedrock"]),
    ("Azure", &["azure", "microsoft", "aks", "entra", "bicep"]),
    ("Cloud DevOps", &["devops", "ci/cd", "pipeline", "terraform", "deploy", "gitops", "infrastructure as code", "observability", "sre"]),
    ("AI Engineering", &["llm", "machine learning", "ai model", "inference", "generative", "rag", "embedding", "fine-tun"]),
    ("AI Agents", &["agent", "agentic", "copilot", "autonomous"]),
    ("MCP", &["mcp", "model context protocol"]),
    ("Platform Engineering", &["platform engineering", "internal developer", "backstage", "developer platform", "golden path"]),
    ("Cloud Security", &["cloud security", "zero trust", "iam", "kms", "secrets", "supply chain", "sbom", "vulnerability"]),
    ("Cybersecurity", &["security", "attack", "malware", "ransomware", "cve", "threat", "breach"]),
    ("Data Engineering", &["data pipeline", "data lake", "warehouse", "spark", "kafka", "streaming", "etl", "postgres", "database"]),
    ("Software Engineering", &["software", "rust", "golang", "typescript", "api", "architecture", "performance", "open source"]),
];

#[derive(Debug, Clone, PartialEq)]
pub struct Item {
    pub title: String,
    pub url: String,
    pub summary: String,
    pub published_at: Option<i64>,
}

fn local(name: &[u8]) -> &[u8] {
    name.rsplit(|b| *b == b':').next().unwrap_or(name)
}

fn parse_date(s: &str) -> Option<i64> {
    let s = s.trim();
    DateTime::parse_from_rfc2822(s).or_else(|_| DateTime::parse_from_rfc3339(s)).ok().map(|d| d.with_timezone(&Utc).timestamp_millis())
}

/// Plain text from a feed field: tags removed, entities decoded, whitespace collapsed, length limited.
pub fn clean_text(s: &str, max: usize) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                out.push(' ');
            }
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    let out = out.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'").replace("&nbsp;", " ").replace(['\u{2019}', '\u{2018}'], "'");
    out.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(max).collect()
}

/// Removes tracking parameters and fragments so the same article is not stored twice.
pub fn canonical_url(u: &str) -> Option<String> {
    let url = url::Url::parse(u.trim()).ok()?;
    if url.scheme() != "https" && url.scheme() != "http" {
        return None;
    }
    let mut url = url;
    url.set_fragment(None);
    let keep: Vec<(String, String)> = url.query_pairs().filter(|(k, _)| !k.starts_with("utm_") && k != "ref" && k != "fbclid" && k != "gclid").map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
    if keep.is_empty() {
        url.set_query(None);
    } else {
        url.query_pairs_mut().clear().extend_pairs(keep);
    }
    // Always https for stored links.
    if url.scheme() == "http" {
        let _ = url.set_scheme("https");
    }
    Some(url.to_string().trim_end_matches('/').to_string())
}

/// Items from an RSS 2.0 or Atom document (first `limit` only).
pub fn parse_feed(xml: &str, limit: usize) -> Vec<Item> {
    let mut reader = Reader::from_str(xml);
    let mut items = Vec::new();
    let mut cur: Option<(String, String, String, Option<i64>)> = None;
    let mut field: Option<&'static str> = None;
    let mut text = String::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(t)) => {
                let name = local(t.name().as_ref()).to_vec();
                match name.as_slice() {
                    b"item" | b"entry" => cur = Some((String::new(), String::new(), String::new(), None)),
                    b"title" if cur.is_some() => (field, text) = (Some("title"), String::new()),
                    b"link" if cur.is_some() => {
                        // Atom: <link href="..."/> (rel alternate or none); RSS: text content.
                        let href = t.attributes().flatten().find(|a| a.key.as_ref() == b"href").and_then(|a| a.unescape_value().ok().map(|v| v.into_owned()));
                        let rel = t.attributes().flatten().find(|a| a.key.as_ref() == b"rel").and_then(|a| a.unescape_value().ok().map(|v| v.into_owned()));
                        if let (Some(h), Some(c)) = (href, cur.as_mut()) {
                            if rel.as_deref().unwrap_or("alternate") == "alternate" && c.1.is_empty() {
                                c.1 = h;
                            }
                        } else {
                            (field, text) = (Some("link"), String::new());
                        }
                    }
                    b"description" | b"summary" if cur.is_some() => (field, text) = (Some("summary"), String::new()),
                    b"pubDate" | b"published" | b"updated" | b"date" if cur.is_some() => (field, text) = (Some("date"), String::new()),
                    _ => {}
                }
            }
            Ok(Event::Empty(t)) => {
                if local(t.name().as_ref()) == b"link" {
                    let href = t.attributes().flatten().find(|a| a.key.as_ref() == b"href").and_then(|a| a.unescape_value().ok().map(|v| v.into_owned()));
                    let rel = t.attributes().flatten().find(|a| a.key.as_ref() == b"rel").and_then(|a| a.unescape_value().ok().map(|v| v.into_owned()));
                    if let (Some(h), Some(c)) = (href, cur.as_mut()) {
                        if rel.as_deref().unwrap_or("alternate") == "alternate" && c.1.is_empty() {
                            c.1 = h;
                        }
                    }
                }
            }
            Ok(Event::Text(t)) if field.is_some() => text.push_str(&t.decode().map(|c| c.into_owned()).unwrap_or_default()),
            Ok(Event::CData(t)) if field.is_some() => text.push_str(&String::from_utf8_lossy(&t.into_inner())),
            Ok(Event::GeneralRef(r)) if field.is_some() => {
                // Entities such as &amp; arrive as separate events.
                let name = String::from_utf8_lossy(r.as_ref()).to_string();
                match name.as_str() {
                    "amp" => text.push('&'),
                    "lt" => text.push('<'),
                    "gt" => text.push('>'),
                    "quot" => text.push('"'),
                    "apos" => text.push('\''),
                    n if n.starts_with('#') => {
                        let code = n[1..].strip_prefix(['x', 'X']).map(|h| u32::from_str_radix(h, 16)).unwrap_or_else(|| n[1..].parse::<u32>());
                        if let Some(ch) = code.ok().and_then(char::from_u32) {
                            text.push(ch);
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::End(t)) => {
                let name = local(t.name().as_ref()).to_vec();
                if let (Some(f), Some(c)) = (field, cur.as_mut()) {
                    match (f, name.as_slice()) {
                        ("title", b"title") => c.0 = clean_text(&text, 200),
                        ("link", b"link") if c.1.is_empty() => c.1 = text.trim().to_string(),
                        ("summary", b"description") | ("summary", b"summary") => c.2 = clean_text(&text, 320),
                        ("date", b"pubDate") | ("date", b"published") | ("date", b"date") => c.3 = parse_date(&text),
                        ("date", b"updated") if c.3.is_none() => c.3 = parse_date(&text),
                        _ => {}
                    }
                    if matches!(name.as_slice(), b"title" | b"link" | b"description" | b"summary" | b"pubDate" | b"published" | b"updated" | b"date") {
                        field = None;
                    }
                }
                if matches!(name.as_slice(), b"item" | b"entry") {
                    if let Some((title, link, summary, date)) = cur.take() {
                        if let (false, Some(url)) = (title.is_empty(), canonical_url(&link)) {
                            items.push(Item { title, url, summary, published_at: date });
                        }
                    }
                    if items.len() >= limit {
                        break;
                    }
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    items
}

/// Best matching topic for a title and summary, by distinct keyword hits (ties go to the earlier topic).
pub fn classify(title: &str, summary: &str) -> Option<&'static str> {
    let t = format!(" {} {} ", title.to_lowercase(), summary.to_lowercase());
    TOPICS
        .iter()
        .map(|(name, words)| (*name, words.iter().filter(|w| t.contains(&format!(" {w}")) || t.contains(&format!("{w} ")) || t.contains(*w)).count()))
        .filter(|(_, n)| *n > 0)
        .max_by(|a, b| a.1.cmp(&b.1).then(std::cmp::Ordering::Greater))
        .map(|(n, _)| n)
}

/// Freshness (half-life one week) times source quality, plus a boost for the user's interests and a gentle star bonus for repositories.
pub fn rank(published_ms: Option<i64>, fetched_ms: i64, now_ms: i64, quality: f64, topic: Option<&str>, interests: &[String], stars: Option<i64>) -> f64 {
    let age_days = ((now_ms - published_ms.unwrap_or(fetched_ms)).max(0) as f64) / 86_400_000.0;
    let fresh = 0.5f64.powf(age_days / 7.0);
    let interest = topic.is_some_and(|t| interests.iter().any(|i| i.eq_ignore_ascii_case(t)));
    let star_bonus = stars.map(|s| ((s.max(1) as f64).log10() / 6.0).min(0.5)).unwrap_or(0.0);
    fresh * quality + if interest { 1.0 } else { 0.0 } + star_bonus * fresh
}

#[derive(Debug, Clone, Serialize)]
pub struct DiscoverItem {
    pub id: String,
    pub url: String,
    pub title: String,
    pub source: String,
    pub summary: String,
    pub published_at: Option<i64>,
    pub fetched_at: i64,
    pub topic: Option<String>,
    pub kind: String,
    pub stars: Option<i64>,
    pub language: Option<String>,
    pub is_read: bool,
    pub saved: bool,
    pub score: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Trend {
    pub topic: String,
    /// Items stored whose date falls in the last 30 days.
    pub recent: i64,
    /// Items in the 30 days before that.
    pub previous: i64,
    pub sources: i64,
}

impl Db {
    /// Inserts when the URL (or the same title from the same source) is new. Returns whether a row was added.
    #[allow(clippy::too_many_arguments)]
    pub fn add_discover(&self, it: &Item, source: &str, kind: &str, topic: Option<&str>, stars: Option<i64>, language: Option<&str>, now: i64) -> R<bool> {
        let conn = self.conn.lock().unwrap();
        let dup: i64 = conn
            .query_row("SELECT COUNT(*) FROM discover_items WHERE url = ?1 OR (source = ?2 AND lower(title) = lower(?3))", params![it.url, source, it.title], |r| r.get(0))
            .map_err(e)?;
        if dup > 0 {
            return Ok(false);
        }
        conn.execute(
            "INSERT INTO discover_items(id, url, title, source, summary, published_at, fetched_at, topic, kind, score, stars, language, is_read, saved) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,0,?10,?11,0,0)",
            params![uuid::Uuid::new_v4().to_string(), it.url, it.title, source, it.summary, it.published_at, now, topic, kind, stars, language],
        )
        .map_err(e)?;
        Ok(true)
    }

    pub fn list_discover(&self, kind: Option<&str>, saved_only: bool, interests: &[String], now: i64) -> R<Vec<DiscoverItem>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT id, url, title, source, summary, published_at, fetched_at, topic, kind, stars, language, is_read, saved FROM discover_items WHERE (?1 IS NULL OR kind = ?1) AND (?2 = 0 OR saved = 1)")
            .map_err(e)?;
        let rows = stmt
            .query_map(params![kind, saved_only as i64], |r| {
                Ok(DiscoverItem { id: r.get(0)?, url: r.get(1)?, title: r.get(2)?, source: r.get(3)?, summary: r.get::<_, Option<String>>(4)?.unwrap_or_default(), published_at: r.get(5)?, fetched_at: r.get(6)?, topic: r.get(7)?, kind: r.get(8)?, stars: r.get(9)?, language: r.get(10)?, is_read: r.get::<_, i64>(11)? != 0, saved: r.get::<_, i64>(12)? != 0, score: 0.0 })
            })
            .map_err(e)?;
        let mut items = rows.collect::<Result<Vec<_>, _>>().map_err(e)?;
        for i in &mut items {
            let quality = FEEDS.iter().find(|f| f.name == i.source).map(|f| f.quality).unwrap_or(0.8);
            i.score = rank(i.published_at, i.fetched_at, now, quality, i.topic.as_deref(), interests, i.stars);
        }
        items.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
        items.truncate(80);
        Ok(items)
    }

    pub fn mark_discover(&self, id: &str, field: &str, value: bool) -> R<()> {
        let col = match field {
            "read" => "is_read",
            "saved" => "saved",
            _ => return Err("Unknown field.".into()),
        };
        self.conn.lock().unwrap().execute(&format!("UPDATE discover_items SET {col} = ?2 WHERE id = ?1"), params![id, value as i64]).map(|_| ()).map_err(e)
    }

    pub fn discover_has_url(&self, url: &str) -> R<bool> {
        self.conn.lock().unwrap().query_row("SELECT COUNT(*) FROM discover_items WHERE url = ?1", [url], |r| r.get::<_, i64>(0)).map(|n| n > 0).map_err(e)
    }

    pub fn last_discover_fetch(&self) -> R<Option<i64>> {
        self.conn.lock().unwrap().query_row("SELECT MAX(fetched_at) FROM discover_items", [], |r| r.get(0)).map_err(e)
    }

    /// Counts per topic over two 30-day windows, from stored items with a real publication date.
    pub fn discover_trends(&self, now: i64) -> R<Vec<Trend>> {
        let day30 = 30 * 86_400_000i64;
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT topic, SUM(CASE WHEN published_at >= ?1 THEN 1 ELSE 0 END), SUM(CASE WHEN published_at >= ?2 AND published_at < ?1 THEN 1 ELSE 0 END), COUNT(DISTINCT source)
                 FROM discover_items WHERE topic IS NOT NULL AND published_at IS NOT NULL AND published_at >= ?2 GROUP BY topic ORDER BY 2 DESC",
            )
            .map_err(e)?;
        let rows = stmt.query_map(params![now - day30, now - 2 * day30], |r| Ok(Trend { topic: r.get(0)?, recent: r.get(1)?, previous: r.get(2)?, sources: r.get(3)? })).map_err(e)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(e)
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct RefreshReport {
    pub added: usize,
    pub failed: Vec<String>,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder().timeout(std::time::Duration::from_secs(15)).user_agent("MeetingLens").build().map_err(|x| x.to_string())
}

async fn get_text(c: &reqwest::Client, url: &str) -> Result<String, String> {
    let r = c.get(url).header("accept", "application/rss+xml, application/atom+xml, application/json, text/xml, */*").send().await.map_err(|x| x.without_url().to_string())?;
    if !r.status().is_success() {
        return Err(format!("HTTP {}", r.status().as_u16()));
    }
    if r.content_length().is_some_and(|n| n > 4_000_000) {
        return Err("too large".into());
    }
    let bytes = r.bytes().await.map_err(|x| x.without_url().to_string())?;
    if bytes.len() > 4_000_000 {
        return Err("too large".into());
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// Fetches every feed and the GitHub topics for the user's interests. One failing source never stops the others.
pub async fn refresh(db: &Db, interests: &[String], now: i64) -> RefreshReport {
    let c = match client() {
        Ok(c) => c,
        Err(m) => return RefreshReport { added: 0, failed: vec![m] },
    };
    let mut added = 0;
    let mut failed = Vec::new();
    for f in FEEDS {
        match get_text(&c, f.url).await {
            Ok(xml) => {
                for it in parse_feed(&xml, 25) {
                    let topic = classify(&it.title, &it.summary);
                    if db.add_discover(&it, f.name, "news", topic, None, None, now).unwrap_or(false) {
                        added += 1;
                    }
                }
            }
            Err(m) => failed.push(format!("{}: {}", f.name, m)),
        }
    }
    // GitHub: recently updated, well-starred repositories for each interest (at most 4 searches).
    let since = (Utc::now() - chrono::Duration::days(45)).format("%Y-%m-%d").to_string();
    for topic in interests.iter().take(4) {
        let slug: String = topic.to_lowercase().chars().map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' }).collect();
        let q = format!("https://api.github.com/search/repositories?q=topic:{slug}+pushed:%3E{since}+stars:%3E200&sort=stars&order=desc&per_page=6");
        match get_text(&c, &q).await {
            Ok(body) => {
                for r in parse_repos(&body) {
                    if db.add_discover(&r.0, "GitHub", "repo", Some(topic.as_str()), r.1, r.2.as_deref(), now).unwrap_or(false) {
                        added += 1;
                    }
                }
            }
            Err(m) => failed.push(format!("GitHub ({topic}): {m}")),
        }
    }
    RefreshReport { added, failed }
}

type Repo = (Item, Option<i64>, Option<String>);
/// Repositories from a GitHub search response (name, description, stars, language, last push).
pub fn parse_repos(body: &str) -> Vec<Repo> {
    let v: serde_json::Value = serde_json::from_str(body).unwrap_or_default();
    v.get("items")
        .and_then(|i| i.as_array())
        .into_iter()
        .flatten()
        .filter_map(|r| {
            let url = canonical_url(r.get("html_url")?.as_str()?)?;
            let name = r.get("full_name")?.as_str()?.to_string();
            let desc = clean_text(r.get("description").and_then(|d| d.as_str()).unwrap_or(""), 240);
            let pushed = r.get("pushed_at").and_then(|d| d.as_str()).and_then(parse_date);
            Some((Item { title: name, url, summary: desc, published_at: pushed }, r.get("stargazers_count").and_then(|s| s.as_i64()), r.get("language").and_then(|l| l.as_str()).map(String::from)))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const RSS: &str = r#"<?xml version="1.0"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>Blog</title>
      <item><title>Kubernetes 1.35 &amp; what&#8217;s new</title><link>https://example.com/k8s-135?utm_source=rss#top</link><pubDate>Tue, 04 Nov 2025 10:00:00 +0000</pubDate>
        <description><![CDATA[<p>New <b>features</b> for pods and <a href="x">ingress</a>.</p>]]></description></item>
      <item><title>No link here</title><pubDate>Tue, 04 Nov 2025 10:00:00 +0000</pubDate></item>
      <item><title>Terraform pipeline guide</title><link>http://example.com/tf/</link></item></channel></rss>"#;
    const ATOM: &str = r#"<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Platform engineering in practice</title><link rel="alternate" href="https://example.org/pe"/><link rel="self" href="https://example.org/self"/><updated>2025-11-03T09:30:00Z</updated><summary>Backstage and golden paths.</summary></entry></feed>"#;

    #[test]
    fn rss_items_are_parsed_cleaned_and_canonicalised() {
        let items = parse_feed(RSS, 10);
        assert_eq!(items.len(), 2); // the item without a link is dropped
        assert_eq!(items[0].title, "Kubernetes 1.35 & what's new");
        assert_eq!(items[0].url, "https://example.com/k8s-135"); // tracking and fragment removed
        assert_eq!(items[0].summary, "New features for pods and ingress .");
        assert_eq!(items[0].published_at, Some(1_762_250_400_000));
        assert_eq!(items[1].url, "https://example.com/tf"); // http becomes https, trailing slash removed
        assert_eq!(items[1].published_at, None); // no date is never invented
    }

    #[test]
    fn atom_entries_use_the_alternate_link_and_updated_date() {
        let items = parse_feed(ATOM, 10);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].url, "https://example.org/pe");
        assert!(items[0].published_at.is_some());
        assert_eq!(parse_feed("<not xml", 5).len(), 0);
        assert_eq!(parse_feed(RSS, 1).len(), 1);
    }

    #[test]
    fn classification_picks_the_topic_with_the_most_matches() {
        assert_eq!(classify("Kubernetes ingress and pod autoscaling", ""), Some("Kubernetes"));
        assert_eq!(classify("Model Context Protocol servers", ""), Some("MCP"));
        assert_eq!(classify("Our summer party", "cake"), None);
    }

    #[test]
    fn ranking_prefers_fresh_trusted_items_and_the_users_interests() {
        let now = 100 * 86_400_000;
        let day = 86_400_000;
        let fresh = rank(Some(now - day), now, now, 1.0, Some("AWS"), &[], None);
        let old = rank(Some(now - 40 * day), now, now, 1.0, Some("AWS"), &[], None);
        assert!(fresh > old * 10.0);
        let mine = rank(Some(now - 10 * day), now, now, 0.8, Some("Kubernetes"), &["kubernetes".to_string()], None);
        assert!(mine > fresh);
        assert!(rank(Some(now), now, now, 1.0, None, &[], Some(50_000)) > rank(Some(now), now, now, 1.0, None, &[], Some(300)));
        assert_eq!(canonical_url("ftp://x.y/z"), None);
    }

    #[test]
    fn storage_dedupes_ranks_marks_and_counts_trends_from_real_rows() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(&dir.path().join("t.sqlite")).unwrap();
        let now = 200 * 86_400_000i64;
        let mk = |t: &str, u: &str, days: i64| Item { title: t.into(), url: u.into(), summary: "s".into(), published_at: Some(now - days * 86_400_000) };
        assert!(db.add_discover(&mk("Pods explained", "https://a.com/1", 2), "Kubernetes Blog", "news", Some("Kubernetes"), None, None, now).unwrap());
        assert!(!db.add_discover(&mk("Pods explained", "https://a.com/other", 2), "Kubernetes Blog", "news", Some("Kubernetes"), None, None, now).unwrap()); // same title, same source
        assert!(!db.add_discover(&mk("Different", "https://a.com/1", 2), "CNCF", "news", Some("Kubernetes"), None, None, now).unwrap()); // same URL
        db.add_discover(&mk("Lambda news", "https://b.com/2", 3), "AWS News Blog", "news", Some("AWS"), None, None, now).unwrap();
        db.add_discover(&mk("Old k8s", "https://a.com/3", 45), "CNCF", "news", Some("Kubernetes"), None, None, now).unwrap();
        db.add_discover(&mk("org/repo", "https://github.com/org/repo", 1), "GitHub", "repo", Some("Kubernetes"), Some(5000), None, now).unwrap();
        let list = db.list_discover(Some("news"), false, &["AWS".to_string()], now).unwrap();
        assert_eq!(list[0].title, "Lambda news"); // the user's interest wins
        assert_eq!(list.len(), 3);
        db.mark_discover(&list[0].id, "saved", true).unwrap();
        db.mark_discover(&list[0].id, "read", true).unwrap();
        assert!(db.mark_discover(&list[0].id, "bogus", true).is_err());
        assert_eq!(db.list_discover(None, true, &[], now).unwrap().len(), 1);
        let t = db.discover_trends(now).unwrap();
        let k = t.iter().find(|x| x.topic == "Kubernetes").unwrap();
        assert_eq!((k.recent, k.previous), (2, 1)); // 2 recent (news + repo), 1 in the 30 days before
        assert!(db.discover_has_url("https://b.com/2").unwrap());
        assert_eq!(db.last_discover_fetch().unwrap(), Some(now));
    }

    #[test]
    fn github_search_results_become_repo_items() {
        let body = r#"{"items":[{"full_name":"org/tool","html_url":"https://github.com/org/tool","description":"A <b>tool</b>","stargazers_count":1234,"language":"Go","pushed_at":"2025-11-01T00:00:00Z"},{"full_name":"bad","html_url":"javascript:alert(1)"}]}"#;
        let r = parse_repos(body);
        assert_eq!(r.len(), 1);
        assert_eq!((r[0].0.title.as_str(), r[0].1, r[0].2.as_deref()), ("org/tool", Some(1234), Some("Go")));
        assert_eq!(r[0].0.summary, "A tool");
        assert!(parse_repos("nope").is_empty());
    }

    /// Needs the internet: every configured feed must parse into dated, linked items. Run with `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn the_real_feeds_parse() {
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        rt.block_on(async {
            let c = client().unwrap();
            for f in FEEDS {
                let xml = get_text(&c, f.url).await.unwrap_or_else(|e| panic!("{}: {e}", f.name));
                let items = parse_feed(&xml, 25);
                assert!(items.len() >= 5, "{} gave {} items", f.name, items.len());
                assert!(items.iter().all(|i| i.url.starts_with("https://") && !i.title.is_empty()), "{}", f.name);
                assert!(items.iter().filter(|i| i.published_at.is_some()).count() >= items.len() / 2, "{} has few dates", f.name);
                eprintln!("{}: {} items, first: {}", f.name, items.len(), items[0].title);
            }
            let body = get_text(&c, "https://api.github.com/search/repositories?q=topic:kubernetes+stars:%3E1000&sort=stars&per_page=3").await.unwrap();
            assert!(!parse_repos(&body).is_empty());
        });
    }
}
