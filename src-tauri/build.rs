fn main() {
    // Tauri embeds the platform icon in the native binary. Track the generated
    // resources explicitly so an icon-only redesign cannot reuse a stale build.
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/icon.icns");
    println!("cargo:rerun-if-changed=icons/icon.png");
    tauri_build::build()
}
