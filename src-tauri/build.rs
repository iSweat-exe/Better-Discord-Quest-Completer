//! Build script: builds the Tauri app and compiles the placeholder-process
//! binary from `../runner`, which is then embedded into the executable.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    build_tauri();
    embed_runner();
}

/// Tauri's automatic manifest only reaches the application binary, while unit
/// tests link against Common Controls v6 too (through Tauri) and then fail to
/// load. We therefore embed the same manifest ourselves in every binary.
fn build_tauri() {
    let attributes = tauri_build::Attributes::new()
        .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
    tauri_build::try_build(attributes).expect("failed to run tauri-build");

    println!("cargo:rerun-if-changed=app.manifest");
    if env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        let manifest = env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR");
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{manifest}/app.manifest");
    }
}

fn embed_runner() {
    let manifest_dir = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let out_dir = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR"));
    let runner_dir = manifest_dir.join("../runner");

    for watched in ["src", "assets", "build.rs", "Cargo.toml", "runner.rc", ".cargo"] {
        println!("cargo:rerun-if-changed={}", runner_dir.join(watched).display());
    }

    let embedded = out_dir.join("dqc-runner.bin");

    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let built = build_runner(&runner_dir, &out_dir.join("runner-target"));
        fs::copy(&built, &embedded).expect("failed to copy the runner binary");
    } else {
        // The runner only exists for Windows; other platforms get an empty
        // payload and report `UnsupportedPlatform` at runtime.
        fs::write(&embedded, []).expect("failed to write the empty runner placeholder");
    }

    println!("cargo:rustc-env=DQC_RUNNER_PATH={}", embedded.display());
}

/// Builds the runner in its own target directory so it never contends with the
/// outer build for the target-dir lock.
fn build_runner(runner_dir: &Path, target_dir: &Path) -> PathBuf {
    let cargo = env::var_os("CARGO").unwrap_or_else(|| "cargo".into());
    let target = env::var("TARGET").expect("TARGET");

    let status = Command::new(cargo)
        .current_dir(runner_dir)
        .args(["build", "--release", "--locked", "--target", &target, "--target-dir"])
        .arg(target_dir)
        // The runner configures its own flags in `runner/.cargo/config.toml`.
        .env_remove("RUSTFLAGS")
        .env_remove("CARGO_ENCODED_RUSTFLAGS")
        .env_remove("RUSTC_WORKSPACE_WRAPPER")
        .status()
        .expect("failed to start cargo to build the runner");
    assert!(status.success(), "building the runner failed");

    target_dir.join(&target).join("release").join("dqc-runner.exe")
}
