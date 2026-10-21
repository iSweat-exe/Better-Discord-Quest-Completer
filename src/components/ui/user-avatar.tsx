import { useState } from "react";

import { cn } from "@/lib/cn";
import { avatarUrl } from "@/lib/discord";
import type { Profile } from "@/types/domain";

/** The account's picture, or its first letter when it has none or is offline. */
export function UserAvatar({ profile, size }: { profile: Profile; size: number }) {
  // Discord serves powers of two: asking for more than needed keeps the picture sharp on dense screens.
  const url = avatarUrl(profile.id, profile.avatar, size > 64 ? 256 : 128);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const showImage = url !== null && failedUrl !== url;

  return (
    <div
      className="img-outline relative shrink-0 overflow-hidden rounded-full bg-accent-soft"
      style={{ width: size, height: size }}
    >
      {showImage ? (
        <img
          src={url}
          alt=""
          width={size}
          height={size}
          draggable={false}
          onLoad={() => {
            setLoadedUrl(url);
          }}
          onError={() => {
            setFailedUrl(url);
          }}
          className={cn(
            "size-full object-cover transition-opacity duration-200 ease-out",
            loadedUrl === url ? "opacity-100" : "opacity-0",
          )}
        />
      ) : (
        <span
          aria-hidden="true"
          className="grid size-full place-items-center font-semibold text-accent-text"
          style={{ fontSize: size * 0.4 }}
        >
          {profile.displayName.trim().charAt(0).toUpperCase() || "?"}
        </span>
      )}
    </div>
  );
}
