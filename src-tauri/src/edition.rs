//! Which edition of Kinviva is running, and which features that edition offers.
//!
//! Only the Community Edition exists today. Pro and Business are planned: they are listed here so the rest of
//! the app can ask one question ("is this feature available?") instead of checking anything itself, but nothing
//! planned is switched on, shown in the app, or advertised as working. See docs/OPEN_CORE_PLAN.md.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Edition {
    Community,
}

/// Features that a future edition could add. Every feature that exists today is part of Community and has no entry here.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Feature {
    /// Planned (Pro): agent-driven technical investigations.
    AgentInvestigations,
    /// Planned (Pro): advanced diagram generation and reports.
    AdvancedReports,
    /// Planned (Pro): managed AI service.
    ManagedAi,
    /// Planned (Business): organization accounts and administration.
    Organizations,
}

/// The edition of this build.
pub const CURRENT: Edition = Edition::Community;

/// Whether a planned feature is available in this build. All of them are unavailable in the Community Edition.
pub fn is_available(_feature: Feature) -> bool {
    match CURRENT {
        Edition::Community => false,
    }
}

#[derive(Serialize)]
pub struct EditionInfo {
    pub edition: Edition,
    pub label: &'static str,
}

pub fn info() -> EditionInfo {
    EditionInfo { edition: CURRENT, label: "Community Edition" }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_community_edition_offers_no_planned_features() {
        for f in [Feature::AgentInvestigations, Feature::AdvancedReports, Feature::ManagedAi, Feature::Organizations] {
            assert!(!is_available(f), "{f:?} is planned and must not be switched on");
        }
        assert_eq!(info().label, "Community Edition");
        assert_eq!(serde_json::to_string(&info().edition).unwrap(), "\"community\"");
    }
}
