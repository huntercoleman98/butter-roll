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
      for (const t of activePage.tokens) {
        if (!selectedTokenIds.has(t.id)) continue;
        send({
          case: "tokenMove",
          value: {
            pageId: activeId,
            id: t.id,
            x: t.x + delta.dx,
            y: t.y + delta.dy,
          },
        });
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [activePage, activeId, selectedTokenIds, send]);
}
