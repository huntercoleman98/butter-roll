import { Layer, Rect } from "react-konva";
import type { DraftRect } from "../tools/types";

// Marquee selection rectangle drawn over empty space in select mode.
export function SelectionRectOverlay({ rect }: { rect: DraftRect }) {
  return (
    <Layer listening={false}>
      <Rect
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
        fill="rgba(250,204,21,0.08)"
        stroke="rgba(250,204,21,0.8)"
        strokeWidth={1}
        dash={[4, 3]}
        listening={false}
      />
    </Layer>
  );
}
