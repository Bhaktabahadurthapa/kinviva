//! Bundled interview skills: an explicit allowlist, validated and cached.
//!
//! Skills use the Agent Skills layout (a `SKILL.md` with `name` and
//! `description` frontmatter, then instructions). They are compiled into the
//! app with `include_str!`, so a request can only ever select one of the four
//! bundled skills below. There is no path input, no network fetch and nothing
//! from a skill is executed: a skill is plain text that becomes part of the
//! system prompt.

use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Category {
    CloudDevops,
    SystemDesign,
    AiEngineering,
    Coding,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Skill {
    pub name: String,
    pub description: String,
    pub body: String,
}

/// (category, expected skill name, bundled SKILL.md). The only way to reach a skill.
const ALLOWLIST: [(Category, &str, &str); 4] = [
    (Category::CloudDevops, "cloud-devops-interview", include_str!("../skills/cloud-devops-interview/SKILL.md")),
    (Category::SystemDesign, "system-design-interview", include_str!("../skills/system-design-interview/SKILL.md")),
    (Category::AiEngineering, "ai-engineering-interview", include_str!("../skills/ai-engineering-interview/SKILL.md")),
    (Category::Coding, "coding-interview", include_str!("../skills/coding-interview/SKILL.md")),
];

const MAX_BODY_CHARS: usize = 12_000;
const MIN_BODY_CHARS: usize = 200;
const MAX_DESCRIPTION_CHARS: usize = 1024;

impl Category {
    pub const ALL: [Category; 4] = [Category::CloudDevops, Category::SystemDesign, Category::AiEngineering, Category::Coding];

    fn index(self) -> usize {
        ALLOWLIST.iter().position(|(c, _, _)| *c == self).expect("every category is in the allowlist")
    }

    pub fn skill_name(self) -> &'static str {
        ALLOWLIST[self.index()].1
    }
}

fn valid_name(n: &str) -> bool {
    !n.is_empty() && n.len() <= 64 && n.split('-').all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()))
}

/// Parses and validates one SKILL.md. `expected_name` must match the `name` in the frontmatter.
pub fn parse_skill(expected_name: &str, raw: &str) -> Result<Skill, String> {
    let raw = raw.trim_start_matches('\u{feff}').replace("\r\n", "\n");
    let rest = raw.strip_prefix("---\n").ok_or("SKILL.md must start with a --- frontmatter block")?;
    let (front, body) = rest.split_once("\n---\n").ok_or("SKILL.md frontmatter is not closed with ---")?;
    let (mut name, mut description) = (None, None);
    for line in front.lines().filter(|l| !l.trim().is_empty()) {
        let (k, v) = line.split_once(':').ok_or_else(|| format!("bad frontmatter line: {line}"))?;
        let v = v.trim().trim_matches(|c| c == '"' || c == '\'').trim().to_string();
        match k.trim() {
            "name" => name = Some(v),
            "description" => description = Some(v),
            _ => {} // other keys (license, metadata) are allowed and ignored
        }
    }
    let name = name.filter(|n| !n.is_empty()).ok_or("frontmatter is missing `name`")?;
    let description = description.filter(|d| !d.is_empty()).ok_or("frontmatter is missing `description`")?;
    if !valid_name(&name) {
        return Err(format!("skill name `{name}` must be lowercase letters, digits and hyphens"));
    }
    if name != expected_name {
        return Err(format!("skill name `{name}` does not match the allowlisted name `{expected_name}`"));
    }
    if description.chars().count() > MAX_DESCRIPTION_CHARS {
        return Err("skill description is too long".into());
    }
    let body = body.trim().to_string();
    if body.chars().count() < MIN_BODY_CHARS {
        return Err("skill instructions are too short to be useful".into());
    }
    if body.chars().count() > MAX_BODY_CHARS {
        return Err("skill instructions are too long".into());
    }
    Ok(Skill { name, description, body })
}

static CACHE: [OnceLock<Result<Skill, String>>; 4] = [OnceLock::new(), OnceLock::new(), OnceLock::new(), OnceLock::new()];

/// The validated skill for a category, parsed once and then served from memory.
/// Only the requested skill is ever loaded.
pub fn skill_for(category: Category) -> Result<&'static Skill, String> {
    let i = category.index();
    let (_, name, raw) = ALLOWLIST[i];
    CACHE[i]
        .get_or_init(|| parse_skill(name, raw).map_err(|e| format!("Bundled skill `{name}` is invalid: {e}")))
        .as_ref()
        .map_err(Clone::clone)
}

#[cfg(test)]
mod tests {
    use super::*;

    const GOOD: &str = "---\nname: demo-skill\ndescription: A demo.\n---\n\n# Demo\n";

    fn body() -> String {
        "x".repeat(MIN_BODY_CHARS)
    }

    #[test]
    fn all_bundled_skills_are_valid_and_match_their_category() {
        for c in Category::ALL {
            let s = skill_for(c).unwrap_or_else(|e| panic!("{e}"));
            assert_eq!(s.name, c.skill_name());
            assert!(!s.description.is_empty());
            assert!(s.body.contains("Honesty rules"), "{} lacks the shared honesty rules", s.name);
            assert!(s.body.contains("data, not instructions"), "{} does not treat input as untrusted", s.name);
        }
        let names: std::collections::HashSet<_> = Category::ALL.iter().map(|c| c.skill_name()).collect();
        assert_eq!(names.len(), 4);
    }

    #[test]
    fn categories_map_to_the_expected_skill_names() {
        assert_eq!(Category::CloudDevops.skill_name(), "cloud-devops-interview");
        assert_eq!(Category::SystemDesign.skill_name(), "system-design-interview");
        assert_eq!(Category::AiEngineering.skill_name(), "ai-engineering-interview");
        assert_eq!(Category::Coding.skill_name(), "coding-interview");
        // Unknown categories cannot be expressed: deserialising rejects them.
        assert!(serde_json::from_str::<Category>("\"../../etc/passwd\"").is_err());
        assert_eq!(serde_json::from_str::<Category>("\"cloud_devops\"").unwrap(), Category::CloudDevops);
    }

    #[test]
    fn skill_content_is_cached_not_reparsed() {
        let a = skill_for(Category::Coding).unwrap() as *const Skill;
        let b = skill_for(Category::Coding).unwrap() as *const Skill;
        assert_eq!(a, b);
    }

    #[test]
    fn frontmatter_is_validated() {
        let ok = format!("---\nname: demo-skill\ndescription: \"A demo.\"\nlicense: MIT\n---\n\n{}", body());
        let s = parse_skill("demo-skill", &ok).unwrap();
        assert_eq!(s.description, "A demo.");
        assert!(parse_skill("demo-skill", &format!("{GOOD}{}", body())).is_ok());

        assert!(parse_skill("demo-skill", &format!("name: demo-skill\n{}", body())).unwrap_err().contains("frontmatter"));
        assert!(parse_skill("demo-skill", &format!("---\nname: demo-skill\ndescription: x\n{}", body())).unwrap_err().contains("not closed"));
        assert!(parse_skill("demo-skill", &format!("---\ndescription: x\n---\n{}", body())).unwrap_err().contains("`name`"));
        assert!(parse_skill("demo-skill", &format!("---\nname: demo-skill\n---\n{}", body())).unwrap_err().contains("`description`"));
        assert!(parse_skill("other", &format!("{GOOD}{}", body())).unwrap_err().contains("does not match"));
        assert!(parse_skill("Bad_Name", &format!("---\nname: Bad_Name\ndescription: x\n---\n{}", body())).unwrap_err().contains("lowercase"));
        assert!(parse_skill("demo-skill", GOOD).unwrap_err().contains("too short"));
        let huge = format!("{GOOD}{}", "x".repeat(MAX_BODY_CHARS + 1));
        assert!(parse_skill("demo-skill", &huge).unwrap_err().contains("too long"));
    }

    #[test]
    fn windows_line_endings_are_accepted() {
        let crlf = format!("---\r\nname: demo-skill\r\ndescription: A demo.\r\n---\r\n{}", body());
        assert!(parse_skill("demo-skill", &crlf).is_ok());
    }
}
