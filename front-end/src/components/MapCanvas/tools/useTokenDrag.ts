import { useRef } from "react";
import type Konva from "konva";
import type { TokenHandle } from "../../Token";

interface TokenDragOptions {
  selectedTokenIds?: Set<string>;
  stageRef: React.RefObject<Konva.Stage | null>;
  onSelectionChange?: (ids: Set<string>) => void;
  onMoveToken?: (id: string, x: number, y: number) => void;
}

// Group drag for the current selection. The dragged token drives the others
// imperatively via their exposed handles, then every final position is
// committed on drag end.
export function useTokenDrag({
  selectedTokenIds,
  stageRef,
  onSelectionChange,
  onMoveToken,
}: TokenDragOptions) {
  const dragStartPositions = useRef<Map<string, { x: number; y: number }>>(
    new Map(),
  );
  const tokenHandles = useRef<Map<string, TokenHandle>>(new Map());

  // Ref callback wired into each <Token> so the group drag can move siblings.
  function registerHandle(id: string, handle: TokenHandle | null) {
    if (handle) tokenHandles.current.set(id, handle);
    else tokenHandles.current.delete(id);
  }

  function onDragStart(id: string) {
    dragStartPositions.current.clear();
    if (!selectedTokenIds?.has(id)) {
      onSelectionChange?.(new Set([id]));
      return;
    }
    for (const selId of selectedTokenIds) {
      const node = stageRef.current?.findOne<Konva.Image>("#" + selId);
      if (node)
        dragStartPositions.current.set(selId, { x: node.x(), y: node.y() });
    }
  }

  function onDragMove(id: string, x: number, y: number) {
    const startDragged = dragStartPositions.current.get(id);
    if (!startDragged) return;
    const dx = x - startDragged.x;
    const dy = y - startDragged.y;
    for (const [selId, startPos] of dragStartPositions.current) {
      if (selId === id) continue;
      tokenHandles.current
        .get(selId)
        ?.setPosition(startPos.x + dx, startPos.y + dy);
    }
  }

  function onDragEnd(id: string, x: number, y: number) {
    const startDragged = dragStartPositions.current.get(id);
    if (!startDragged || dragStartPositions.current.size <= 1) {
      onMoveToken?.(id, x, y);
      dragStartPositions.current.clear();
      return;
    }
    const dx = x - startDragged.x;
    const dy = y - startDragged.y;
    for (const [selId, startPos] of dragStartPositions.current) {
      const finalX = selId === id ? x : startPos.x + dx;
      const finalY = selId === id ? y : startPos.y + dy;
      onMoveToken?.(selId, finalX, finalY);
    }
    dragStartPositions.current.clear();
  }

  return { registerHandle, onDragStart, onDragMove, onDragEnd };
}
