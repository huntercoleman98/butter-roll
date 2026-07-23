import { useState } from "react";
import type { TokenData } from "../../../hooks/useGameSocket";
import { clientToWorld, startDrag } from "../canvasMath";
import type { DraftRect, Tool, ToolContext } from "./types";
import { SelectionRectOverlay } from "../overlays/SelectionRectOverlay";

interface MarqueeSelectOptions {
  readOnly: boolean;
  tokens: TokenData[];
  onSelectionChange?: (ids: Set<string>) => void;
}

// Rubber-band selection over empty space. A near-zero drag is treated as a
// plain click that clears the selection. Non-consuming so ping can arm too.
export function useMarqueeSelect({
  readOnly,
  tokens,
  onSelectionChange,
}: MarqueeSelectOptions): Tool {
  const [selectionRect, setSelectionRect] = useState<DraftRect | null>(null);

  function onMouseDown({ stage, start, targetIsToken }: ToolContext): boolean {
    if (readOnly || targetIsToken) return false;

    let localRect: DraftRect = { x: start.x, y: start.y, width: 0, height: 0 };
    startDrag(
      (ev) => {
        const cur = clientToWorld(stage, ev.clientX, ev.clientY);
        localRect = {
          x: Math.min(start.x, cur.x),
          y: Math.min(start.y, cur.y),
          width: Math.abs(cur.x - start.x),
          height: Math.abs(cur.y - start.y),
        };
        setSelectionRect(localRect);
      },
      () => {
        setSelectionRect(null);
        // Small area = plain click on empty space → clear selection
        if (localRect.width < 4 && localRect.height < 4) {
          onSelectionChange?.(new Set());
          return;
        }
        const { x, y, width, height } = localRect;
        onSelectionChange?.(
          new Set(
            tokens
              .filter(
                (t) =>
                  t.x >= x && t.x <= x + width && t.y >= y && t.y <= y + height,
              )
              .map((t) => t.id),
          ),
        );
      },
    );
    return true;
  }

  const overlay = selectionRect ? (
    <SelectionRectOverlay rect={selectionRect} />
  ) : null;

  return { onMouseDown, overlay };
}
