import { useRef } from "react";
import { useOutsideClick } from "../../../hooks/useOutsideClick";

interface CanvasContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  onBringPlayersHere: () => void;
}

// Right-click-on-empty-canvas menu. Currently a single action; the world-center
// math for "bring player view here" lives in MapCanvas and is passed in.
export function CanvasContextMenu({
  x,
  y,
  onClose,
  onBringPlayersHere,
}: CanvasContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClick(ref, onClose);

  return (
    <div
      ref={ref}
      className="window context-menu"
      style={{ position: "fixed", left: x, top: y, zIndex: 1000 }}
    >
      <div className="title-bar">
        <div className="title-bar-text">Canvas</div>
        <div className="title-bar-controls">
          <button aria-label="Close" onClick={onClose} />
        </div>
      </div>
      <div className="window-body">
        <ul className="tree-view">
          <li
            onClick={() => {
              onBringPlayersHere();
              onClose();
            }}
          >
            Bring player view here
          </li>
        </ul>
      </div>
    </div>
  );
}
