import { Layer, Circle, Line, Text } from "react-konva";
import type { RadiusCircle } from "../../../hooks/useGameSocket";

// Measurement circle with a radius line and distance label.
export function RadiusOverlay({ circle }: { circle: RadiusCircle }) {
  const { x, y, x2, y2 } = circle;
  const radius = Math.sqrt((x2 - x) ** 2 + (y2 - y) ** 2);
  const dist = ((radius / 60) * 5).toFixed(1);
  const mx = (x + x2) / 2;
  const my = (y + y2) / 2;
  return (
    <Layer listening={false}>
      <Circle
        x={x}
        y={y}
        radius={radius}
        stroke="rgba(0,0,0,0.9)"
        strokeWidth={5}
        fill="transparent"
        listening={false}
      />
      <Circle
        x={x}
        y={y}
        radius={radius}
        stroke="rgba(255,235,59,0.95)"
        strokeWidth={2}
        fill="transparent"
        listening={false}
      />
      <Line
        points={[x, y, x2, y2]}
        stroke="rgba(0,0,0,0.9)"
        strokeWidth={5}
        listening={false}
      />
      <Line
        points={[x, y, x2, y2]}
        stroke="rgba(255,235,59,0.95)"
        strokeWidth={2}
        listening={false}
      />
      <Text
        x={mx + 6}
        y={my - 14}
        text={`${dist} ft.`}
        fontSize={28}
        fill="white"
        stroke="black"
        strokeWidth={4}
        fillAfterStrokeEnabled
        listening={false}
      />
    </Layer>
  );
}
