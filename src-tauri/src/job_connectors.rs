//! Optional job discovery/enrichment adapters. Explicit user actions only.
//! API keys come from the OS credential store; provider responses are untrusted data.

use crate::{jobs::{Job, JobsReport}, secrets};
use serde_json::{json, Value};
use std::time::Duration;
use url::Url;

fn public_https(raw: &str) -> Result<String, String> {
    let url = Url::parse(raw.trim()).map_err(|_| "Enter a valid HTTPS job URL.")?;
    if url.scheme() != "https" || url.host_str().is_none() || !url.username().is_empty() || url.password().is_some() {
        return Err("Only public HTTPS job links are supported.".into());
    }
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    if host == "localhost" || host.ends_with(".localhost") || host.ends_with(".local") || host.ends_with(".internal")
        || host.parse::<std::net::IpAddr>().is_ok() {
        return Err("Private or IP-based URLs are not supported.".into());
    }
    Ok(url.to_string())
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder().timeout(Duration::from_secs(65))
        .connect_timeout(Duration::from_secs(8)).user_agent("Kinviva Job Copilot/0.1")
        .build().map_err(|_| "Could not initialize network client.".to_string())
}

fn key(name: &str, label: &str) -> Result<String, String> {
    secrets::get(name)?.filter(|s| !s.is_empty())
        .ok_or_else(|| format!("Add your {label} API key in Job Copilot first."))
}

/// Enrich one user-selected public job URL. The source page is processed by Firecrawl;
/// no resume text is sent. The returned Markdown is data, not instructions.
pub async fn firecrawl_job(url: &str) -> Result<String, String> {
    let url = public_https(url)?;
    let key = key("firecrawl_api_key", "Firecrawl")?;
    let response = client()?.post("https://api.firecrawl.dev/v2/scrape")
        .bearer_auth(key)
        .json(&json!({"url": url, "formats": ["markdown"], "onlyMainContent": true}))
        .send().await.map_err(|_| "Firecrawl request failed or timed out.".to_string())?;
    if !response.status().is_success() {
        return Err(format!("Firecrawl returned HTTP {}.", response.status().as_u16()));
    }
    let value: Value = response.json().await.map_err(|_| "Invalid Firecrawl response.".to_string())?;
    let text = value.pointer("/data/markdown").and_then(Value::as_str)
        .or_else(|| value.get("markdown").and_then(Value::as_str))
        .unwrap_or("").trim();
    if text.is_empty() { return Err("Firecrawl did not return page text.".into()); }
    Ok(text.chars().take(25_000).collect())
}

fn field(v: &Value, fields: &[&str]) -> String {
    fields.iter().find_map(|k| v.get(*k).and_then(Value::as_str).filter(|s| !s.trim().is_empty()))
        .unwrap_or("").trim().to_string()
}

/// Map common Actor result fields; Actors differ, so unmappable rows are discarded.
pub fn parse_apify_items(items: &Value) -> JobsReport {
    let mut report = JobsReport::default();
    let mut seen = std::collections::HashSet::new();
    if let Some(rows) = items.as_array() {
        for (i, row) in rows.iter().take(100).enumerate() {
            let title = field(row, &["title", "jobTitle", "position", "name"]);
            let company = field(row, &["company", "companyName", "employer"]);
            let raw_url = field(row, &["jobUrl", "url", "applyUrl", "link", "job_url"]);
            let Ok(url) = public_https(&raw_url) else { continue };
            if title.is_empty() || company.is_empty() || !seen.insert(url.clone()) { continue; }
            let location = field(row, &["location", "jobLocation", "city"]);
            let description = field(row, &["description", "jobDescription", "descriptionText", "text"]);
            let remote = row.get("remote").and_then(Value::as_bool).unwrap_or(false)
                || location.to_lowercase().contains("remote");
            report.jobs.push(Job {
                id: format!("Apify:{}", i),
                title, company, location, url,
                description: description.chars().take(6000).collect(),
                source: "Apify".into(), posted_ms: None, remote,
            });
        }
    }
    if report.jobs.is_empty() {
        report.errors.push("Actor returned no compatible jobs. Check its output fields (title, company, jobUrl).".into());
    }
    report
}

/// Run a user-selected, previously reviewed Actor. Actor inputs are provider-specific.
/// A hard provider-side cost cap is applied and only the first 50 rows are returned.
pub async fn apify_jobs(actor: &str, input: &str) -> Result<JobsReport, String> {
    let actor = actor.trim();
    if actor.len() > 120 || actor.is_empty()
        || !actor.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '~')) {
        return Err("Enter a valid Apify Actor ID (for example, owner~actor-name).".into());
    }
    if input.len() > 16_000 { return Err("Actor input is too large.".into()); }
    let payload: Value = serde_json::from_str(input).map_err(|_| "Actor input must be valid JSON.".to_string())?;
    if !payload.is_object() { return Err("Actor input must be a JSON object.".into()); }
    let key = key("apify_api_key", "Apify")?;
    let actor_url = format!("https://api.apify.com/v2/actors/{actor}/run-sync-get-dataset-items");
    let response = client()?.post(actor_url).bearer_auth(key)
        .query(&[("maxItems", "50"), ("maxTotalChargeUsd", "0.50"), ("limit", "50")])
        .json(&payload).send().await
        .map_err(|_| "Apify request failed or timed out. Check your Actor run in Apify Console before retrying.".to_string())?;
    if !response.status().is_success() {
        return Err(format!("Apify returned HTTP {}. Check the Actor configuration and run status in Apify Console.", response.status().as_u16()));
    }
    let rows: Value = response.json().await.map_err(|_| "Invalid Apify dataset response.".to_string())?;
    Ok(parse_apify_items(&rows))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reject_non_public_url() {
        assert!(public_https("http://example.com/job").is_err());
        assert!(public_https("https://127.0.0.1/job").is_err());
        assert!(public_https("https://example.com/job").is_ok());
    }
    #[test]
    fn actor_records_are_normalized_and_deduplicated() {
        let data = json!([{"title":"SRE","company":"Acme","jobUrl":"https://example.com/jobs/1"},
            {"title":"SRE","company":"Acme","jobUrl":"https://example.com/jobs/1"},
            {"title":"Missing URL","company":"Acme"}]);
        let report = parse_apify_items(&data);
        assert_eq!(report.jobs.len(), 1);
        assert_eq!(report.jobs[0].title, "SRE");
    }
}
