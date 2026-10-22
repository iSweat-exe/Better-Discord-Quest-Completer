import { useState } from "react";

import { cn } from "@/lib/cn";
import { avatarUrl } from "@/lib/discord";
import { initialOf } from "@/lib/format";
import type { Profile } from "@/types/domain";

/** The account's picture, or its first letter when it has none or is offline. */
export function UserAvatar({ profile, size }: { profile: Profile; size: number }) {
  // Discord serves powers of two: asking for more than needed keeps the picture sharp on dense screens.
  const url = avatarUrl(profile.id, profile.avatar, size > 64 ? 256 : 128);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const showImage = url !== null && failedUrl !== url;
  // Only a picture that really arrived counts: with none at all, the letter stays.
  const loaded = url !== null && loadedUrl === url;

  return (
    <div
      className="img-outline relative shrink-0 overflow-hidden rounded-full bg-accent-soft"
      style={{ width: size, height: size }}
    >
      {/* The letter is there from the start and only gives way once the picture has loaded: never an empty circle. */}
      {!loaded ? (
        <span
          aria-hidden="true"
          className="absolute inset-0 grid place-items-center font-semibold text-accent-text"
          style={{ fontSize: size * 0.4 }}
        >
          {initialOf(profile.displayName)}
        </span>
      ) : null}
      {showImage ? (
        <img
          src={url}
          alt=""
          width={size}
          height={size}
          // Explicit: a picture the user is looking at must not be deferred to a placeholder.
          loading="eager"
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
