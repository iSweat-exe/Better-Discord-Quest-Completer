import { useState } from "react";

import { cn } from "@/lib/cn";
import { gameIconUrl } from "@/lib/discord";

interface GameIconProps {
  gameId: string;
  name: string;
  iconHash: string | null;
  /** Edge length in pixels. */
  size?: number;
  className?: string;
}

/** A stable hue per game, so monograms are recognizable at a glance. */
function hueFor(name: string): number {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) % 360;
  return hash;
}

/** The game's Discord icon, or a colored monogram when it has none or is offline. */
export function GameIcon({ gameId, name, iconHash, size = 40, className }: GameIconProps) {
  const url = gameIconUrl(gameId, iconHash, size > 64 ? 256 : 128);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const showImage = url !== null && failedUrl !== url;
  // Only a picture that really arrived counts: with none at all, the letter stays.
  const loaded = url !== null && loadedUrl === url;

  const initials = name.replace(/[^\p{L}\p{N} ]/gu, "").trim().slice(0, 2).toUpperCase() || "?";

  return (
    <div
      className={cn("img-outline relative shrink-0 overflow-hidden rounded-[22%] bg-sunken", className)}
      style={{ width: size, height: size }}
    >
      {/* The monogram holds the place until the icon has really loaded: never an empty tile. */}
      {!loaded ? (
        <span
          aria-hidden="true"
          className="absolute inset-0 grid place-items-center font-semibold tracking-tight"
          style={{
            fontSize: size * 0.36,
            background: `oklch(0.5 0.12 ${hueFor(name)} / 0.22)`,
            color: `oklch(0.72 0.12 ${hueFor(name)})`,
          }}
        >
          {initials}
        </span>
      ) : null}
      {showImage ? (
        <img
          src={url}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          draggable={false}
          onLoad={() => {
            setLoadedUrl(url);
          }}
          onError={() => {
            setFailedUrl(url);
          }}
          className={cn(
            "relative size-full object-cover transition-opacity duration-200 ease-out",
            loaded ? "opacity-100" : "opacity-0",
          )}
        />
      ) : null}
    </div>
  );
}
