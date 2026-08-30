import type { Page, TokenData } from "./useGameSocket";

// Derives the monster tokens the DM has assigned to a player on the presented
// page — familiars/mounts/summons the player controls (owned monsters, i.e.
// ownerPlayerId === me && !player && has a monster link), not their character
// token. Presented-page-only (v1): companions vanish when another page is shown.
export function useCompanions(
  pages: Page[],
  presentedPageId: string | null,
  playerId: string | undefined,
): { companions: TokenData[]; hasCompanions: boolean } {
  const presentedPage = pages.find((p) => p.id === presentedPageId);
  const companions = (presentedPage?.tokens ?? []).filter(
    (t) =>
      playerId != null &&
      t.ownerPlayerId === playerId &&
      !t.player &&
      !!t.monster,
  );
  return { companions, hasCompanions: companions.length > 0 };
}
