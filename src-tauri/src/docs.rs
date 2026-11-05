//! Context documents: TXT, Markdown and PDF are converted to text, split into
//! overlapping chunks and indexed with SQLite FTS5. At request time the most
//! relevant chunks for the recent conversation are retrieved and included in
//! the prompt; the UI shows exactly which passages were used.

use std::path::Path;

pub const MAX_FILE_BYTES: u64 = 20 * 1024 * 1024;
const CHUNK_CHARS: usize = 900;
const OVERLAP_CHARS: usize = 150;

#[derive(Debug)]
pub struct Extracted {
    pub kind: String,
    pub text: String,
    /// PDF text per page (index 0 is page 1). Empty for text files.
    pub pages: Vec<String>,
}

pub fn extract(path: &Path) -> Result<Extracted, String> {
    let meta = std::fs::metadata(path).map_err(|e| format!("Cannot read file: {e}"))?;
    if meta.len() > MAX_FILE_BYTES {
        return Err(format!("File is larger than {} MB.", MAX_FILE_BYTES / 1024 / 1024));
    }
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let (kind, pages) = match ext.as_str() {
        "txt" | "text" => ("txt", vec![read_text(path)?]),
        "md" | "markdown" => ("md", vec![read_text(path)?]),
        "pdf" => ("pdf", extract_pdf(path)?),
        "docx" => ("docx", extract_docx(path)?),
        other => return Err(format!("Unsupported file type \".{other}\". Use .txt, .md, .pdf or .docx.")),
    };
    let pages: Vec<String> = pages.iter().map(|p| normalise(p)).collect();
    let text = pages.join("\n");
    if text.trim().is_empty() {
        return Err(if kind == "pdf" {
            "No text could be extracted from this PDF. It may be scanned images; OCR is not supported.".into()
        } else {
            "The file is empty.".into()
        });
    }
    // Only formats with real page boundaries get page numbers; a Word file does so
    // only when it contains page breaks (see `extract_docx`).
    let pages = if kind == "pdf" || (kind == "docx" && pages.len() > 1) { pages } else { Vec::new() };
    Ok(Extracted { kind: kind.into(), text, pages })
}

fn read_text(path: &Path) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("Cannot read file: {e}"))?;
    String::from_utf8(bytes).map_err(|_| "File is not valid UTF-8 text.".into())
}

/// Word (.docx) is a zip file; the text is in `word/document.xml`. Pages are
/// split at page breaks Word wrote into the file (explicit breaks and its
/// last-rendered markers), so page numbers are approximate. A document with no
/// breaks is cited by part instead.
fn extract_docx(path: &Path) -> Result<Vec<String>, String> {
    use std::io::Read;
    const MAX_XML_BYTES: u64 = 60 * 1024 * 1024;
    let file = std::fs::File::open(path).map_err(|e| format!("Cannot read file: {e}"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|_| "This file does not look like a Word (.docx) document.".to_string())?;
    let entry = zip.by_name("word/document.xml").map_err(|_| "This Word file has no document body (it may be an old .doc file or damaged).".to_string())?;
    if entry.size() > MAX_XML_BYTES {
        return Err("This Word document is too large to read.".into());
    }
    let mut xml = String::new();
    entry.take(MAX_XML_BYTES).read_to_string(&mut xml).map_err(|_| "Could not read the Word document text.".to_string())?;
    Ok(docx_pages(&xml))
}

fn xml_unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        let tail = &rest[i..];
        match tail.find(';').filter(|&e| e <= 8) {
            Some(e) => {
                let ent = &tail[1..e];
                let rep = match ent {
                    "amp" => Some('&'),
                    "lt" => Some('<'),
                    "gt" => Some('>'),
                    "quot" => Some('"'),
                    "apos" => Some('\''),
                    _ => ent
                        .strip_prefix('#')
                        .and_then(|n| n.strip_prefix('x').map(|h| u32::from_str_radix(h, 16).ok()).unwrap_or_else(|| n.parse().ok()))
                        .and_then(char::from_u32),
                };
                match rep {
                    Some(c) => out.push(c),
                    None => out.push_str(&tail[..=e]),
                }
                rest = &tail[e + 1..];
            }
            None => {
                out.push('&');
                rest = &tail[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// Text of a `document.xml`, one entry per page (split at page breaks).
fn docx_pages(xml: &str) -> Vec<String> {
    let mut pages = vec![String::new()];
    let mut i = 0;
    while let Some(off) = xml[i..].find('<') {
        let start = i + off;
        let Some(end) = xml[start..].find('>').map(|e| start + e) else { break };
        let tag = &xml[start + 1..end];
        let closing = tag.starts_with('/');
        let name = tag.trim_start_matches('/').split(|c: char| c.is_whitespace() || c == '/').next().unwrap_or("");
        let cur = pages.last_mut().unwrap();
        match name {
            "w:t" if !closing && !tag.ends_with('/') => {
                let close = xml[end + 1..].find("</w:t>").map(|c| end + 1 + c).unwrap_or(xml.len());
                cur.push_str(&xml_unescape(&xml[end + 1..close]));
                i = close;
                continue;
            }
            "w:tab" if !closing => cur.push(' '),
            "w:br" if !closing && tag.contains("w:type=\"page\"") => pages.push(String::new()),
            "w:br" if !closing => cur.push('\n'),
            "w:lastRenderedPageBreak" if !closing => pages.push(String::new()),
            "w:p" if closing => cur.push('\n'),
            _ => {}
        }
        i = end + 1;
    }
    // A break right after a paragraph can leave an empty page; drop empties but keep order.
    pages.into_iter().filter(|p| !p.trim().is_empty()).collect()
}

fn extract_pdf(path: &Path) -> Result<Vec<String>, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("Cannot read file: {e}"))?;
    if !bytes.starts_with(b"%PDF") {
        return Err("This file does not look like a PDF.".into());
    }
    // The PDF parser can panic on malformed input; contain it.
    let result = std::panic::catch_unwind(|| pdf_extract::extract_text_from_mem_by_pages(&bytes));
    match result {
        Ok(Ok(text)) => Ok(text),
        Ok(Err(e)) => Err(format!("Could not extract text from PDF (it may be encrypted or damaged): {e}")),
        Err(_) => Err("Could not extract text from PDF: the parser failed on this file.".into()),
    }
}

fn normalise(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut blank = 0;
    for line in text.lines() {
        let l = line.split_whitespace().collect::<Vec<_>>().join(" ");
        if l.is_empty() {
            blank += 1;
            if blank == 1 {
                out.push('\n');
            }
        } else {
            blank = 0;
            out.push_str(&l);
            out.push('\n');
        }
    }
    out
}

/// Chunks tagged with the page they came from (PDFs) or `None` (text files).
/// A chunk never spans two pages, so every passage has one citable page.
pub fn chunk_pages(x: &Extracted) -> Vec<(Option<i64>, String)> {
    if x.pages.is_empty() {
        return chunk(&x.text).into_iter().map(|c| (None, c)).collect();
    }
    x.pages
        .iter()
        .enumerate()
        .flat_map(|(i, p)| chunk(p).into_iter().map(move |c| (Some(i as i64 + 1), c)))
        .collect()
}

/// Split into ~CHUNK_CHARS pieces on paragraph/sentence boundaries with overlap.
pub fn chunk(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut chunks = Vec::new();
    let mut start = 0;
    while start < chars.len() {
        let mut end = (start + CHUNK_CHARS).min(chars.len());
        if end < chars.len() {
            // Prefer to break at a paragraph, then sentence, then space.
            let window: String = chars[start..end].iter().collect();
            let cut = window
                .rfind("\n\n")
                .or_else(|| window.rfind(". "))
                .or_else(|| window.rfind(' '))
                .filter(|&i| i > CHUNK_CHARS / 2);
            if let Some(i) = cut {
                end = start + window[..i + 1].chars().count();
            }
        }
        let piece: String = chars[start..end].iter().collect::<String>().trim().to_string();
        if !piece.is_empty() {
            chunks.push(piece);
        }
        if end >= chars.len() {
            break;
        }
        start = end.saturating_sub(OVERLAP_CHARS).max(start + 1);
    }
    chunks
}

const STOP: &[&str] = &[
    "the", "and", "for", "are", "but", "not", "you", "your", "with", "this", "that", "have", "has",
    "was", "were", "they", "them", "what", "when", "where", "which", "who", "why", "how", "can",
    "could", "would", "should", "will", "just", "about", "there", "their", "from", "into", "then",
    "than", "also", "some", "any", "all", "our", "out", "its", "it's", "i'm", "we're", "yes",
    "yeah", "okay", "really", "like", "know", "think", "going", "want", "tell", "said", "say",
    "maybe", "well", "very", "more", "much", "been", "being", "does", "did", "doing", "his", "her",
    "she", "him", "had", "get", "got", "let", "me", "still", "speaking", "incomplete",
];

/// Build an FTS5 OR-query from the salient words of `text` (newest words
/// weighted by keeping them). Every term is quoted so user text cannot inject
/// FTS syntax.
pub fn fts_query(text: &str, max_terms: usize) -> String {
    let mut seen = std::collections::HashSet::new();
    let mut terms = Vec::new();
    for w in text.split(|c: char| !c.is_alphanumeric()).rev() {
        let w = w.to_lowercase();
        if w.len() < 3 || STOP.contains(&w.as_str()) || w.chars().all(|c| c.is_numeric()) {
            continue;
        }
        if seen.insert(w.clone()) {
            terms.push(format!("\"{w}\""));
            if terms.len() >= max_terms {
                break;
            }
        }
    }
    terms.join(" OR ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn chunks_cover_text_with_overlap() {
        let para = "Sentence number one is here. ".repeat(100);
        let c = chunk(&para);
        assert!(c.len() > 2);
        assert!(c.iter().all(|x| x.chars().count() <= CHUNK_CHARS));
        // overlap: end of chunk 0 appears at start region of chunk 1
        let tail: String = c[0].chars().rev().take(40).collect::<Vec<_>>().into_iter().rev().collect();
        assert!(c[1].contains(tail.trim()));
    }

    #[test]
    fn short_text_is_single_chunk() {
        assert_eq!(chunk("hello world"), vec!["hello world".to_string()]);
    }

    #[test]
    fn query_drops_stopwords_and_quotes_terms() {
        let q = fts_query("Them: What is your experience with Kubernetes and \"Terraform\" OR NEAR?", 8);
        assert!(q.contains("\"kubernetes\""));
        assert!(q.contains("\"terraform\""));
        assert!(!q.contains("\"what\""));
        assert!(q.contains("\"near\""));
        assert_eq!(fts_query("the and you", 8), "");
    }

    #[test]
    fn extracts_txt_and_md_and_rejects_others() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("notes.md");
        std::fs::File::create(&p).unwrap().write_all(b"# Title\n\n\n\nBody   text").unwrap();
        let x = extract(&p).unwrap();
        assert_eq!(x.kind, "md");
        assert_eq!(x.text, "# Title\n\nBody text\n");
        let bad = dir.path().join("a.xlsx");
        std::fs::write(&bad, b"x").unwrap();
        assert!(extract(&bad).unwrap_err().contains("Unsupported"));
        let empty = dir.path().join("e.txt");
        std::fs::write(&empty, b"   \n").unwrap();
        assert!(extract(&empty).unwrap_err().contains("empty"));
    }

    #[test]
    fn invalid_pdf_reports_clear_error() {
        let dir = tempfile::tempdir().unwrap();
        let fake = dir.path().join("fake.pdf");
        std::fs::write(&fake, b"hello").unwrap();
        assert!(extract(&fake).unwrap_err().contains("does not look like a PDF"));
        let broken = dir.path().join("broken.pdf");
        std::fs::write(&broken, b"%PDF-1.4\n garbage garbage").unwrap();
        let err = extract(&broken).unwrap_err();
        assert!(err.contains("Could not extract text from PDF"), "{err}");
    }

    #[test]
    fn pdf_chunks_keep_their_page_and_never_span_pages() {
        let x = Extracted { kind: "pdf".into(), text: String::new(), pages: vec!["First page text.".into(), String::new(), "Third page text. ".repeat(120)] };
        let chunks = chunk_pages(&x);
        assert_eq!(chunks[0], (Some(1), "First page text.".to_string()));
        assert!(chunks.iter().skip(1).all(|(p, _)| *p == Some(3)), "empty page 2 gives no chunk");
        assert!(chunks.len() > 2, "a long page is split into several chunks of the same page");
        let text_file = Extracted { kind: "md".into(), text: "Some notes".into(), pages: vec![] };
        assert_eq!(chunk_pages(&text_file), vec![(None, "Some notes".to_string())]);
    }

    fn make_docx(path: &Path, body: &str) {
        use std::io::Write as _;
        let mut z = zip::ZipWriter::new(std::fs::File::create(path).unwrap());
        let opts = zip::write::SimpleFileOptions::default();
        z.start_file("word/document.xml", opts).unwrap();
        z.write_all(format!("<?xml version=\"1.0\"?><w:document><w:body>{body}</w:body></w:document>").as_bytes()).unwrap();
        z.finish().unwrap();
    }

    #[test]
    fn docx_text_is_extracted_with_entities_tabs_and_paragraphs() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("lecture.docx");
        make_docx(&p, "<w:p><w:r><w:t>Round robin &amp; priority</w:t></w:r></w:p><w:p><w:r><w:t xml:space=\"preserve\">Quantum </w:t><w:tab/><w:t>10 ms &lt; 50 ms</w:t></w:r></w:p>");
        let x = extract(&p).unwrap();
        assert_eq!(x.kind, "docx");
        assert_eq!(x.text, "Round robin & priority\nQuantum 10 ms < 50 ms\n");
        assert!(x.pages.is_empty(), "no page breaks: cited by part, not by page");
        let chunks = chunk_pages(&x);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].0, None);
    }

    #[test]
    fn docx_page_breaks_give_page_numbers() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("slides.docx");
        make_docx(
            &p,
            "<w:p><w:r><w:t>Page one</w:t></w:r></w:p><w:p><w:r><w:br w:type=\"page\"/><w:t>Page two</w:t></w:r></w:p><w:p><w:r><w:lastRenderedPageBreak/><w:t>Page three</w:t></w:r></w:p>",
        );
        let x = extract(&p).unwrap();
        assert_eq!(x.pages.len(), 3);
        let chunks = chunk_pages(&x);
        assert_eq!(chunks.iter().map(|c| c.0).collect::<Vec<_>>(), vec![Some(1), Some(2), Some(3)]);
        assert_eq!(chunks[1].1, "Page two");
    }

    #[test]
    fn bad_docx_files_report_clear_errors() {
        let dir = tempfile::tempdir().unwrap();
        let fake = dir.path().join("fake.docx");
        std::fs::write(&fake, b"not a zip").unwrap();
        assert!(extract(&fake).unwrap_err().contains("does not look like a Word"));
        let other = dir.path().join("other.docx");
        {
            use std::io::Write as _;
            let mut z = zip::ZipWriter::new(std::fs::File::create(&other).unwrap());
            z.start_file("hello.txt", zip::write::SimpleFileOptions::default()).unwrap();
            z.write_all(b"x").unwrap();
            z.finish().unwrap();
        }
        assert!(extract(&other).unwrap_err().contains("no document body"));
        let empty = dir.path().join("empty.docx");
        make_docx(&empty, "<w:p/>");
        assert!(extract(&empty).unwrap_err().contains("empty"));
    }

    #[test]
    fn xml_entities_decode_safely() {
        assert_eq!(xml_unescape("a &amp; b &#65;&#x42; &unknown; &"), "a & b AB &unknown; &");
    }
}
