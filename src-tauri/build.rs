fn main() {
    #[cfg(target_os = "macos")]
    {
        println!("cargo:rerun-if-changed=src/vault_keychain.m");
        println!("cargo:rerun-if-changed=src/mini_window.m");
        cc::Build::new()
            .file("src/vault_keychain.m")
            .file("src/mini_window.m")
            .flag("-fobjc-arc")
            .flag("-fblocks")
            .compile("faro_vault_keychain");
        println!("cargo:rustc-link-lib=framework=LocalAuthentication");
        println!("cargo:rustc-link-lib=framework=Security");
        println!("cargo:rustc-link-lib=framework=AppKit");
        println!("cargo:rustc-link-lib=framework=AVFoundation");
    }
    tauri_build::build()
}
