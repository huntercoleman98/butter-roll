import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useOutsideClick } from "../hooks/useOutsideClick";

interface ContextMenuProps {
  x: number;
  y: number;
  title: string;
  onClose: () => void;
  // Action items — typically <li onClick=…> entries.
  children: React.ReactNode;
}

// A Win98-styled right-click menu shell. Dismisses on outside click (via the
// shared useOutsideClick hook) or Escape, and clamps itself inside the viewport
// so a click near an edge never overflows off-screen.
export function ContextMenu({ x, y, title, onClose, children }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useOutsideClick(ref, onClose);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Clamp within the viewport once the real size is known.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      x: Math.max(4, Math.min(x, window.innerWidth - width - 4)),
      y: Math.max(4, Math.min(y, window.innerHeight - height - 4)),
    });
  }, [x, y]);

  return (
    <div
      ref={ref}
      className="window context-menu"
      style={{ position: "fixed", left: pos.x, top: pos.y, zIndex: 2000 }}
    >
      <div className="title-bar">
        <div className="title-bar-text">{title}</div>
        <div className="title-bar-controls">
          <button aria-label="Close" onClick={onClose} />
        </div>
      </div>
      <div className="window-body">
        <ul className="tree-view">{children}</ul>
      </div>
    </div>
  );
}
