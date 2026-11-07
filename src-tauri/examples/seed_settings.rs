//! Developer tool: creates a Kinviva database (running the real
//! migrations) in `<dir>` and stores the given settings JSON in it. Used to
//! give an isolated test copy of the app a known configuration.
//!   cargo run --example seed_settings -- <dir> '<settings json>'
use kinviva_lib::db::Db;
use kinviva_lib::settings::Settings;

fn main() {
    let a: Vec<String> = std::env::args().collect();
    std::fs::create_dir_all(&a[1]).expect("create data dir");
    let db = Db::open(&std::path::Path::new(&a[1]).join("kinviva.sqlite")).expect("open db");
    // Parse through the real struct so a typo in a field name fails loudly.
    let settings: Settings = serde_json::from_str(&a[2]).expect("settings json");
    db.set_setting("app", &serde_json::to_string(&settings).unwrap()).expect("save");
    println!("seeded {} (provider: {})", a[1], settings.stt_provider);
}
