fn main() {
    // ScreenCaptureKit bindings are Swift; binaries and test executables need
    // the OS Swift runtime on their rpath.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    }
    tauri_build::build()
}
