const CDN = "https://cdn.discordapp.com";

/** URL of a user's avatar, or `null` when the account kept the default one. */
export function avatarUrl(userId: string, avatarHash: string | null, size = 128): string | null {
  return avatarHash ? `${CDN}/avatars/${userId}/${avatarHash}.png?size=${size}` : null;
}

/** URL of a game's icon on Discord's CDN, or `null` when it has none. */
export function gameIconUrl(gameId: string, iconHash: string | null, size = 128): string | null {
  return iconHash ? `${CDN}/app-icons/${gameId}/${iconHash}.png?size=${size}` : null;
}
