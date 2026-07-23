import { Layer, Arrow, Text } from "react-konva";
import type { ArrowOverlay as ArrowOverlayData } from "../../../hooks/useGameSocket";

// Measurement arrow with a distance label (60px world units = 5 ft).
export function ArrowOverlay({ arrow }: { arrow: ArrowOverlayData }) {
  const { x1, y1, x2, y2 } = arrow;
  const dist = ((Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2) / 60) * 5).toFixed(1);
  return (
    <Layer listening={false}>
      <Arrow
        points={[x1, y1, x2, y2]}
        stroke="rgba(0,0,0,0.9)"
        strokeWidth={5}
        fill="rgba(0,0,0,0.9)"
        pointerLength={12}
        pointerWidth={10}
        listening={false}
      />
      <Arrow
        points={[x1, y1, x2, y2]}
        stroke="rgba(255,235,59,0.95)"
        strokeWidth={2}
        fill="rgba(255,235,59,0.95)"
        pointerLength={12}
        pointerWidth={10}
        listening={false}
      />
      <Text
        x={(x1 + x2) / 2 + 6}
        y={(y1 + y2) / 2 - 18}
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
