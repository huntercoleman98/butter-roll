import { Layer, Rect } from "react-konva";
import type { DraftRect } from "../tools/types";

// Dashed rectangle shown while dragging out a fog-reveal box.
export function DraftRectOverlay({ rect }: { rect: DraftRect }) {
  return (
    <Layer listening={false}>
      <Rect
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
        fill="rgba(255,255,255,0.15)"
        stroke="rgba(255,255,255,0.9)"
        strokeWidth={2}
        dash={[6, 4]}
        listening={false}
      />
    </Layer>
  );
}
