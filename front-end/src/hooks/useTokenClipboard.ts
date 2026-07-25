import { useEffect, useRef, useState } from "react";
import type Konva from "konva";
import { uuid } from "../utils/uuid";
import type { TokenData, Page, OutgoingPayload } from "./useGameSocket";

type Clipboard = {
  tokens: TokenData[];
  centroid: { x: number; y: number };
};

// Ctrl/Cmd+C copies the selected tokens (with their centroid); Ctrl/Cmd+V
// pastes them at the cursor, preserving each token's offset from that centroid.
// Tracks the cursor in world space so paste lands where the mouse is.
export function useTokenClipboard({
  activePage,
  activeId,
  selectedTokenIds,
  stageRef,
  mapAreaRef,
  send,
}: {
  activePage: Page | null;
  activeId: string;
  selectedTokenIds: Set<string>;
  stageRef: React.RefObject<Konva.Stage | null>;
  mapAreaRef: React.RefObject<HTMLDivElement | null>;
  send: (payload: OutgoingPayload) => void;
}) {
  const [clipboard, setClipboard] = useState<Clipboard | null>(null);
  const cursorWorldPos = useRef({ x: 0, y: 0 });

  // Track cursor position in world space for paste targeting.
  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      const stage = stageRef.current;
      const container = mapAreaRef.current;
      if (!stage || !container) return;
      const rect = container.getBoundingClientRect();
      const scale = stage.scaleX();
      cursorWorldPos.current = {
        x: (e.clientX - rect.left - stage.x()) / scale,
        y: (e.clientY - rect.top - stage.y()) / scale,
      };
    }
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [stageRef, mapAreaRef]);

  // Ctrl/Cmd+C to copy selected tokens; Ctrl/Cmd+V to paste at cursor.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!e.metaKey && !e.ctrlKey) return;
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (e.key === "c") {
        if (!activePage || selectedTokenIds.size === 0) return;
        const selected = activePage.tokens.filter((t) =>
          selectedTokenIds.has(t.id),
        );
        if (selected.length === 0) return;
        const centroid = {
          x: selected.reduce((s, t) => s + t.x, 0) / selected.length,
          y: selected.reduce((s, t) => s + t.y, 0) / selected.length,
        };
        setClipboard({ tokens: selected, centroid });
        e.preventDefault();
      }

      if (e.key === "v") {
        if (!clipboard || !activeId) return;
        const { x: cx, y: cy } = clipboard.centroid;
        const { x: px, y: py } = cursorWorldPos.current;
        for (const t of clipboard.tokens) {
          send({
            case: "tokenAdd",
            value: {
              pageId: activeId,
              token: {
                id: uuid(),
                url: t.url,
                x: px + (t.x - cx),
                y: py + (t.y - cy),
                color: t.color,
                borderWidth: t.borderWidth,
                statusEffects: t.statusEffects,
                name: t.name,
                showName: t.showName,
                public: t.public,
                // Copies keep the monster link and max HP but start unwounded.
                ...(t.monster
                  ? { monster: t.monster, hp: t.hp, wounds: 0 }
                  : {}),
                // Carry the player association through as-is. The server drops it
                // if it would duplicate an owner already on the target page (one
                // player token per player per page), rewriting the broadcast so
                // clients render the corrected token.
                player: t.player,
                ownerPlayerId: t.ownerPlayerId,
              },
            },
          });
        }
        e.preventDefault();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [activePage, selectedTokenIds, clipboard, activeId, send]);
}
