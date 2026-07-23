import { Layer, Line } from "react-konva";
import type { FogPoly } from "../../../hooks/useGameSocket";

// Red dashed highlight around the fog polygon currently targeted in hide mode.
export function SelectedFogOverlay({ poly }: { poly: FogPoly }) {
  return (
    <Layer listening={false}>
      <Line
        points={poly.points}
        closed
        stroke="rgba(255,80,80,0.9)"
        strokeWidth={2}
        dash={[6, 4]}
        fill="rgba(255,60,60,0.15)"
        listening={false}
      />
    </Layer>
  );
}
