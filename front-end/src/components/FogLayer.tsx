import { Layer, Rect, Line } from "react-konva";
import type { FogPoly } from "../hooks/useGameSocket";

interface FogLayerProps {
  fogPolys: FogPoly[];
  opacity: number;
}

export default function FogLayer({ fogPolys, opacity }: FogLayerProps) {
  return (
    <Layer listening={false}>
      {/* Opacity lives on the fill, not the layer, so destination-out punches at full alpha */}
      <Rect
        x={-50000}
        y={-50000}
        width={100000}
        height={100000}
        fill={`rgba(0,0,0,${opacity})`}
        listening={false}
      />
      {/* Each polygon is a hole punched through the overlay via destination-out */}
      {fogPolys.map((p) => (
        <Line
          key={p.id}
          points={p.points}
          closed
          fill="black"
          globalCompositeOperation="destination-out"
          listening={false}
        />
      ))}
    </Layer>
  );
}
