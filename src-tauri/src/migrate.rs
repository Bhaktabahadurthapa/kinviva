//! Moves an installation made under the old product name (MeetingLens) over to Kinviva the first time the new
//! app starts. The old data is copied, never moved or deleted, so nothing is lost if anything goes wrong.

use std::fs;
use std::path::{Path, PathBuf};

const NEW_DB: &str = "kinviva.sqlite";
const OLD_DB: &str = "meetinglens.sqlite";
const OLD_DIR: &str = "app.meetinglens.desktop";

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for e in fs::read_dir(from)? {
        let e = e?;
        let name = e.file_name();
        let target_name = match name.to_string_lossy().as_ref() {
            n if n == OLD_DB => NEW_DB.to_string(),
            n if n == format!("{OLD_DB}-wal") => format!("{NEW_DB}-wal"),
            n if n == format!("{OLD_DB}-shm") => format!("{NEW_DB}-shm"),
            n => n.to_string(),
        };
        let dest = to.join(target_name);
        if e.file_type()?.is_dir() {
            copy_dir(&e.path(), &dest)?;
        } else if !dest.exists() {
            fs::copy(e.path(), dest)?;
        }
    }
    Ok(())
}

/// Copies the old data folder into `new_dir` when this is the first start under the new name.
/// Returns true when something was copied.
pub fn migrate_legacy_data(new_dir: &Path, legacy_dir: &Path) -> std::io::Result<bool> {
    if new_dir.join(NEW_DB).exists() || !legacy_dir.join(OLD_DB).exists() {
        return Ok(false);
    }
    copy_dir(legacy_dir, new_dir)?;
    fs::write(new_dir.join("migrated-from-meetinglens.txt"), "This folder was copied from the old MeetingLens data folder. The old folder was left untouched.\n")?;
    Ok(true)
}

/// The database file to open: the new one, after copying the old data over if needed. If the copy fails,
/// the old database is opened where it is, so the user's data is never hidden.
pub fn choose_database(data_dir: &Path) -> PathBuf {
    let new_db = data_dir.join(NEW_DB);
    let legacy_dir = data_dir.parent().map(|p| p.join(OLD_DIR));
    if let Some(old) = legacy_dir.filter(|d| d != data_dir && std::env::var_os("KINVIVA_DATA_DIR").is_none() && std::env::var_os("MEETINGLENS_DATA_DIR").is_none()) {
        match migrate_legacy_data(data_dir, &old) {
            Ok(true) => eprintln!("migrated data from {}", old.display()),
            Ok(false) => {}
            Err(e) => {
                eprintln!("could not copy the old data folder ({e}); using it in place");
                if !new_db.exists() && old.join(OLD_DB).exists() {
                    return old.join(OLD_DB);
                }
            }
        }
    }
    new_db
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("kinviva-migrate-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn old_data_is_copied_under_the_new_names_and_left_in_place() {
        let root = temp("copy");
        let old = root.join("old");
        let new = root.join("new");
        fs::create_dir_all(old.join("tmp")).unwrap();
        fs::write(old.join(OLD_DB), b"db").unwrap();
        fs::write(old.join(format!("{OLD_DB}-wal")), b"wal").unwrap();
        fs::write(old.join("tmp").join("x.bin"), b"x").unwrap();
        assert!(migrate_legacy_data(&new, &old).unwrap());
        assert_eq!(fs::read(new.join(NEW_DB)).unwrap(), b"db");
        assert_eq!(fs::read(new.join(format!("{NEW_DB}-wal"))).unwrap(), b"wal");
        assert_eq!(fs::read(new.join("tmp").join("x.bin")).unwrap(), b"x");
        assert!(old.join(OLD_DB).exists(), "the old data stays where it was");
        // A second start does nothing, and never overwrites newer data.
        fs::write(new.join(NEW_DB), b"newer").unwrap();
        assert!(!migrate_legacy_data(&new, &old).unwrap());
        assert_eq!(fs::read(new.join(NEW_DB)).unwrap(), b"newer");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn nothing_happens_without_old_data() {
        let root = temp("none");
        assert!(!migrate_legacy_data(&root.join("new"), &root.join("old")).unwrap());
        assert!(!root.join("new").exists());
        let _ = fs::remove_dir_all(&root);
    }
}
