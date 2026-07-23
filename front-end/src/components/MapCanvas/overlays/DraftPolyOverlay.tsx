import { Layer, Line, Circle } from "react-konva";

interface DraftPolyOverlayProps {
  poly: number[];
  cursor: { x: number; y: number } | null;
  scale: number;
}

// In-progress fog-reveal polygon: the placed edges plus a rubber-band segment
// to the cursor, and a marker on the first vertex (which closes the shape).
export function DraftPolyOverlay({ poly, cursor, scale }: DraftPolyOverlayProps) {
  return (
    <Layer listening={false}>
      <Line
        points={cursor ? [...poly, cursor.x, cursor.y] : poly}
        stroke="rgba(255,255,255,0.9)"
        strokeWidth={2}
        dash={[6, 4]}
        listening={false}
      />
      {/* First vertex: shown from the first click; closes the polygon once >= 3 vertices */}
      <Circle
        x={poly[0]}
        y={poly[1]}
        radius={6 / scale}
        stroke="rgba(255,255,255,0.9)"
        strokeWidth={2}
        fill="rgba(255,255,255,0.3)"
        listening={false}
      />
    </Layer>
  );
}
