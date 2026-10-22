import { useQuery } from "@tanstack/react-query";

import { gameHue } from "@/lib/game-hue";
import { queryKeys } from "@/lib/query";

/** The hue of a game's icon, read in the background; `null` until known or when it has none. */
export function useGameHue(gameId: string, iconHash: string | null): number | null {
  const { data } = useQuery({
    queryKey: [...queryKeys.gameHue, gameId, iconHash],
    queryFn: () => gameHue(gameId, iconHash),
    staleTime: Infinity,
    gcTime: Infinity,
  });
  return data ?? null;
}
