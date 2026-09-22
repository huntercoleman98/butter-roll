import { useEffect, useRef, useState } from "react";
import type { PointerEvent, RefObject } from "react";
import type { PartyInvItem } from "./useGameSocket";

// Pointer-based drag of a party item across sections. Generalizes useDragReorder:
// because a drop can land in any section (not just the row's own list), it
// hit-tests with document.elementsFromPoint on every animation frame (rows are
// tagged data-item-id/data-section-id; each group has a data-section-dropzone),
// and auto-scrolls when the finger nears the scroll container's top/bottom edge
// so off-screen sections are reachable. On drop it emits a section move (if the
// section changed) plus a reorder of the full global id list to the drop spot.
//
// Built on Pointer Events + setPointerCapture (works with touch), like
// useDragReorder. The handle needs `touch-action: none` in CSS.

interface DropTarget {
  sectionId: string;
  beforeId: string | null; // insert before this item; null = end of section
}

interface Args {
  items: PartyInvItem[];
  scrollRef: RefObject<HTMLElement | null>;
  moveItemToSection: (itemId: string, sectionId: string) => void;
  onReorder: (items: PartyInvItem[]) => void;
}

const EDGE = 56; // px from an edge that triggers auto-scroll
const SPEED = 14; // px scrolled per frame while in the edge zone

// Rebuild the global ordered list with the dragged item moved to the drop spot
// (and re-tagged with its new section). Pure, so it lives outside the hook.
function reorderedFor(
  items: PartyInvItem[],
  dragId: string,
  target: DropTarget,
): PartyInvItem[] {
  const moved = items.find((it) => it.id === dragId);
  if (!moved) return items;
  const without = items.filter((it) => it.id !== dragId);
  let index = without.length;
  if (target.beforeId) {
    const i = without.findIndex((it) => it.id === target.beforeId);
    if (i >= 0) index = i;
  } else {
    // End of the target section: after its last current item.
    let last = -1;
    without.forEach((it, i) => {
      if (it.sectionId === target.sectionId) last = i;
    });
    if (last >= 0) index = last + 1;
  }
  return [
    ...without.slice(0, index),
    { ...moved, sectionId: target.sectionId },
    ...without.slice(index),
  ];
}

export function usePartyItemDrag({
  items,
  scrollRef,
  moveItemToSection,
  onReorder,
}: Args) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);

  // Refs so the rAF loop reads live values without being re-created.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const dragIdRef = useRef<string | null>(null);
  const dropRef = useRef<DropTarget | null>(null);
  const posRef = useRef({ x: 0, y: 0 });
  const rafRef = useRef<number | null>(null);

  useEffect(() => () => stopLoop(), []);

  function stopLoop() {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }

  function reset() {
    stopLoop();
    dragIdRef.current = null;
    dropRef.current = null;
    setDraggingId(null);
    setDrop(null);
  }

  function setTarget(t: DropTarget) {
    dropRef.current = t;
    setDrop(t);
  }

  // The next item in a section after `id`, skipping the dragged one.
  function nextRowId(sectionId: string, id: string): string | null {
    const group = itemsRef.current.filter((it) => it.sectionId === sectionId);
    const idx = group.findIndex((it) => it.id === id);
    for (let i = idx + 1; i < group.length; i++) {
      if (group[i].id !== dragIdRef.current) return group[i].id;
    }
    return null;
  }

  function computeDrop() {
    const { x, y } = posRef.current;
    for (const el of document.elementsFromPoint(x, y)) {
      const row = el.closest<HTMLElement>("[data-item-id]");
      if (row && row.getAttribute("data-item-id") !== dragIdRef.current) {
        const sectionId = row.getAttribute("data-section-id") ?? "";
        const id = row.getAttribute("data-item-id")!;
        const r = row.getBoundingClientRect();
        const beforeId = y > r.top + r.height / 2 ? nextRowId(sectionId, id) : id;
        setTarget({ sectionId, beforeId });
        return;
      }
      const zone = el.closest<HTMLElement>("[data-section-dropzone]");
      if (zone) {
        setTarget({ sectionId: zone.getAttribute("data-section-id") ?? "", beforeId: null });
        return;
      }
    }
  }

  function loop() {
    const sc = scrollRef.current;
    if (sc) {
      const r = sc.getBoundingClientRect();
      const { y } = posRef.current;
      if (y < r.top + EDGE) sc.scrollTop -= SPEED;
      else if (y > r.bottom - EDGE) sc.scrollTop += SPEED;
    }
    computeDrop();
    rafRef.current = requestAnimationFrame(loop);
  }

  function commit() {
    const dragId = dragIdRef.current;
    const target = dropRef.current;
    if (dragId && target) {
      const item = itemsRef.current.find((it) => it.id === dragId);
      if (item) {
        if (item.sectionId !== target.sectionId) {
          moveItemToSection(dragId, target.sectionId);
        }
        onReorder(reorderedFor(itemsRef.current, dragId, target));
      }
    }
    reset();
  }

  return {
    draggingId,
    drop,
    handleProps: (id: string) => ({
      onPointerDown: (e: PointerEvent) => {
        dragIdRef.current = id;
        setDraggingId(id);
        posRef.current = { x: e.clientX, y: e.clientY };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        stopLoop();
        rafRef.current = requestAnimationFrame(loop);
      },
      onPointerMove: (e: PointerEvent) => {
        if (!dragIdRef.current) return;
        posRef.current = { x: e.clientX, y: e.clientY };
      },
      onPointerUp: commit,
      onPointerCancel: reset,
      // Safety net for a gesture that ends without a pointerup reaching us, so
      // the dragged row never stays stuck in its grayed state.
      onLostPointerCapture: reset,
    }),
    rowProps: (item: PartyInvItem) => ({
      "data-item-id": item.id,
      "data-section-id": item.sectionId,
    }),
  };
}
