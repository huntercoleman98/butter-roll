import { ContextMenu } from "../../ContextMenu";

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
  return (
    <ContextMenu x={x} y={y} title="Canvas" onClose={onClose}>
      <li
        onClick={() => {
          onBringPlayersHere();
          onClose();
        }}
      >
        Bring player view here
      </li>
    </ContextMenu>
  );
}
