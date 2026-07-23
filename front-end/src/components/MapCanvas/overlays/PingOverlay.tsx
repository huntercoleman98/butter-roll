import { Layer, Circle } from "react-konva";
import type { Ping } from "../../../hooks/useGameSocket";

// Concentric pulse marker dropped by a long-press ping.
export function PingOverlay({ ping }: { ping: Ping }) {
  return (
    <Layer listening={false}>
      <Circle
        x={ping.x}
        y={ping.y}
        radius={10}
        fill="rgba(255,235,59,0.95)"
        listening={false}
      />
      <Circle
        x={ping.x}
        y={ping.y}
        radius={30}
        stroke="rgba(255,235,59,0.6)"
        strokeWidth={3}
        fill="transparent"
        listening={false}
      />
      <Circle
        x={ping.x}
        y={ping.y}
        radius={55}
        stroke="rgba(255,235,59,0.25)"
        strokeWidth={2}
        fill="transparent"
        listening={false}
      />
    </Layer>
  );
}
