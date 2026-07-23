import { useEffect, useRef, useState } from "react";
import type Konva from "konva";
import type { FogPoly } from "../../../hooks/useGameSocket";
import { clientToWorld, pointInPoly, startDrag } from "../canvasMath";
import type { DraftRect, Tool, ToolContext } from "./types";
import { DraftRectOverlay } from "../overlays/DraftRectOverlay";
import { DraftPolyOverlay } from "../overlays/DraftPolyOverlay";
import { SelectedFogOverlay } from "../overlays/SelectedFogOverlay";

export type FogMode = "reveal" | "poly" | "hide" | null;

interface FogToolOptions {
  fogMode: FogMode;
  fogPolys: FogPoly[];
  stageRef: React.RefObject<Konva.Stage | null>;
  onFogDraw?: (poly: { points: number[] }) => void;
  onFogRemove?: (id: string) => void;
}

// Box reveal, polygon reveal, and hide-selection fog tools. Owns all three
// drafts plus the hide-mode selection, and exposes onMouseMove for the poly
// rubber-band segment.
export function useFogTool({
  fogMode,
  fogPolys,
  stageRef,
  onFogDraw,
  onFogRemove,
}: FogToolOptions): Tool & {
  onMouseMove(stage: Konva.Stage, evt: MouseEvent): void;
} {
  const [draft, setDraft] = useState<DraftRect | null>(null);
  // In-progress polygon vertices [x0,y0, x1,y1, ...] for the poly reveal tool.
  const [draftPoly, setDraftPoly] = useState<number[] | null>(null);
  // Current cursor world position, for the rubber-band segment while drawing.
  const [polyCursor, setPolyCursor] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [selectedFogId, setSelectedFogId] = useState<string | null>(null);
  const selectedFogIdRef = useRef<string | null>(null);

  function setFogSelection(id: string | null) {
    selectedFogIdRef.current = id;
    setSelectedFogId(id);
  }

  // Clear fog selection whenever hide mode is left
  useEffect(() => {
    if (fogMode !== "hide") setFogSelection(null);
  }, [fogMode]);

  // Reset the in-progress polygon when leaving poly mode; Esc cancels it too.
  useEffect(() => {
    if (fogMode !== "poly") {
      setDraftPoly(null);
      setPolyCursor(null);
      return;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setDraftPoly(null);
        setPolyCursor(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fogMode]);

  function onMouseDown({ stage, start }: ToolContext): boolean {
    if (fogMode === "hide") {
      const hit = fogPolys.find((r) => pointInPoly(start.x, start.y, r.points));
      if (!hit) {
        setFogSelection(null);
      } else if (hit.id === selectedFogIdRef.current) {
        onFogRemove?.(hit.id);
        setFogSelection(null);
      } else {
        setFogSelection(hit.id);
      }
      return true;
    }

    if (fogMode === "poly") {
      const cur = draftPoly ?? [];
      // Click near the first vertex (>= 3 placed) closes the polygon.
      if (cur.length >= 6) {
        const tol = 10 / stage.scaleX();
        if (Math.hypot(start.x - cur[0], start.y - cur[1]) <= tol) {
          onFogDraw?.({ points: cur });
          setDraftPoly(null);
          setPolyCursor(null);
          return true;
        }
      }
      setDraftPoly([...cur, start.x, start.y]);
      setPolyCursor(start);
      return true;
    }

    if (fogMode === "reveal") {
      let localDraft: DraftRect = {
        x: start.x,
        y: start.y,
        width: 0,
        height: 0,
      };
      setDraft(localDraft);
      startDrag(
        (ev) => {
          const cur = clientToWorld(stage, ev.clientX, ev.clientY);
          localDraft = {
            x: Math.min(start.x, cur.x),
            y: Math.min(start.y, cur.y),
            width: Math.abs(cur.x - start.x),
            height: Math.abs(cur.y - start.y),
          };
          setDraft(localDraft);
        },
        () => {
          if (localDraft.width > 2 && localDraft.height > 2) {
            const { x, y, width, height } = localDraft;
            onFogDraw?.({
              points: [x, y, x + width, y, x + width, y + height, x, y + height],
            });
          }
          setDraft(null);
        },
      );
      return true;
    }

    return false;
  }

  function onMouseMove(stage: Konva.Stage, evt: MouseEvent) {
    if (fogMode === "poly" && draftPoly) {
      setPolyCursor(clientToWorld(stage, evt.clientX, evt.clientY));
    }
  }

  const selFogPoly = selectedFogId
    ? fogPolys.find((r) => r.id === selectedFogId)
    : null;

  const overlay = (
    <>
      {selFogPoly && <SelectedFogOverlay poly={selFogPoly} />}
      {draft && <DraftRectOverlay rect={draft} />}
      {draftPoly && (
        <DraftPolyOverlay
          poly={draftPoly}
          cursor={polyCursor}
          scale={stageRef.current?.scaleX() ?? 1}
        />
      )}
    </>
  );

  return { onMouseDown, onMouseMove, overlay };
}
