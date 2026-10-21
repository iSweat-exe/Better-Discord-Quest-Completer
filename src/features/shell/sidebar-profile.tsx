import { UserAvatar } from "@/components/ui/user-avatar";
import { useProfile } from "@/features/quests/queries";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n/use-t";

import { useUiStore } from "./ui-store";

const AVATAR_SIZE = 36;

/** Same card as the running-games summary above it, with equal padding on every side. */
const CARD = "mt-2 flex w-full items-center gap-3 rounded-card p-2.5 shadow-card";

/** Holds the row's place while the profile loads, so the sidebar does not jump. */
function ProfileSkeleton() {
  return (
    <div className={cn(CARD, "bg-surface")} aria-hidden="true">
      <div className="shrink-0 rounded-full bg-raised" style={{ width: AVATAR_SIZE, height: AVATAR_SIZE }} />
      <div className="flex flex-1 flex-col gap-1.5">
        <div className="h-3 w-24 rounded bg-raised" />
        <div className="h-2.5 w-16 rounded bg-raised" />
      </div>
    </div>
  );
}

/**
 * Who the saved token belongs to; opens the profile page. Renders nothing
 * without a token, or if Discord does not answer.
 */
export function SidebarProfile() {
  const { t } = useT();
  const { data: profile, isPending, fetchStatus } = useProfile();
  const active = useUiStore((state) => state.page === "profile");
  const navigate = useUiStore((state) => state.navigate);

  // A disabled query (no token) stays "pending": only a running request deserves a placeholder.
  if (isPending) return fetchStatus === "fetching" ? <ProfileSkeleton /> : null;
  if (!profile) return null;

  return (
    <button
      type="button"
      aria-label={t("profile.open")}
      aria-current={active ? "page" : undefined}
      onClick={() => {
        navigate("profile");
      }}
      className={cn(
        CARD,
        "text-left transition-[background-color,box-shadow,scale] duration-150 ease-out active:scale-[0.96]",
        active ? "bg-accent-soft" : "bg-surface hover:bg-raised",
      )}
    >
      <UserAvatar profile={profile} size={AVATAR_SIZE} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium leading-tight" title={profile.displayName}>
          {profile.displayName}
        </p>
        <p className="truncate text-xs leading-tight text-muted" title={`@${profile.username}`}>
          @{profile.username}
        </p>
      </div>
    </button>
  );
}
