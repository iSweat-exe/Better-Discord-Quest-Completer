fn main() {
    println!("cargo:rerun-if-changed=runner.rc");
    println!("cargo:rerun-if-changed=assets/runner.manifest");
    println!("cargo:rerun-if-changed=assets/icon.ico");

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        embed_resource::compile("runner.rc", embed_resource::NONE)
            .manifest_required()
            .expect("could not embed the runner's icon and manifest");
    }
}
