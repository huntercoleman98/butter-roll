import { Layer, Rect } from "react-konva";
import type { FogRect } from "../hooks/useGameSocket";

interface FogLayerProps {
  fogRects: FogRect[];
  opacity: number;
}

export default function FogLayer({ fogRects, opacity }: FogLayerProps) {
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
      {/* Each fog rect is a hole punched through the overlay via destination-out */}
      {fogRects.map((r) => (
        <Rect
          key={r.id}
          x={r.x}
          y={r.y}
          width={r.width}
          height={r.height}
          fill="black"
          globalCompositeOperation="destination-out"
          listening={false}
        />
      ))}
    </Layer>
  );
}
