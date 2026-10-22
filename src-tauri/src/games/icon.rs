//! The icon of a game, kept on disk so that the fake game's taskbar button can
//! show the game instead of this app.
//!
//! Discord's CDN serves the icon as one big PNG. Windows would stretch it to the
//! size it needs, and does it badly, so it is resized here once, with a proper
//! filter, to every size the taskbar, the title bar and the tray can ask for,
//! and written as a single `.ico`. A game without an icon, or an icon that
//! cannot be fetched, simply leaves the runner with its own.

use std::path::{Path, PathBuf};
use std::time::Duration;

use image::codecs::ico::{IcoEncoder, IcoFrame};
use image::imageops::FilterType;
use image::{ExtendedColorType, ImageFormat};

use crate::error::{AppError, AppResult};
use crate::games::model::{Game, is_valid_game_id};
use crate::http;
use crate::util::spawn_blocking;

const CDN: &str = "https://cdn.discordapp.com/app-icons";
/// The biggest image of the icon, and the one every smaller size is made from.
const SOURCE_SIZE: u32 = 256;
/// One image per size Windows asks for at 100 % to 300 % display scaling.
const SIZES: [u32; 12] = [16, 20, 24, 28, 32, 40, 48, 56, 64, 96, 128, 256];
const MAX_BYTES: usize = 2 * 1024 * 1024;
/// Starting the game must not wait long for a decoration.
const TIMEOUT: Duration = Duration::from_secs(6);
const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

/// Hashes are hexadecimal; anything else would not be a name to put in a URL or a path.
fn is_icon_hash(hash: &str) -> bool {
    !hash.is_empty() && hash.len() <= 64 && hash.bytes().all(|byte| byte.is_ascii_alphanumeric())
}

/// The `.ico` of `game` in `dir`, made first if it is not there yet.
/// `None` when the game has no icon.
pub async fn ensure(dir: &Path, game: &Game) -> AppResult<Option<PathBuf>> {
    let Some(hash) = game.icon_hash.as_deref().filter(|hash| is_icon_hash(hash)) else {
        return Ok(None);
    };
    if !is_valid_game_id(&game.id) {
        return Ok(None);
    }

    // The hash is part of the name: a game whose icon changed gets the new one.
    let file = dir.join(format!("{}-{hash}.ico", game.id));
    if file.is_file() {
        return Ok(Some(file));
    }

    let png = download(&game.id, hash).await?;
    let (dir, target) = (dir.to_path_buf(), file.clone());
    spawn_blocking(move || -> AppResult<()> {
        let ico = build_ico(&png)?;
        save(&dir, &target, &ico).map_err(AppError::io("saving the game icon"))
    })
    .await??;
    Ok(Some(file))
}

async fn download(game_id: &str, hash: &str) -> AppResult<Vec<u8>> {
    let network = |error: reqwest::Error| AppError::Network(error.without_url().to_string());

    let client = http::builder(TIMEOUT).https_only(true).build().map_err(network)?;
    let bytes = client
        .get(format!("{CDN}/{game_id}/{hash}.png?size={SOURCE_SIZE}"))
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(network)?
        .bytes()
        .await
        .map_err(network)?;

    if bytes.len() > MAX_BYTES || !bytes.starts_with(&PNG_SIGNATURE) {
        return Err(AppError::Network("the game icon is not a usable PNG".into()));
    }
    Ok(bytes.to_vec())
}

/// Every size of the icon, each one resized from the original, as one `.ico` file.
fn build_ico(png: &[u8]) -> AppResult<Vec<u8>> {
    let invalid = |reason: String| AppError::Network(format!("the game icon cannot be used: {reason}"));

    let source = image::load_from_memory_with_format(png, ImageFormat::Png).map_err(|error| invalid(error.to_string()))?;
    if source.width() != source.height() {
        return Err(invalid("it is not square".into()));
    }
    let source = source.into_rgba8();

    let mut encoded = Vec::with_capacity(SIZES.len());
    for size in SIZES {
        let resized = if size == source.width() {
            source.clone()
        } else {
            image::imageops::resize(&source, size, size, FilterType::Lanczos3)
        };
        encoded.push((size, resized.into_raw()));
    }

    let frames = encoded
        .iter()
        .map(|(size, pixels)| IcoFrame::as_png(pixels, *size, *size, ExtendedColorType::Rgba8))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| invalid(error.to_string()))?;

    let mut ico = Vec::new();
    IcoEncoder::new(&mut ico).encode_images(&frames).map_err(|error| invalid(error.to_string()))?;
    Ok(ico)
}

/// Written beside its final name first, so a half-written file is never read.
fn save(dir: &Path, target: &Path, bytes: &[u8]) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let partial = target.with_extension("part");
    std::fs::write(&partial, bytes)?;
    std::fs::rename(&partial, target)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn game(icon_hash: Option<&str>) -> Game {
        Game {
            id: "123".into(),
            name: "Game".into(),
            aliases: Vec::new(),
            executables: Vec::new(),
            icon_hash: icon_hash.map(str::to_owned),
            themes: Vec::new(),
        }
    }

    /// A PNG of `width` x `height` with a diagonal gradient.
    fn png(width: u32, height: u32) -> Vec<u8> {
        let picture = image::RgbaImage::from_fn(width, height, |x, y| image::Rgba([u8::try_from(x % 256).unwrap_or(0), u8::try_from(y % 256).unwrap_or(0), 128, 255]));
        let mut bytes = std::io::Cursor::new(Vec::new());
        picture.write_to(&mut bytes, ImageFormat::Png).unwrap();
        bytes.into_inner()
    }

    #[test]
    fn only_plain_hashes_are_accepted() {
        assert!(is_icon_hash("6e4b3b152df4601bd5ff07a468c5ccf5"));
        assert!(!is_icon_hash(""));
        assert!(!is_icon_hash("../secret"));
        assert!(!is_icon_hash("a b"));
    }

    #[test]
    fn a_game_without_an_icon_needs_no_download() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(tauri::async_runtime::block_on(ensure(dir.path(), &game(None))).unwrap(), None);
    }

    #[test]
    fn an_unsafe_hash_is_ignored_instead_of_requested() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(tauri::async_runtime::block_on(ensure(dir.path(), &game(Some("../x")))).unwrap(), None);
    }

    #[test]
    fn an_icon_already_on_disk_is_reused_without_any_request() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("123-abc.ico");
        std::fs::write(&file, [0, 0, 1, 0]).unwrap();

        let found = tauri::async_runtime::block_on(ensure(dir.path(), &game(Some("abc")))).unwrap();
        assert_eq!(found, Some(file));
    }

    #[test]
    fn the_ico_holds_one_image_per_size() {
        let ico = build_ico(&png(256, 256)).unwrap();

        // Header: reserved (0), type (1 = icon), then the number of images.
        assert_eq!(ico[..4], [0, 0, 1, 0]);
        assert_eq!(usize::from(u16::from_le_bytes([ico[4], ico[5]])), SIZES.len());
    }

    #[test]
    fn a_smaller_source_still_gives_every_size() {
        assert!(build_ico(&png(128, 128)).is_ok());
    }

    #[test]
    fn an_icon_that_is_not_square_or_not_a_png_is_refused() {
        assert!(build_ico(&png(256, 128)).is_err());
        assert!(build_ico(b"not a picture").is_err());
    }

    #[test]
    fn saving_leaves_no_partial_file() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("icons").join("1-a.ico");
        save(&dir.path().join("icons"), &target, &[0, 0, 1, 0]).unwrap();

        assert!(target.is_file());
        assert!(!target.with_extension("part").exists());
    }
}
