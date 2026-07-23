import type { ArrowOverlay, RadiusCircle } from "../../../hooks/useGameSocket";
import { clientToWorld, startDrag } from "../canvasMath";
import type { ActiveTool, Tool, ToolContext } from "./types";

interface MeasureToolOptions {
  tool: ActiveTool;
  onArrowUpdate?: (arrow: ArrowOverlay) => void;
  onArrowClear?: () => void;
  onRadiusUpdate?: (circle: RadiusCircle) => void;
  onRadiusClear?: () => void;
}

// Arrow and radius measurement share one drag→emit→clear loop, differing only
// in the payload shape. The overlays themselves are prop-driven in MapCanvas.
export function useMeasureTool({
  tool,
  onArrowUpdate,
  onArrowClear,
  onRadiusUpdate,
  onRadiusClear,
}: MeasureToolOptions): Tool {
  function onMouseDown({ stage, start }: ToolContext): boolean {
    if (tool === "arrow") {
      onArrowUpdate?.({ x1: start.x, y1: start.y, x2: start.x, y2: start.y });
      startDrag(
        (ev) => {
          const cur = clientToWorld(stage, ev.clientX, ev.clientY);
          onArrowUpdate?.({ x1: start.x, y1: start.y, x2: cur.x, y2: cur.y });
        },
        () => onArrowClear?.(),
      );
      return true;
    }

    if (tool === "radius") {
      onRadiusUpdate?.({ x: start.x, y: start.y, x2: start.x, y2: start.y });
      startDrag(
        (ev) => {
          const cur = clientToWorld(stage, ev.clientX, ev.clientY);
          onRadiusUpdate?.({ x: start.x, y: start.y, x2: cur.x, y2: cur.y });
        },
        () => onRadiusClear?.(),
      );
      return true;
    }

    return false;
  }

  return { onMouseDown };
}
