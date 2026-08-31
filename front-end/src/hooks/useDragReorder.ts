import { useRef, useState } from "react";
import type { PointerEvent } from "react";

// Drag-to-reorder for a plain array, driven by a per-row drag handle. Built on
// Pointer Events (not HTML5 drag-and-drop, which doesn't fire from touch on
// mobile) so it works with mouse, touch, and pen alike. Kept generic (and out
// of CharacterSheet) so any list — gear today, spells/attacks later — can reuse
// it without regrowing the page component.
//
// Usage: spread `handleProps(i)` onto the draggable handle and `rowProps(i)`
// onto the row. The handle needs `touch-action: none` in CSS so a touch-drag
// doesn't scroll the page. `draggingIndex`/`overIndex` drive styling.
export function useDragReorder<T>(items: T[], onReorder: (next: T[]) => void) {
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  // Live drag state read by move/up handlers without waiting for a re-render.
  const drag = useRef<{ from: number; over: number; rows: HTMLElement[] } | null>(
    null,
  );

  function reset() {
    drag.current = null;
    setDraggingIndex(null);
    setOverIndex(null);
  }

  function move(from: number, to: number) {
    if (from === to) return;
    const next = items.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onReorder(next);
  }

  // The row the pointer currently sits over, by comparing clientY against each
  // row's vertical midpoint. Falls through to the last row when below them all.
  function indexAt(clientY: number, rows: HTMLElement[]): number {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return i;
    }
    return rows.length - 1;
  }

  return {
    draggingIndex,
    overIndex,
    handleProps: (index: number) => ({
      // touch-action:none lives in CSS; see .sheet-drag-handle.
      onPointerDown: (e: PointerEvent) => {
        const handle = e.currentTarget;
        const row = handle.closest<HTMLElement>("[data-reorder-row]");
        const list = row?.parentElement;
        if (!list) return;
        const rows = Array.from(
          list.querySelectorAll<HTMLElement>("[data-reorder-row]"),
        );
        drag.current = { from: index, over: index, rows };
        setDraggingIndex(index);
        setOverIndex(index);
        // Route all subsequent pointer events here even as the finger leaves
        // the small handle.
        handle.setPointerCapture(e.pointerId);
      },
      onPointerMove: (e: PointerEvent) => {
        const d = drag.current;
        if (!d) return;
        const over = indexAt(e.clientY, d.rows);
        d.over = over;
        setOverIndex(over);
      },
      onPointerUp: () => {
        const d = drag.current;
        if (d) move(d.from, d.over);
        reset();
      },
      onPointerCancel: reset,
    }),
    rowProps: () => ({ "data-reorder-row": "" }),
  };
}
