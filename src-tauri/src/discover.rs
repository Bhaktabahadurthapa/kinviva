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
    /// A picture the source offers for the article (never fetched or shown unless it passes the checks below).
    pub image_url: Option<String>,
}

fn local(name: &[u8]) -> &[u8] {
    name.rsplit(|b| *b == b':').next().unwrap_or(name)
}

fn media_url(t: &quick_xml::events::BytesStart) -> Option<String> {
    let attr = |k: &[u8]| t.attributes().flatten().find(|a| a.key.as_ref() == k).and_then(|a| a.unescape_value().ok().map(|v| v.into_owned()));
    let kind = attr(b"type").or_else(|| attr(b"medium")).unwrap_or_default();
    // An enclosure or media item may be audio or video; only pictures (or untyped items) count.
    (kind.is_empty() || kind.starts_with("image")).then(|| attr(b"url")).flatten()
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

/// The first `<img src>` in a piece of HTML.
pub fn first_img(html: &str) -> Option<String> {
    let lower = html.to_lowercase();
    let mut from = 0;
    while let Some(i) = lower[from..].find("<img") {
        let tag_start = from + i;
        let tag_end = lower[tag_start..].find('>').map(|e| tag_start + e)?;
        let tag = &html[tag_start..tag_end];
        let lt = &lower[tag_start..tag_end];
        if let Some(at) = lt.find(" src=") {
            let rest = &tag[at + 5..];
            let quote = rest.chars().next()?;
            if quote == '"' || quote == '\'' {
                if let Some(end) = rest[1..].find(quote) {
                    return Some(rest[1..1 + end].to_string());
                }
            }
        }
        from = tag_end;
    }
    None
}

/// Only https pictures from public hosts are considered.
pub fn usable_image_url(u: &str) -> Option<String> {
    let url = url::Url::parse(u.trim()).ok()?;
    if url.scheme() != "https" {
        return None;
    }
    let host = url.host_str()?.to_lowercase();
    let private = host == "localhost" || host.ends_with(".local") || host.ends_with(".internal") || host.parse::<std::net::IpAddr>().is_ok();
    (!private).then(|| url.to_string())
}

/// A data URL for a small picture: JPEG, PNG, WebP or GIF (checked by the file itself, SVG never accepted),
/// scaled down to 480 pixels wide and re-encoded as JPEG so it stays light and sharp. `None` if it is not a real picture.
pub fn image_data_url(bytes: &[u8], max_download: usize) -> Option<String> {
    use base64::Engine;
    use image::{codecs::jpeg::JpegEncoder, ImageReader};
    if bytes.len() < 16 || bytes.len() > max_download {
        return None;
    }
    let mut reader = ImageReader::new(std::io::Cursor::new(bytes)).with_guessed_format().ok()?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(8000);
    limits.max_image_height = Some(8000);
    limits.max_alloc = Some(128 * 1024 * 1024);
    reader.limits(limits);
    let img = reader.decode().ok()?;
    let (w, h) = (img.width(), img.height());
    if w < 40 || h < 40 {
        return None;
    }
    let thumb = if w > 480 { img.resize(480, 480 * 4, image::imageops::FilterType::Triangle) } else { img };
    let rgb = thumb.to_rgb8();
    let mut out = Vec::new();
    JpegEncoder::new_with_quality(&mut out, 82).encode(rgb.as_raw(), rgb.width(), rgb.height(), image::ExtendedColorType::Rgb8).ok()?;
    Some(format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(&out)))
}

/// Items from an RSS 2.0 or Atom document (first `limit` only).
pub fn parse_feed(xml: &str, limit: usize) -> Vec<Item> {
    let mut reader = Reader::from_str(xml);
    let mut items = Vec::new();
    let mut cur: Option<(String, String, String, Option<i64>)> = None;
    let mut media: Option<String> = None;
    let mut html = String::new();
    let mut field: Option<&'static str> = None;
    let mut text = String::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(t)) => {
                let name = local(t.name().as_ref()).to_vec();
                if cur.is_some() && media.is_none() && matches!(name.as_slice(), b"content" | b"thumbnail" | b"enclosure") {
                    media = media_url(&t);
                }
                match name.as_slice() {
                    b"item" | b"entry" => {
                        cur = Some((String::new(), String::new(), String::new(), None));
                        media = None;
                        html.clear();
                    }
                    b"encoded" | b"content" if cur.is_some() && t.attributes().flatten().all(|a| a.key.as_ref() != b"url") => (field, text) = (Some("html"), String::new()),
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
                if cur.is_some() && media.is_none() && matches!(local(t.name().as_ref()), b"content" | b"thumbnail" | b"enclosure") {
                    media = media_url(&t);
                }
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
                        ("summary", b"description") | ("summary", b"summary") => {
                            html.push_str(&text);
                            c.2 = clean_text(&text, 320);
                        }
                        ("html", _) => html.push_str(&text),
                        ("date", b"pubDate") | ("date", b"published") | ("date", b"date") => c.3 = parse_date(&text),
                        ("date", b"updated") if c.3.is_none() => c.3 = parse_date(&text),
                        _ => {}
                    }
                    if matches!(name.as_slice(), b"title" | b"link" | b"description" | b"summary" | b"pubDate" | b"published" | b"updated" | b"date" | b"encoded" | b"content") {
                        field = None;
                    }
                }
                if matches!(name.as_slice(), b"item" | b"entry") {
                    if let Some((title, link, summary, date)) = cur.take() {
                        if let (false, Some(url)) = (title.is_empty(), canonical_url(&link)) {
                            let image_url = media.take().or_else(|| first_img(&html)).and_then(|u| usable_image_url(&u));
                            items.push(Item { title, url, summary, published_at: date, image_url });
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

/// The user's own skill or topic that an item is about (case-insensitive, whole words), if any.
pub fn match_interest(title: &str, summary: &str, interests: &[String]) -> Option<String> {
    let text = format!(" {} {} ", title.to_lowercase(), summary.to_lowercase());
    let boundary = |c: Option<char>| !c.is_some_and(|c| c.is_alphanumeric());
    interests.iter().find(|i| {
        let w = i.trim().to_lowercase();
        w.chars().count() >= 2 && text.match_indices(&w).any(|(at, m)| boundary(text[..at].chars().next_back()) && boundary(text[at + m.len()..].chars().next()))
    }).cloned()
}

/// Interests as typed by the user, made safe for storage and for a search query: letters, digits and a few separators.
pub fn clean_interest(s: &str) -> String {
    s.chars().filter(|c| c.is_alphanumeric() || " +#.-/".contains(*c)).collect::<String>().split_whitespace().collect::<Vec<_>>().join(" ").chars().take(40).collect()
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
    /// A small picture as a data URL (only for the best-ranked items).
    pub image: Option<String>,
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
            .prepare("SELECT id, url, title, source, summary, published_at, fetched_at, topic, kind, stars, language, is_read, saved, image FROM discover_items WHERE (?1 IS NULL OR kind = ?1) AND (?2 = 0 OR saved = 1)")
            .map_err(e)?;
        let rows = stmt
            .query_map(params![kind, saved_only as i64], |r| {
                Ok(DiscoverItem { id: r.get(0)?, url: r.get(1)?, title: r.get(2)?, source: r.get(3)?, summary: r.get::<_, Option<String>>(4)?.unwrap_or_default(), published_at: r.get(5)?, fetched_at: r.get(6)?, topic: r.get(7)?, kind: r.get(8)?, stars: r.get(9)?, language: r.get(10)?, is_read: r.get::<_, i64>(11)? != 0, saved: r.get::<_, i64>(12)? != 0, score: 0.0, image: r.get(13)? })
            })
            .map_err(e)?;
        let mut items = rows.collect::<Result<Vec<_>, _>>().map_err(e)?;
        for i in &mut items {
            let quality = FEEDS.iter().find(|f| f.name == i.source).map(|f| f.quality).unwrap_or(0.8);
            // A skill the user added themselves counts even when the fixed topic list does not know it.
            if i.kind == "news" {
                if let Some(mine) = match_interest(&i.title, &i.summary, interests) {
                    i.topic = Some(mine);
                }
            }
            i.score = rank(i.published_at, i.fetched_at, now, quality, i.topic.as_deref(), interests, i.stars);
        }
        items.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
        items.truncate(80);
        // Pictures are kept for the 30 best-ranked items so the list stays light.
        for i in items.iter_mut().skip(30) {
            i.image = None;
        }
        Ok(items)
    }

    pub fn discover_needs_image(&self, url: &str) -> R<bool> {
        self.conn.lock().unwrap().query_row("SELECT COUNT(*) FROM discover_items WHERE url = ?1 AND image IS NULL", [url], |r| r.get::<_, i64>(0)).map(|n| n > 0).map_err(e)
    }

    pub fn set_discover_image(&self, url: &str, image: &str) -> R<()> {
        self.conn.lock().unwrap().execute("UPDATE discover_items SET image = ?2 WHERE url = ?1", params![url, image]).map(|_| ()).map_err(e)
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
    /// Pictures downloaded and saved during this refresh.
    pub pictures: usize,
    pub failed: Vec<String>,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder().timeout(std::time::Duration::from_secs(15)).user_agent("Kinviva").build().map_err(|x| x.to_string())
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

/// Downloads one picture (at most 3 MB) and turns it into a small thumbnail.
async fn fetch_image(c: &reqwest::Client, url: &str) -> Option<String> {
    let r = tokio::time::timeout(std::time::Duration::from_secs(6), c.get(url).send()).await.ok()?.ok()?;
    if !r.status().is_success() || r.content_length().is_some_and(|n| n > 3_000_000) {
        return None;
    }
    let bytes = tokio::time::timeout(std::time::Duration::from_secs(6), r.bytes()).await.ok()?.ok()?;
    image_data_url(&bytes, 3_000_000)
}

/// Fetches every feed and the GitHub topics for the user's interests. One failing source never stops the others.
pub async fn refresh(db: &Db, interests: &[String], now: i64) -> RefreshReport {
    let interests: Vec<String> = interests.iter().map(|i| clean_interest(i)).filter(|i| !i.is_empty()).collect();
    let interests = interests.as_slice();
    let c = match client() {
        Ok(c) => c,
        Err(m) => return RefreshReport { added: 0, pictures: 0, failed: vec![m] },
    };
    let mut added = 0;
    let mut pictures = 0;
    let mut failed = Vec::new();
    for f in FEEDS {
        match get_text(&c, f.url).await {
            Ok(xml) => {
                let mut fetched = 0;
                for it in parse_feed(&xml, 25) {
                    let mine = match_interest(&it.title, &it.summary, interests);
                    let topic = mine.as_deref().or_else(|| classify(&it.title, &it.summary));
                    let is_new = db.add_discover(&it, f.name, "news", topic, None, None, now).unwrap_or(false);
                    if is_new {
                        added += 1;
                    }
                    // New items get a picture, and older items saved before pictures existed are filled in.
                    if let (Some(img), true) = (&it.image_url, fetched < 15) {
                        if is_new || db.discover_needs_image(&it.url).unwrap_or(false) {
                            fetched += 1;
                            if let Some(data) = fetch_image(&c, img).await {
                                if db.set_discover_image(&it.url, &data).is_ok() {
                                    pictures += 1;
                                }
                            }
                        }
                    }
                }
            }
            Err(m) => failed.push(format!("{}: {}", f.name, m)),
        }
    }
    // GitHub: recently updated, well-starred repositories for each interest (at most 4 searches).
    let since = (Utc::now() - chrono::Duration::days(45)).format("%Y-%m-%d").to_string();
    for topic in interests.iter().take(6) {
        let slug: String = topic.to_lowercase().chars().map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' }).collect();
        let q = if TOPICS.iter().any(|(t, _)| t.eq_ignore_ascii_case(topic)) {
            format!("https://api.github.com/search/repositories?q=topic:{slug}+pushed:%3E{since}+stars:%3E200&sort=stars&order=desc&per_page=6")
        } else {
            // A skill of the user's own: search names, descriptions and topics for the words.
            let words: String = clean_interest(topic).split(' ').collect::<Vec<_>>().join("+");
            format!("https://api.github.com/search/repositories?q={words}+in:name,description,topics+pushed:%3E{since}+stars:%3E100&sort=stars&order=desc&per_page=6")
        };
        match get_text(&c, &q).await {
            Ok(body) => {
                for r in parse_repos(&body) {
                    if db.add_discover(&r.0, "GitHub", "repo", Some(topic.as_str()), r.1, r.2.as_deref(), now).unwrap_or(false) {
                        added += 1;
                        if let Some(img) = &r.0.image_url {
                            if let Some(data) = fetch_image(&c, img).await {
                                if db.set_discover_image(&r.0.url, &data).is_ok() {
                                    pictures += 1;
                                }
                            }
                        }
                    }
                }
            }
            Err(m) => failed.push(format!("GitHub ({topic}): {m}")),
        }
    }
    RefreshReport { added, pictures, failed }
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
            let avatar = r.get("owner").and_then(|o| o.get("avatar_url")).and_then(|a| a.as_str()).map(|a| format!("{a}{}s=200", if a.contains('?') { "&" } else { "?" })).and_then(|a| usable_image_url(&a));
            Some((Item { title: name, url, summary: desc, published_at: pushed, image_url: avatar }, r.get("stargazers_count").and_then(|s| s.as_i64()), r.get("language").and_then(|l| l.as_str()).map(String::from)))
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
        let mk = |t: &str, u: &str, days: i64| Item { title: t.into(), url: u.into(), summary: "s".into(), published_at: Some(now - days * 86_400_000), image_url: None };
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

    #[test]
    fn a_skill_the_user_adds_matches_whole_words_and_beats_the_fixed_topics() {
        let mine = vec!["Rust".to_string(), "Terraform".to_string(), "C#".to_string()];
        assert_eq!(match_interest("Why Rust is popular", "", &mine).as_deref(), Some("Rust"));
        assert_eq!(match_interest("Trust and safety", "frustrating", &mine), None); // not a whole word
        assert_eq!(match_interest("New terraform provider", "", &mine).as_deref(), Some("Terraform"));
        assert_eq!(match_interest("Learning C# records", "", &mine).as_deref(), Some("C#"));
        assert_eq!(clean_interest("  Rust <script>  & Go!! "), "Rust script Go");
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(&dir.path().join("t.sqlite")).unwrap();
        let now = 100 * 86_400_000i64;
        let it = |t: &str, u: &str| Item { title: t.into(), url: u.into(), summary: "s".into(), published_at: Some(now - 86_400_000), image_url: None };
        db.add_discover(&it("Rust async deep dive", "https://a.com/r"), "Kubernetes Blog", "news", None, None, None, now).unwrap();
        db.add_discover(&it("Pods explained", "https://a.com/p"), "Kubernetes Blog", "news", Some("Kubernetes"), None, None, now).unwrap();
        let list = db.list_discover(Some("news"), false, &["Rust".to_string()], now).unwrap();
        assert_eq!(list[0].title, "Rust async deep dive");
        assert_eq!(list[0].topic.as_deref(), Some("Rust"));
    }

    #[test]
    fn pictures_come_from_media_tags_enclosures_or_the_first_image_and_only_safe_ones_are_kept() {
        let xml = r#"<rss xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
          <item><title>One</title><link>https://a.com/1</link><media:content url="https://cdn.a.com/one.jpg" medium="image"/></item>
          <item><title>Two</title><link>https://a.com/2</link><enclosure url="https://cdn.a.com/two.png" type="image/png" length="1"/></item>
          <item><title>Three</title><link>https://a.com/3</link><enclosure url="https://cdn.a.com/pod.mp3" type="audio/mpeg"/><description><![CDATA[<p>Hi</p><img alt="x" src="https://cdn.a.com/three.webp" width="10">]]></description></item>
          <item><title>Four</title><link>https://a.com/4</link><content:encoded><![CDATA[<img src='https://cdn.a.com/four.jpg'>]]></content:encoded></item>
          <item><title>Five</title><link>https://a.com/5</link><media:thumbnail url="http://insecure.com/a.jpg"/></item>
          <item><title>Six</title><link>https://a.com/6</link><media:thumbnail url="https://localhost/a.jpg"/></item></channel></rss>"#;
        let imgs: Vec<Option<String>> = parse_feed(xml, 10).into_iter().map(|i| i.image_url).collect();
        assert_eq!(imgs, vec![
            Some("https://cdn.a.com/one.jpg".into()), Some("https://cdn.a.com/two.png".into()), Some("https://cdn.a.com/three.webp".into()),
            Some("https://cdn.a.com/four.jpg".into()), None, None]);
        assert_eq!(first_img("<p>no pictures</p>"), None);
        assert_eq!(usable_image_url("https://10.0.0.5/x.png"), None);
    }

    #[test]
    fn only_real_pictures_become_small_jpeg_thumbnails() {
        let mut png = Vec::new();
        let img = image::RgbImage::from_fn(1200, 800, |x, y| image::Rgb([(x % 255) as u8, (y % 255) as u8, 90]));
        image::DynamicImage::ImageRgb8(img).write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png).unwrap();
        let url = image_data_url(&png, 5_000_000).unwrap();
        assert!(url.starts_with("data:image/jpeg;base64,"));
        assert!(url.len() < 150_000, "thumbnail is {} bytes", url.len());
        assert_eq!(image_data_url(&png, 1000), None); // download too large
        assert_eq!(image_data_url(b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>", 1000), None);
        assert_eq!(image_data_url(b"<html>not an image at all</html>", 1000), None);
        let tiny = image::DynamicImage::ImageRgb8(image::RgbImage::new(8, 8));
        let mut t = Vec::new();
        tiny.write_to(&mut std::io::Cursor::new(&mut t), image::ImageFormat::Png).unwrap();
        assert_eq!(image_data_url(&t, 100_000), None); // too small to be a picture
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
                let with = items.iter().filter(|i| i.image_url.is_some()).count();
                let first = items.iter().find_map(|i| i.image_url.clone());
                let ok = match &first { Some(u) => fetch_image(&c, u).await.is_some(), None => false };
                eprintln!("{}: {} items, {} with a picture, first picture downloads: {}", f.name, items.len(), with, ok);
            }
            let body = get_text(&c, "https://api.github.com/search/repositories?q=topic:kubernetes+stars:%3E1000&sort=stars&per_page=3").await.unwrap();
            assert!(!parse_repos(&body).is_empty());
        });
    }
}
