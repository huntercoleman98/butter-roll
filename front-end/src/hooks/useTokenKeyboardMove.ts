import { useEffect } from "react";
import { TOKEN_SIZE } from "../components/Token";
import type { Page, OutgoingPayload } from "./useGameSocket";

const ARROW_DELTAS: Record<string, { dx: number; dy: number }> = {
  ArrowUp: { dx: 0, dy: -TOKEN_SIZE },
  ArrowDown: { dx: 0, dy: TOKEN_SIZE },
  ArrowLeft: { dx: -TOKEN_SIZE, dy: 0 },
  ArrowRight: { dx: TOKEN_SIZE, dy: 0 },
};

// Arrow keys nudge every selected token by one default token width/height.
// The step is TOKEN_SIZE (not each token's own size) so larger tokens still
// move the same distance per keypress.
export function useTokenKeyboardMove({
  activePage,
  activeId,
  selectedTokenIds,
  send,
}: {
  activePage: Page | null;
  activeId: string;
  selectedTokenIds: Set<string>;
  send: (payload: OutgoingPayload) => void;
}) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const delta = ARROW_DELTAS[e.key];
      if (!delta) return;
      // Ignore auto-repeat so a held key is still a single move.
      if (e.repeat) return;
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (!activePage || !activeId || selectedTokenIds.size === 0) return;

      e.preventDefault();
      const moves = activePage.tokens
        .filter((t) => selectedTokenIds.has(t.id))
        .map((t) => ({ id: t.id, x: t.x + delta.dx, y: t.y + delta.dy }));
      if (moves.length === 0) return;
      // One atomic batch so every selected token moves in a single state
      // update / render — N separate TokenMoves arrive staggered and tear the
      // group apart as their echoes land.
      send({ case: "tokenMoveBatch", value: { pageId: activeId, moves } });
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [activePage, activeId, selectedTokenIds, send]);
}
