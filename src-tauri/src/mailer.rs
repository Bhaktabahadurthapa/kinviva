//! Sending an application by email, only after the user has approved that exact message.
//!
//! The message goes through the user's own mail account (their SMTP server and password, kept in
//! the credential store). Kinviva never sends on its own: every send is one command the user
//! confirmed, it stops at a daily cap, refuses to send the same application twice, and records
//! each send in a local log. There is no sending to job sites' forms; this is email only.

use lettre::message::header::ContentType;
use lettre::message::{Attachment, Mailbox, MultiPart, SinglePart};
use lettre::transport::smtp::authentication::Credentials;
use lettre::{Address, Message, SmtpTransport, Transport};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Tls {
    /// Port 465: encrypted from the start.
    Implicit,
    /// Port 587 and most others: upgrade to encrypted before logging in.
    StartTls,
    /// Plain text. Only allowed for a server on this computer (used by tests).
    None,
}

#[derive(Debug, Clone)]
pub struct SmtpCfg {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: String,
    pub tls: Tls,
}

impl SmtpCfg {
    pub fn new(host: &str, port: u16, user: &str, password: &str) -> Result<Self, String> {
        let host = host.trim();
        if host.is_empty() || host.len() > 253 || !host.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-') {
            return Err("Add your mail server in Settings → Job applications (for example smtp.gmail.com).".into());
        }
        if user.trim().is_empty() || password.is_empty() {
            return Err("Add your mail user name and password in Settings → Job applications.".into());
        }
        let tls = if port == 465 { Tls::Implicit } else { Tls::StartTls };
        Ok(SmtpCfg { host: host.to_string(), port, user: user.trim().to_string(), password: password.to_string(), tls })
    }
}

/// A plain email address, or None.
pub fn parse_address(s: &str) -> Option<Address> {
    let t = s.trim();
    (t.len() <= 254 && !t.contains(['\r', '\n', ',', ';', '<', '>', ' ']) && t.matches('@').count() == 1).then(|| t.parse::<Address>().ok()).flatten()
}

/// Email addresses mentioned in a job description, so the application can go to the address the posting names.
pub fn find_emails(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for w in text.split(|c: char| c.is_whitespace() || matches!(c, '<' | '>' | '(' | ')' | '[' | ']' | ',' | ';' | '"' | '\'')) {
        let w = w.trim_matches(|c: char| matches!(c, '.' | ':' | '!' | '?')).trim_start_matches("mailto:");
        if w.contains('@') {
            if let Some(a) = parse_address(w) {
                let a = a.to_string();
                if !out.contains(&a) && out.len() < 5 {
                    out.push(a);
                }
            }
        }
    }
    out
}

fn clean_line(s: &str, max: usize) -> String {
    s.chars().filter(|c| !c.is_control()).take(max).collect::<String>().trim().to_string()
}

pub fn safe_filename(s: &str) -> String {
    let t: String = s.chars().map(|c| if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.') { c } else { '_' }).collect();
    t.trim_matches('.').chars().take(80).collect()
}

const DOCX: &str = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/// The message: a plain-text body and Word attachments. Header values are cleaned so nothing can add extra headers.
pub fn build_message(from_name: &str, from_email: &str, to: &str, subject: &str, body: &str, attachments: &[(String, Vec<u8>)]) -> Result<Message, String> {
    let from_addr = parse_address(from_email).ok_or("Your sender email address in Settings → Job applications is not valid.")?;
    let to_addr = parse_address(to).ok_or("The recipient email address is not valid.")?;
    let subject = clean_line(subject, 200);
    if subject.is_empty() {
        return Err("Add a subject.".into());
    }
    if body.trim().is_empty() {
        return Err("The message is empty.".into());
    }
    let name = clean_line(from_name, 80);
    let mut parts = MultiPart::mixed().singlepart(SinglePart::plain(body.to_string()));
    for (file, bytes) in attachments {
        parts = parts.singlepart(Attachment::new(safe_filename(file)).body(bytes.clone(), ContentType::parse(DOCX).map_err(|e| e.to_string())?));
    }
    Message::builder()
        .from(Mailbox::new(if name.is_empty() { None } else { Some(name) }, from_addr))
        .to(Mailbox::new(None, to_addr))
        .subject(subject)
        .multipart(parts)
        .map_err(|e| format!("Could not build the message: {e}"))
}

/// Sends one message. Blocking: call it from a blocking thread. Errors never contain the password.
pub fn send(cfg: &SmtpCfg, msg: &Message) -> Result<(), String> {
    let local = cfg.host == "127.0.0.1" || cfg.host == "localhost";
    if cfg.tls == Tls::None && !local {
        return Err("Unencrypted mail is only allowed for a server on this computer.".into());
    }
    let builder = match cfg.tls {
        Tls::Implicit => SmtpTransport::relay(&cfg.host).map_err(|e| e.to_string())?,
        Tls::StartTls => SmtpTransport::starttls_relay(&cfg.host).map_err(|e| e.to_string())?,
        Tls::None => SmtpTransport::builder_dangerous(&cfg.host),
    };
    let mut b = builder.port(cfg.port).timeout(Some(std::time::Duration::from_secs(30)));
    if cfg.tls != Tls::None {
        b = b.credentials(Credentials::new(cfg.user.clone(), cfg.password.clone()));
    }
    match b.build().send(msg) {
        Ok(_) => Ok(()),
        Err(e) => {
            let t = e.to_string();
            Err(if t.to_lowercase().contains("authentication") || t.contains("535") {
                "The mail server rejected your user name or password. Gmail and some others need an app password.".to_string()
            } else {
                format!("Could not send: {}", t.replace(&cfg.password, "***"))
            })
        }
    }
}

// ---- Send log and daily cap ----

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendEntry {
    pub app_id: String,
    pub to: String,
    pub subject: String,
    pub day: String,
    pub at_ms: i64,
}

pub fn parse_log(raw: Option<&str>) -> Vec<SendEntry> {
    raw.and_then(|t| serde_json::from_str(t).ok()).unwrap_or_default()
}

pub fn sent_today(log: &[SendEntry], day: &str) -> u32 {
    log.iter().filter(|e| e.day == day).count() as u32
}

/// Whether one more application may be sent: under today's cap and not already sent.
pub fn may_send(log: &[SendEntry], app_id: &str, day: &str, cap: u32) -> Result<(), String> {
    if log.iter().any(|e| e.app_id == app_id) {
        return Err("This application was already sent. Kinviva does not send the same application twice.".into());
    }
    let n = sent_today(log, day);
    if n >= cap {
        return Err(format!("You have reached today's limit of {cap} sent applications. Raise it in Settings → Job applications, or send more tomorrow."));
    }
    Ok(())
}

/// The log with one more entry, newest first, keeping the last 500.
pub fn with_entry(mut log: Vec<SendEntry>, e: SendEntry) -> Vec<SendEntry> {
    log.insert(0, e);
    log.truncate(500);
    log
}

pub fn attachments(resume_docx: Vec<u8>, resume_name: &str, letter_docx: Option<Vec<u8>>, letter_name: &str) -> Vec<(String, Vec<u8>)> {
    let mut v = vec![(format!("{}.docx", safe_filename(resume_name)), resume_docx)];
    if let Some(l) = letter_docx {
        v.push((format!("{}.docx", safe_filename(letter_name)), l));
    }
    v
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::TcpListener;

    /// A tiny SMTP server on this computer that accepts one message and hands back the text it received.
    async fn fake_smtp() -> (u16, tokio::task::JoinHandle<String>) {
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        let h = tokio::spawn(async move {
            let (sock, _) = l.accept().await.unwrap();
            let (r, mut w) = sock.into_split();
            let mut r = BufReader::new(r);
            w.write_all(b"220 fake ESMTP\r\n").await.unwrap();
            let mut data = String::new();
            let mut in_data = false;
            let mut line = String::new();
            loop {
                line.clear();
                if r.read_line(&mut line).await.unwrap_or(0) == 0 {
                    break;
                }
                if in_data {
                    if line == ".\r\n" {
                        in_data = false;
                        w.write_all(b"250 queued\r\n").await.unwrap();
                    } else {
                        data.push_str(&line);
                    }
                    continue;
                }
                let up = line.to_uppercase();
                if up.starts_with("EHLO") || up.starts_with("HELO") {
                    w.write_all(b"250 fake\r\n").await.unwrap();
                } else if up.starts_with("DATA") {
                    in_data = true;
                    w.write_all(b"354 go\r\n").await.unwrap();
                } else if up.starts_with("QUIT") {
                    w.write_all(b"221 bye\r\n").await.unwrap();
                    break;
                } else {
                    w.write_all(b"250 ok\r\n").await.unwrap();
                }
            }
            data
        });
        (port, h)
    }

    #[test]
    fn addresses_are_checked_and_found_in_postings() {
        assert!(parse_address("jobs@example.com").is_some());
        for bad in ["jobs@", "a b@x.io", "x@y.io,z@y.io", "x@y.io\r\nBcc: z@y.io", "<x@y.io>", "nope", "a@b@c.io"] {
            assert!(parse_address(bad).is_none(), "{bad}");
        }
        assert_eq!(find_emails("To apply, email careers@acme.com. Or (hr@beta.io) or mailto:hi@gamma.org!"), vec!["careers@acme.com", "hr@beta.io", "hi@gamma.org"]);
        assert!(find_emails("no address here, just 100% remote @home").is_empty());
    }

    #[test]
    fn the_message_has_clean_headers_and_word_attachments() {
        let m = build_message("Jane\r\nBcc: evil@x.io", "jane@example.com", "careers@acme.com", "Application\r\nBcc: evil@x.io", "Hello", &[("Jane Doe resume.docx".into(), b"PKdata".to_vec())]).unwrap();
        let raw = String::from_utf8_lossy(&m.formatted()).to_string();
        assert!(raw.contains("To: careers@acme.com") && raw.contains("Subject:") && !raw.contains("\r\nBcc:"));
        assert!(raw.contains("Jane_Doe_resume.docx") && raw.contains("wordprocessingml"));
        assert!(build_message("J", "bad", "a@b.io", "s", "b", &[]).is_err());
        assert!(build_message("J", "j@x.io", "bad", "s", "b", &[]).is_err());
        assert!(build_message("J", "j@x.io", "a@b.io", "  ", "b", &[]).is_err());
        assert!(build_message("J", "j@x.io", "a@b.io", "s", " ", &[]).is_err());
    }

    #[test]
    fn the_daily_cap_and_the_no_duplicates_rule() {
        let e = |id: &str, day: &str| SendEntry { app_id: id.into(), to: "a@b.io".into(), subject: "s".into(), day: day.into(), at_ms: 1 };
        let log = vec![e("a", "2026-11-12"), e("b", "2026-11-12"), e("c", "2026-11-11")];
        assert_eq!(sent_today(&log, "2026-11-12"), 2);
        assert!(may_send(&log, "d", "2026-11-12", 3).is_ok());
        assert!(may_send(&log, "d", "2026-11-12", 2).unwrap_err().contains("limit of 2"));
        assert!(may_send(&log, "d", "2026-11-12", 0).is_err());
        assert!(may_send(&log, "a", "2026-11-13", 9).unwrap_err().contains("twice"));
        let big = (0..600).fold(Vec::new(), |l, i| with_entry(l, e(&format!("x{i}"), "d")));
        assert_eq!(big.len(), 500);
        assert_eq!(big[0].app_id, "x599");
        assert!(parse_log(Some("junk")).is_empty() && parse_log(None).is_empty());
    }

    #[test]
    fn server_settings_are_validated() {
        assert!(SmtpCfg::new("", 587, "u", "p").is_err());
        assert!(SmtpCfg::new("smtp.example.com/evil", 587, "u", "p").is_err());
        assert!(SmtpCfg::new("smtp.example.com", 587, "", "p").is_err());
        assert!(SmtpCfg::new("smtp.example.com", 587, "u", "").is_err());
        assert_eq!(SmtpCfg::new("smtp.example.com", 465, "u", "p").unwrap().tls, Tls::Implicit);
        assert_eq!(SmtpCfg::new("smtp.example.com", 587, "u", "p").unwrap().tls, Tls::StartTls);
        let mut c = SmtpCfg::new("mail.example.com", 25, "u", "p").unwrap();
        c.tls = Tls::None;
        let m = build_message("J", "j@x.io", "a@b.io", "s", "b", &[]).unwrap();
        assert!(send(&c, &m).unwrap_err().contains("only allowed for a server on this computer"));
    }

    #[tokio::test]
    async fn a_message_reaches_a_local_server_with_its_attachments() {
        let (port, server) = fake_smtp().await;
        let cfg = SmtpCfg { host: "127.0.0.1".into(), port, user: "u".into(), password: "secret-pw".into(), tls: Tls::None };
        let atts = attachments(b"PK-resume".to_vec(), "Jane Doe resume", Some(b"PK-letter".to_vec()), "Jane Doe cover letter");
        let m = build_message("Jane Doe", "jane@example.com", "careers@acme.com", "Application: SRE", "Dear Hiring Team,\n\nHello.", &atts).unwrap();
        let sent = tokio::task::spawn_blocking(move || send(&cfg, &m)).await.unwrap();
        assert_eq!(sent, Ok(()));
        let got = server.await.unwrap();
        assert!(got.contains("Subject: Application: SRE") && got.contains("To: careers@acme.com") && got.contains("Jane_Doe_resume.docx") && got.contains("Jane_Doe_cover_letter.docx"));
        assert!(!got.contains("secret-pw"));
    }
}
