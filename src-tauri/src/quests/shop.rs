//! The Orbs shop (`discord.com/shop?tab=orbs`), normalized for the frontend.
//!
//! Like the quests, the shop answer is read defensively: Discord documents
//! nothing here, so every field is optional and anything that cannot be
//! understood is simply left out. Only images hosted by Discord's own CDN are
//! kept, because those are the only ones the app's content policy lets through.

use serde::Serialize;
use serde_json::Value;

use super::model::{field, text};

/// Hosts the frontend may load images from (see `img-src` in `tauri.conf.json`).
const IMAGE_HOSTS: [&str; 2] = ["https://cdn.discordapp.com/", "https://media.discordapp.net/"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProductKind {
    AvatarDecoration,
    ProfileEffect,
    Nameplate,
    ProfileFrame,
    Bundle,
    Other,
}

impl ProductKind {
    fn from_code(code: u64) -> Self {
        match code {
            0 => Self::AvatarDecoration,
            1 => Self::ProfileEffect,
            2 => Self::Nameplate,
            3 => Self::ProfileFrame,
            1000 | 2000 => Self::Bundle,
            _ => Self::Other,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShopProduct {
    pub sku_id: String,
    pub name: String,
    pub summary: Option<String>,
    pub kind: ProductKind,
    /// Price in Orbs, when the product can be bought with them.
    pub orb_price: Option<u64>,
    pub image_url: Option<String>,
    /// The product's own colors (`#rrggbb`). Products Discord draws itself (Nitro
    /// credits, badges) come with no image at all, only these.
    pub colors: Vec<String>,
    /// Number of products a bundle holds.
    pub bundle_size: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShopCategory {
    pub sku_id: String,
    pub name: String,
    pub summary: Option<String>,
    /// The collection can only be bought with Orbs.
    pub orbs_exclusive: bool,
    pub products: Vec<ShopProduct>,
}

/// An image URL, only when Discord's CDN hosts it.
fn cdn_url(value: Option<&Value>) -> Option<String> {
    let url = value?.as_str()?;
    IMAGE_HOSTS.iter().any(|host| url.starts_with(host)).then(|| url.to_owned())
}

/// Searches a `prices` map for an amount in Orbs, whatever the nesting of
/// the price objects (`{ currency: "discord_orb", amount: 700, exponent: 0 }`).
fn orb_price(value: &Value) -> Option<u64> {
    match value {
        Value::Object(map) => {
            let is_orbs = map.get("currency").and_then(Value::as_str).is_some_and(|c| c.to_ascii_lowercase().contains("orb"));
            if is_orbs && let Some(amount) = map.get("amount").and_then(Value::as_u64) {
                let exponent = map.get("exponent").or_else(|| map.get("currency_exponent")).and_then(Value::as_u64);
                return Some(amount / 10u64.pow(exponent.unwrap_or(0).min(9) as u32));
            }
            map.values().find_map(orb_price)
        }
        Value::Array(list) => list.iter().find_map(orb_price),
        _ => None,
    }
}

/// A path or hash that is safe to put in a CDN URL.
fn safe_segment(value: &str) -> bool {
    !value.is_empty() && !value.contains("..") && value.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | '/'))
}

/// The picture of one collectible item. Discord gives ready-made URLs for most
/// of them; otherwise it is built from the item's asset hash or path
/// (<https://docs.discord.food/reference#cdn-endpoints>).
fn item_image(item: &Value) -> Option<String> {
    let from_assets = field(item, &["assets"]).and_then(|assets| {
        cdn_url(field(assets, &["static_image_url", "staticImageUrl"]))
            .or_else(|| cdn_url(field(assets, &["animated_image_url", "animatedImageUrl"])))
    });
    // Profile effects carry their previews under camelCase names.
    let from_preview = || {
        ["staticFrameSrc", "thumbnailPreviewSrc", "reducedMotionSrc"].iter().find_map(|name| cdn_url(item.get(name)))
    };
    let from_asset = || {
        let asset = text(item, &["asset"]).filter(|asset| safe_segment(asset))?;
        match field(item, &["type"]).and_then(Value::as_u64)? {
            0 => Some(format!("https://cdn.discordapp.com/avatar-decoration-presets/{asset}.png")),
            2 => {
                let slash = if asset.ends_with('/') { "" } else { "/" };
                Some(format!("https://cdn.discordapp.com/assets/collectibles/{asset}{slash}static.png"))
            }
            _ => None,
        }
    };
    from_assets.or_else(from_preview).or_else(from_asset)
}

/// The first picture of a product: its items, else its preview, else what a bundle holds.
fn product_image(product: &Value) -> Option<String> {
    let from_items = || field(product, &["items"])?.as_array()?.iter().find_map(item_image);
    let from_preview = || {
        let preview = field(product, &["preview_assets", "previewAssets"])?;
        ["fg_static", "bg_static", "fg_animated", "bg_animated"].iter().find_map(|name| cdn_url(preview.get(name)))
    };
    let from_bundle = || field(product, &["bundled_products", "bundledProducts"])?.as_array()?.iter().find_map(product_image);
    from_items().or_else(from_preview).or_else(from_bundle).or_else(|| any_image(product))
}

/// Last resort for products of a kind that is not known (Nitro credits, badges…):
/// the first still image of Discord's CDN found anywhere in the product.
/// Videos are skipped, an `<img>` cannot play them.
fn any_image(value: &Value) -> Option<String> {
    match value {
        Value::String(url) => {
            let path = url.split(['?', '#']).next().unwrap_or(url).to_ascii_lowercase();
            let is_image = [".png", ".jpg", ".jpeg", ".webp", ".gif"].iter().any(|extension| path.ends_with(extension));
            (is_image && IMAGE_HOSTS.iter().any(|host| url.starts_with(host))).then(|| url.clone())
        }
        Value::Object(map) => map.iter().filter(|(key, _)| !key.to_ascii_lowercase().contains("video")).find_map(|(_, inner)| any_image(inner)),
        Value::Array(list) => list.iter().find_map(any_image),
        _ => None,
    }
}

/// `styles.background_colors`: colors given as decimal integers.
fn background_colors(product: &Value) -> Vec<String> {
    field(product, &["styles"])
        .and_then(|styles| field(styles, &["background_colors", "backgroundColors"]))
        .and_then(Value::as_array)
        .map(|colors| {
            colors.iter().filter_map(Value::as_u64).filter(|color| *color <= 0xff_ffff).map(|color| format!("#{color:06x}")).take(3).collect()
        })
        .unwrap_or_default()
}

fn parse_product(raw: &Value) -> Option<ShopProduct> {
    let sku_id = text(raw, &["sku_id", "skuId"])?;
    Some(ShopProduct {
        name: text(raw, &["name"]).unwrap_or_else(|| format!("SKU {sku_id}")),
        summary: text(raw, &["summary"]),
        kind: ProductKind::from_code(field(raw, &["type"]).and_then(Value::as_u64).unwrap_or(u64::MAX)),
        orb_price: field(raw, &["prices"]).and_then(orb_price),
        image_url: product_image(raw),
        colors: background_colors(raw),
        bundle_size: field(raw, &["bundled_products", "bundledProducts"])
            .and_then(Value::as_array)
            .map(|list| list.len() as u64)
            .filter(|size| *size > 0),
        sku_id,
    })
}

fn parse_category(raw: &Value) -> Option<ShopCategory> {
    let sku_id = text(raw, &["sku_id", "skuId"])?;
    let mut products: Vec<ShopProduct> = field(raw, &["products"])
        .and_then(Value::as_array)
        .map(|list| list.iter().filter_map(parse_product).collect())
        .unwrap_or_default();
    // What the Orbs can buy first; the sort is stable, Discord's order is kept otherwise.
    products.sort_by_key(|product| product.orb_price.is_none());

    Some(ShopCategory {
        name: text(raw, &["name"]).unwrap_or_else(|| format!("SKU {sku_id}")),
        summary: text(raw, &["summary"]),
        orbs_exclusive: field(raw, &["is_orbs_exclusive", "isOrbsExclusive"]).and_then(Value::as_bool).unwrap_or(false),
        products,
        sku_id,
    })
}

/// What the shop sold, and what could not be pictured.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShopResponse {
    pub categories: Vec<ShopCategory>,
    /// Discord's own description of the products that ended up without an image
    /// (it never contains the token): lets a missing asset be diagnosed.
    pub unresolved_json: String,
}

/// Reads the answer and keeps the raw products that have no picture.
pub fn read_shop(answer: &Value) -> ShopResponse {
    let categories = parse_shop(answer);
    let imageless: Vec<&str> = categories
        .iter()
        .flat_map(|category| &category.products)
        .filter(|product| product.image_url.is_none())
        .map(|product| product.sku_id.as_str())
        .collect();

    let raw_categories = match answer {
        Value::Array(list) => Some(list),
        other => field(other, &["categories"]).and_then(Value::as_array),
    };
    let unresolved: Vec<&Value> = raw_categories
        .into_iter()
        .flatten()
        .filter_map(|category| field(category, &["products"]).and_then(Value::as_array))
        .flatten()
        .filter(|product| text(product, &["sku_id", "skuId"]).is_some_and(|sku| imageless.contains(&sku.as_str())))
        .collect();

    ShopResponse {
        categories,
        unresolved_json: if unresolved.is_empty() { String::new() } else { serde_json::to_string_pretty(&unresolved).unwrap_or_default() },
    }
}

/// Reads the shop answer: `{ "categories": [...] }`, or a bare list of categories.
/// Empty categories are dropped.
pub fn parse_shop(answer: &Value) -> Vec<ShopCategory> {
    let list = match answer {
        Value::Array(list) => Some(list),
        other => field(other, &["categories"]).and_then(Value::as_array),
    };
    list.map(|categories| categories.iter().filter_map(parse_category).filter(|c| !c.products.is_empty()).collect())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn sample() -> Value {
        json!({ "categories": [{
            "sku_id": "10",
            "name": "Anime Spirits",
            "summary": "Orbs only",
            "is_orbs_exclusive": true,
            "products": [
                { "sku_id": "1", "name": "Full price", "type": 0,
                  "prices": { "0": { "country_code": "FR", "country_prices": { "prices": [{ "currency": "eur", "amount": 599 }] } } },
                  "items": [{ "type": 0, "sku_id": "1", "assets": { "static_image_url": "https://cdn.discordapp.com/a.png" } }] },
                { "sku_id": "2", "name": "Orb item", "type": 1, "summary": "Sparkles",
                  "prices": { "4": { "country_prices": { "prices": [{ "currency": "discord_orb", "amount": 700, "exponent": 0 }] } } },
                  "items": [{ "type": 1, "assets": { "static_image_url": "https://evil.example/x.png",
                                                       "animated_image_url": "https://media.discordapp.net/b.png" } }] }
            ]
        }] })
    }

    #[test]
    fn reads_categories_and_products() {
        let categories = parse_shop(&sample());
        assert_eq!(categories.len(), 1);
        let category = &categories[0];
        assert_eq!((category.name.as_str(), category.orbs_exclusive), ("Anime Spirits", true));
        assert_eq!(category.products.len(), 2);
    }

    #[test]
    fn products_priced_in_orbs_come_first() {
        let products = &parse_shop(&sample())[0].products;
        assert_eq!((products[0].sku_id.as_str(), products[0].orb_price), ("2", Some(700)));
        assert_eq!((products[1].sku_id.as_str(), products[1].orb_price), ("1", None));
        assert_eq!(products[0].kind, ProductKind::ProfileEffect);
    }

    #[test]
    fn only_images_from_discord_are_kept() {
        let products = &parse_shop(&sample())[0].products;
        assert_eq!(products[0].image_url.as_deref(), Some("https://media.discordapp.net/b.png"));
        assert_eq!(products[1].image_url.as_deref(), Some("https://cdn.discordapp.com/a.png"));
    }

    #[test]
    fn images_are_built_from_asset_hashes_and_previews() {
        let image = |product: Value| product_image(&product);
        assert_eq!(
            image(json!({ "items": [{ "type": 0, "asset": "a_abc123" }] })).as_deref(),
            Some("https://cdn.discordapp.com/avatar-decoration-presets/a_abc123.png")
        );
        assert_eq!(
            image(json!({ "items": [{ "type": 2, "asset": "nameplates/nameplates/twilight/" }] })).as_deref(),
            Some("https://cdn.discordapp.com/assets/collectibles/nameplates/nameplates/twilight/static.png")
        );
        assert_eq!(
            image(json!({ "items": [{ "type": 1, "thumbnailPreviewSrc": "https://cdn.discordapp.com/p.png" }] })).as_deref(),
            Some("https://cdn.discordapp.com/p.png")
        );
        assert_eq!(
            image(json!({ "preview_assets": { "bg_static": "https://cdn.discordapp.com/bg.png" } })).as_deref(),
            Some("https://cdn.discordapp.com/bg.png")
        );
        assert_eq!(
            image(json!({ "type": 1000, "bundled_products": [{ "items": [{ "type": 0, "asset": "x" }] }] })).as_deref(),
            Some("https://cdn.discordapp.com/avatar-decoration-presets/x.png")
        );
        assert_eq!(image(json!({ "items": [{ "type": 0, "asset": "../evil" }] })), None, "a path cannot climb out of the CDN folder");
    }

    #[test]
    fn an_unknown_kind_still_gets_the_first_still_image_found() {
        let product = json!({ "type": 5000, "summary": "Nitro", "hero": { "video_url": "https://cdn.discordapp.com/a.webm",
            "art": ["https://cdn.discordapp.com/b.png?size=256"] } });
        assert_eq!(product_image(&product).as_deref(), Some("https://cdn.discordapp.com/b.png?size=256"));
        assert_eq!(product_image(&json!({ "x": "https://evil.example/c.png" })), None);
    }

    #[test]
    fn products_without_an_image_are_reported_raw() {
        let answer = json!({ "categories": [{ "sku_id": "1", "products": [
            { "sku_id": "2", "name": "Pictured", "items": [{ "type": 0, "asset": "x" }] },
            { "sku_id": "3", "name": "Bare" }] }] });
        let response = read_shop(&answer);
        assert!(response.unresolved_json.contains("Bare") && !response.unresolved_json.contains("Pictured"));
        assert!(read_shop(&json!({ "categories": [] })).unresolved_json.is_empty());
    }

    #[test]
    fn products_without_images_keep_their_colors() {
        let products = &parse_shop(&json!([{ "sku_id": "1", "products": [
            { "sku_id": "2", "type": 3000, "items": [], "preview_assets": null,
              "styles": { "background_colors": [1_335_620, 137_742, "junk"] } }] }]))[0].products;
        assert_eq!(products[0].colors, ["#146144", "#021a0e"]);
        assert_eq!(products[0].image_url, None);
    }

    #[test]
    fn a_bundle_knows_how_many_products_it_holds() {
        let products = &parse_shop(&json!([{ "sku_id": "1", "products": [
            { "sku_id": "2", "bundled_products": [{}, {}, {}] }, { "sku_id": "3" }] }]))[0].products;
        assert_eq!((products[0].bundle_size, products[1].bundle_size), (Some(3), None));
    }

    #[test]
    fn empty_categories_and_odd_shapes_are_tolerated() {
        assert!(parse_shop(&json!({ "categories": [{ "sku_id": "1", "products": [] }] })).is_empty());
        assert!(parse_shop(&json!({ "categories": "nope" })).is_empty());
        assert!(parse_shop(&json!(42)).is_empty());
        assert_eq!(parse_shop(&json!([{ "sku_id": "1", "products": [{ "sku_id": "2" }] }])).len(), 1);
    }

    #[test]
    fn orb_prices_respect_the_exponent() {
        assert_eq!(orb_price(&json!({ "currency": "discord_orb", "amount": 7000, "exponent": 1 })), Some(700));
        assert_eq!(orb_price(&json!({ "currency": "usd", "amount": 5 })), None);
    }
}
