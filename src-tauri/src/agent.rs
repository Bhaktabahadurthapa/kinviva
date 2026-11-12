//! The job workspace's storage and its morning search.
//!
//! Storage: the resume, tracker, preferences and similar small records live in the app's SQLite
//! database (the `settings` table, under `jobs.<name>`), so they survive restarts and are not
//! kept only in the window's browser storage.
//!
//! Morning search: while Kinviva is running, once a day at the time the user chose it runs their
//! saved search, keeps the jobs not seen before, stores them as today's digest and shows a
//! notification. It never applies to anything and never sends anything. If Kinviva was closed or
//! the Mac was asleep at that time, it runs as soon as Kinviva is running again that day.

use crate::db::Db;
use crate::jobs::{Job, JobsQuery};
use serde::{Deserialize, Serialize};

type R<T> = Result<T, String>;

/// The only names the front end may read or write.
pub const KV_KEYS: &[&str] = &["resume", "apps", "prefs", "seen", "last", "digest", "skipped", "sendlog"];
const KV_MAX_BYTES: usize = 5_000_000;
const DIGEST_MAX: usize = 60;
const SEEN_MAX: usize = 5000;

pub fn kv_get(db: &Db, key: &str) -> R<Option<String>> {
    if !KV_KEYS.contains(&key) {
        return Err("Unknown storage name.".into());
    }
    db.get_setting(&format!("jobs.{key}"))
}

pub fn kv_set(db: &Db, key: &str, value: &str) -> R<()> {
    if !KV_KEYS.contains(&key) {
        return Err("Unknown storage name.".into());
    }
    if value.len() > KV_MAX_BYTES {
        return Err("That is too large to store.".into());
    }
    db.set_setting(&format!("jobs.{key}"), value)
}

/// "07:00" to (7, 0). Hours 0 to 23, minutes 0 to 59.
pub fn parse_hhmm(s: &str) -> Option<(u32, u32)> {
    let (h, m) = s.trim().split_once(':')?;
    let (h, m): (u32, u32) = (h.parse().ok()?, m.parse().ok()?);
    (h < 24 && m < 60).then_some((h, m))
}

/// Whether the morning search should run now: it is on, the chosen time has passed today, and it has not run today.
pub fn digest_due(enabled: bool, hhmm: &str, now_hour: u32, now_min: u32, last_day: Option<&str>, today: &str) -> bool {
    let Some((h, m)) = parse_hhmm(hhmm) else { return false };
    enabled && (now_hour, now_min) >= (h, m) && last_day != Some(today)
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Digest {
    pub day: String,
    pub at_ms: i64,
    /// Jobs found by this search that were not seen in an earlier search.
    pub jobs: Vec<Job>,
    /// How many jobs the search found in all.
    pub total: usize,
}

/// The search choices saved by the Jobs screen, turned into a query. Missing or odd values fall back to safe defaults.
pub fn query_from_prefs(json: &str) -> JobsQuery {
    let v: serde_json::Value = serde_json::from_str(json).unwrap_or(serde_json::Value::Null);
    let s = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
    let b = |k: &str, d: bool| v.get(k).and_then(|x| x.as_bool()).unwrap_or(d);
    JobsQuery {
        categories: v.get("categories").and_then(|c| c.as_array()).map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default(),
        keywords: s("keywords"),
        remote_only: b("remoteOnly", false),
        location: s("location").chars().take(80).collect(),
        include_remote: b("includeRemote", true),
        use_apify: b("useApify", false),
        boards: s("boards").split(['\n', ',', ';']).map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).take(12).collect(),
    }
}

/// Jobs not in `seen`, newest first, capped. With nothing seen yet, every job counts as new.
pub fn new_jobs(mut jobs: Vec<Job>, seen: &[String]) -> Vec<Job> {
    let old: std::collections::HashSet<&str> = seen.iter().map(String::as_str).collect();
    jobs.retain(|j| !old.contains(j.id.as_str()));
    jobs.sort_by_key(|j| std::cmp::Reverse(j.posted_ms.unwrap_or(0)));
    jobs.truncate(DIGEST_MAX);
    jobs
}

pub fn merge_seen(seen: &[String], jobs: &[Job]) -> Vec<String> {
    let mut out: Vec<String> = jobs.iter().map(|j| j.id.clone()).collect();
    for s in seen {
        if !out.contains(s) {
            out.push(s.clone());
        }
    }
    out.truncate(SEEN_MAX);
    out
}

/// Runs the saved search once and stores the digest. Needs a saved search (the user has opened Jobs and searched or set choices).
pub async fn run_digest(state: &crate::state::AppState, today: &str, now_ms: i64) -> R<Digest> {
    let prefs = kv_get(&state.db, "prefs")?.ok_or("Open Jobs and choose what to search for first.")?;
    let q = query_from_prefs(&prefs);
    if q.categories.is_empty() && q.keywords.trim().is_empty() && q.boards.is_empty() {
        return Err("Choose at least one job type, keyword or company board in Jobs first.".into());
    }
    let mut extra = Vec::new();
    let mut notes = Vec::new();
    if q.use_apify {
        match crate::commands::apify_jobs(state, &q).await {
            Ok(j) => extra = j,
            Err(e) => notes.push(e),
        }
    }
    let report = crate::jobs::search(&q, extra).await;
    let seen: Vec<String> = kv_get(&state.db, "seen")?.and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    let total = report.jobs.len();
    if total == 0 && !report.errors.is_empty() {
        return Err(format!("The morning search found nothing: {}", report.errors.join("; ")));
    }
    let fresh = new_jobs(report.jobs.clone(), &seen);
    kv_set(&state.db, "seen", &serde_json::to_string(&merge_seen(&seen, &report.jobs)).map_err(|e| e.to_string())?)?;
    let digest = Digest { day: today.to_string(), at_ms: now_ms, jobs: fresh, total };
    kv_set(&state.db, "digest", &serde_json::to_string(&digest).map_err(|e| e.to_string())?)?;
    Ok(digest)
}

/// A short macOS notification. Text is fixed by Kinviva (a count), never taken from a job listing.
pub fn notify(count: usize) {
    #[cfg(target_os = "macos")]
    {
        let text = if count == 0 { "No new jobs matched your search this morning.".to_string() } else { format!("{count} new job{} matched your search. Open Jobs to review.", if count == 1 { "" } else { "s" }) };
        let _ = std::process::Command::new("osascript").args(["-e", &format!("display notification \"{text}\" with title \"Kinviva\"")]).spawn();
    }
    #[cfg(not(target_os = "macos"))]
    let _ = count;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn job(id: &str, posted: Option<i64>) -> Job {
        Job { id: id.into(), title: id.into(), company: "Co".into(), location: String::new(), url: "https://x.io".into(), description: "d".into(), source: "s".into(), posted_ms: posted, remote: false }
    }

    #[test]
    fn storage_names_and_sizes_are_checked() {
        let db = Db::open_in_memory().unwrap();
        assert_eq!(kv_get(&db, "resume").unwrap(), None);
        kv_set(&db, "resume", "Jane Doe").unwrap();
        assert_eq!(kv_get(&db, "resume").unwrap().as_deref(), Some("Jane Doe"));
        kv_set(&db, "resume", "Jane Q Doe").unwrap();
        assert_eq!(kv_get(&db, "resume").unwrap().as_deref(), Some("Jane Q Doe"));
        assert!(kv_get(&db, "app").is_err());
        assert!(kv_set(&db, "../x", "v").is_err());
        assert!(kv_set(&db, "apps", &"x".repeat(KV_MAX_BYTES + 1)).is_err());
        // The app's own settings are not reachable through these names.
        assert_eq!(db.get_setting("app").unwrap(), None);
    }

    #[test]
    fn the_morning_search_runs_once_a_day_and_catches_up_late() {
        assert!(!digest_due(false, "07:00", 8, 0, None, "2026-11-12"));
        assert!(!digest_due(true, "07:00", 6, 59, None, "2026-11-12"));
        assert!(digest_due(true, "07:00", 7, 0, None, "2026-11-12"));
        assert!(digest_due(true, "07:00", 9, 30, Some("2026-11-11"), "2026-11-12"));
        assert!(!digest_due(true, "07:00", 9, 30, Some("2026-11-12"), "2026-11-12"));
        assert!(!digest_due(true, "25:99", 9, 30, None, "2026-11-12"));
        assert_eq!(parse_hhmm(" 7:05 "), Some((7, 5)));
        assert_eq!(parse_hhmm("noon"), None);
    }

    #[test]
    fn saved_choices_become_a_query() {
        let q = query_from_prefs(r#"{"categories":["devops","data"],"keywords":"k8s","remoteOnly":true,"location":"Austin, TX","includeRemote":false,"useApify":true,"boards":"greenhouse:stripe, lever:netflix\nashby:linear"}"#);
        assert_eq!(q.categories, vec!["devops", "data"]);
        assert!(q.remote_only && q.use_apify && !q.include_remote);
        assert_eq!(q.boards, vec!["greenhouse:stripe", "lever:netflix", "ashby:linear"]);
        let d = query_from_prefs("nonsense");
        assert!(d.categories.is_empty() && d.include_remote && !d.use_apify);
    }

    #[test]
    fn only_unseen_jobs_make_the_digest_newest_first() {
        let jobs = vec![job("a", Some(1)), job("b", Some(3)), job("c", Some(2))];
        let fresh = new_jobs(jobs.clone(), &["a".to_string()]);
        assert_eq!(fresh.iter().map(|j| j.id.as_str()).collect::<Vec<_>>(), vec!["b", "c"]);
        assert_eq!(new_jobs(jobs.clone(), &[]).len(), 3);
        assert_eq!(merge_seen(&["z".to_string(), "a".to_string()], &jobs), vec!["a", "b", "c", "z"]);
        let many: Vec<Job> = (0..100).map(|i| job(&format!("j{i}"), Some(i))).collect();
        assert_eq!(new_jobs(many, &[]).len(), DIGEST_MAX);
    }

    #[test]
    fn a_digest_survives_a_round_trip() {
        let d = Digest { day: "2026-11-12".into(), at_ms: 5, jobs: vec![job("a", None)], total: 9 };
        let back: Digest = serde_json::from_str(&serde_json::to_string(&d).unwrap()).unwrap();
        assert_eq!((back.day.as_str(), back.total, back.jobs[0].id.as_str()), ("2026-11-12", 9, "a"));
    }
}
