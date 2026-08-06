import { useMemo, useState } from "react";
import type { CharacterRecord, TokenData } from "./useGameSocket";

export interface PlayerMenuState {
  playerId: string;
  name: string;
  // The player's token on the active page, or null when they have none here
  // (a grayed chip) — the token-centric actions are hidden in that case.
  token: TokenData | null;
  x: number;
  y: number;
}

export interface PinnedMenuState {
  token: TokenData;
  x: number;
  y: number;
}

export interface RetiredMenuState {
  x: number;
  y: number;
}

// Owns the top bar's transient right-click-menu state and derives the bar's
// groupings from the character roster + the active page's tokens. Consumed by
// <TokenBar>; follows the useInitiative/usePages feature-hook pattern.
export function useTokenBar(
  characters: Record<string, CharacterRecord>,
  tokens: TokenData[],
) {
  const [playerMenu, setPlayerMenu] = useState<PlayerMenuState | null>(null);
  const [retiredMenu, setRetiredMenu] = useState<RetiredMenuState | null>(null);
  const [pinnedMenu, setPinnedMenu] = useState<PinnedMenuState | null>(null);

  const derived = useMemo(() => {
    // Group the roster by owning player; each chip shows that player's active
    // character. Retired characters are unassociated and reached from the shared
    // graveyard button instead.
    const activeByPlayer = new Map<string, CharacterRecord>();
    const retired: CharacterRecord[] = [];
    for (const c of Object.values(characters)) {
      if (c.archived) retired.push(c);
      else activeByPlayer.set(c.ownerPlayerId, c);
    }
    // Index this page's player tokens by the character they represent, so a chip
    // is "present" only when its active character's own token is here (a retired
    // character's leftover token has a different id).
    const tokenByCharacter = new Map<string, TokenData>();
    for (const t of tokens)
      if (t.player && t.characterId) tokenByCharacter.set(t.characterId, t);
    // DM/NPC tokens pinned from their right-click menu get a quick-access chip
    // too, after a divider that separates them from the player chips.
    const pinnedTokens = tokens.filter((t) => t.pinned);
    return {
      players: [...activeByPlayer.entries()],
      retired,
      tokenByCharacter,
      pinnedTokens,
    };
  }, [characters, tokens]);

  return {
    playerMenu,
    setPlayerMenu,
    retiredMenu,
    setRetiredMenu,
    pinnedMenu,
    setPinnedMenu,
    ...derived,
  };
}
