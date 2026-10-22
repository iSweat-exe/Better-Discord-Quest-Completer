import { gameIconUrl } from "./discord";

/** Below this, a pixel is gray (or nearly black or transparent) and says nothing about a color. */
const MIN_CHROMA = 0.05;
const MIN_LIGHTNESS = 0.2;
const SAMPLE_SIZE = 32;

const toLinear = (channel: number) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);

/** Lightness, chroma and hue (degrees) of an sRGB color (0 to 1 per channel), in OKLCH. */
function oklch(red: number, green: number, blue: number) {
  const r = toLinear(red);
  const g = toLinear(green);
  const b = toLinear(blue);

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { lightness, chroma: Math.hypot(a, bb), hue: (Math.atan2(bb, a) * 180) / Math.PI };
}

/**
 * The hue (0 to 360) that dominates RGBA `pixels`, or `null` when the picture has
 * no real color. It is the hue of OKLCH, the space the app's colors are written in,
 * so it can be used as is: an orange logo gives an orange, not the rose a hue taken
 * from another color model would turn into. Pixels count in proportion to their
 * chroma, so a vivid logo wins over a muted background, and hues are averaged on
 * the circle (red at 350 and red at 10 make red, not cyan).
 */
export function dominantHue(pixels: ArrayLike<number>): number | null {
  let x = 0;
  let y = 0;
  let weight = 0;

  for (let index = 0; index + 3 < pixels.length; index += 4) {
    const alpha = (pixels[index + 3] ?? 0) / 255;
    if (alpha < 0.5) continue;

    const { lightness, chroma, hue } = oklch((pixels[index] ?? 0) / 255, (pixels[index + 1] ?? 0) / 255, (pixels[index + 2] ?? 0) / 255);
    if (chroma < MIN_CHROMA || lightness < MIN_LIGHTNESS) continue;

    const radians = (hue * Math.PI) / 180;
    x += Math.cos(radians) * chroma * alpha;
    y += Math.sin(radians) * chroma * alpha;
    weight += chroma * alpha;
  }

  if (weight === 0) return null;
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

const hues = new Map<string, Promise<number | null>>();

/**
 * The dominant hue of a game's icon, read once per icon. `null` when the game has
 * no icon, the icon is colorless, or the picture cannot be read (a failure only
 * means the game keeps the app's own accent).
 */
export function gameHue(gameId: string, iconHash: string | null): Promise<number | null> {
  const url = gameIconUrl(gameId, iconHash, 64);
  if (url === null) return Promise.resolve(null);

  let hue = hues.get(url);
  if (!hue) {
    hue = readHue(url);
    hues.set(url, hue);
  }
  return hue;
}

function readHue(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const image = new Image();
    // Without this the canvas would be tainted and refuse to give its pixels back.
    image.crossOrigin = "anonymous";
    image.onerror = () => {
      resolve(null);
    };
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = SAMPLE_SIZE;
        canvas.height = SAMPLE_SIZE;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return resolve(null);
        context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
        resolve(dominantHue(context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data));
      } catch {
        resolve(null);
      }
    };
    image.src = url;
  });
}
