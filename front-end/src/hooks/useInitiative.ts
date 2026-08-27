import { useEffect, useRef, useState } from "react";
import { uuid } from "../utils/uuid";
import { tokenDisplayName } from "../utils/tokenName";
import type { InitiativeEntry } from "../components/InitiativePanel";
import type { Monster } from "../types/monster";
import type {
  DiceRollResult,
  Page,
  OutgoingPayload,
} from "./useGameSocket";

// Zoom applied when focusing on a token: /view's initiative "Focus view", the
// DM's own left-click focus, and "Bring player view here" all share this.
export const INITIATIVE_FOCUS_SCALE = 2;

// Owns initiative tracking: the entry list, whose turn it is, "focus view", and
// the pending-roll resolution dance. Monster-linked tokens roll initiative on
// /view; the roll result (a broadcast `diceResult`) is matched back to its
// entry by label here.
export function useInitiative({
  diceResult,
  activePage,
  activeId,
  monsters,
  send,
}: {
  diceResult: DiceRollResult | null;
  activePage: Page | null;
  activeId: string;
  monsters: Monster[];
  send: (payload: OutgoingPayload) => void;
}) {
  const [entries, setEntries] = useState<InitiativeEntry[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [focusView, setFocusView] = useState(false);
  const pendingRolls = useRef<{ entryId: string; label: string }[]>([]);

  // Resolve a pending initiative roll matching this result's label.
  useEffect(() => {
    if (!diceResult) return;
    if (diceResult.private || !diceResult.label) return;
    const idx = pendingRolls.current.findIndex(
      (p) => p.label === diceResult.label,
    );
    if (idx === -1) return;
    const [pending] = pendingRolls.current.splice(idx, 1);
    setEntries((prev) =>
      prev.map((e) =>
        e.entryId === pending.entryId ? { ...e, value: diceResult.total } : e,
      ),
    );
  }, [diceResult]);

  // With "Focus view" on, center /view on the token whose turn it is.
  useEffect(() => {
    if (!focusView || !currentId) return;
    const entry = entries.find((e) => e.entryId === currentId);
    const token = activePage?.tokens.find((t) => t.id === entry?.tokenId);
    if (!token || !activeId) return;
    send({
      case: "viewportSync",
      value: {
        pageId: activeId,
        worldCenterX: token.x,
        worldCenterY: token.y,
        scale: INITIATIVE_FOCUS_SCALE,
      },
    });
  }, [focusView, currentId]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleAddToInitiative(tokenIds: Set<string>) {
    if (!activePage) return;
    const affected = activePage.tokens.filter((t) => tokenIds.has(t.id));
    const toAdd = affected.map((t) => ({
      entryId: uuid(),
      tokenId: t.id,
      name: tokenDisplayName(t),
      url: t.url,
      value: 0,
    }));
    // Monster-linked tokens roll initiative (1d20 + DEX) on /view; the
    // result sets their initiative value when it comes back.
    toAdd.forEach((entry, i) => {
      const monster = monsters.find((m) => m.name === affected[i].monster);
      if (!monster) return;
      const dex = monster.stats.dexterity;
      const expression = `1d20${dex > 0 ? `+${dex}` : dex < 0 ? `${dex}` : ""}`;
      const label = `${entry.name || monster.name} initiative`;
      pendingRolls.current.push({ entryId: entry.entryId, label });
      send({
        case: "diceRollRequest",
        value: { expression, playerName: "DM", label },
      });
    });
    // Signal the server that combat is starting the first time tokens enter an
    // empty order, so initiativeStart rules (e.g. a combat-start cue) fire once.
    if (entries.length === 0 && toAdd.length > 0) {
      send({ case: "initiativeStart", value: {} });
    }
    if (toAdd.length > 0) setEntries((prev) => [...prev, ...toAdd]);
  }

  // Apply a filter to the entries, clearing "current" if it was dropped. When the
  // last entry leaves a non-empty order, signal the server so initiativeEnd rules
  // (e.g. a combat-end cue) fire once — the mirror of initiativeStart.
  function removeWhere(keep: (e: InitiativeEntry) => boolean) {
    const next = entries.filter(keep);
    if (currentId && !next.some((e) => e.entryId === currentId)) {
      setCurrentId(null);
    }
    if (entries.length > 0 && next.length === 0) {
      send({ case: "initiativeEnd", value: {} });
    }
    setEntries(next);
  }

  // Drop any entries whose token was deleted.
  function removeByTokenIds(ids: Set<string>) {
    removeWhere((e) => !ids.has(e.tokenId));
  }

  // Drop a single entry (the DM removed it from the initiative panel).
  function removeByEntryId(entryId: string) {
    removeWhere((e) => e.entryId !== entryId);
  }

  return {
    entries,
    currentId,
    focusView,
    setEntries,
    setCurrentId,
    setFocusView,
    handleAddToInitiative,
    removeByTokenIds,
    removeByEntryId,
  };
}
