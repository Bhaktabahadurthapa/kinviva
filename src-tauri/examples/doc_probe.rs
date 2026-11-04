//! Developer probe: runs the app's document extractor on a file and prints
//! the elapsed time and extracted text length (and text with --print).
//!   cargo run --example doc_probe -- <file> [--print]
use std::time::Instant;
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let t = Instant::now();
    match meetinglens_lib::docs::extract(std::path::Path::new(&a[1])) {
        Ok(x) => {
            println!("OK {} ms, {} chars", t.elapsed().as_millis(), x.text.chars().count());
            if a.get(2).map(String::as_str) == Some("--print") {
                println!("{}", x.text);
            }
        }
        Err(e) => println!("ERR {} ms: {e}", t.elapsed().as_millis()),
    }
}
