import { useEffect, useRef } from "react";
import Konva from "konva";
import type { ViewportSync } from "../../hooks/useGameSocket";

// Applies DM-driven viewport syncs (viewer only) as a smooth tween.
export function useViewportSync(
  stageRef: React.RefObject<Konva.Stage | null>,
  mapAreaRef: React.RefObject<HTMLDivElement | null>,
  syncedViewport: ViewportSync | null,
) {
  const viewportTweenRef = useRef<Konva.Tween | null>(null);

  useEffect(() => {
    if (!syncedViewport || !stageRef.current || !mapAreaRef.current) return;
    const { worldCenterX, worldCenterY, scale } = syncedViewport;
    const w = mapAreaRef.current.clientWidth;
    const h = mapAreaRef.current.clientHeight;
    const targetX = w / 2 - worldCenterX * scale;
    const targetY = h / 2 - worldCenterY * scale;
    viewportTweenRef.current?.destroy();
    viewportTweenRef.current = new Konva.Tween({
      node: stageRef.current,
      x: targetX,
      y: targetY,
      scaleX: scale,
      scaleY: scale,
      duration: 0.4,
      easing: Konva.Easings.EaseInOut,
      onFinish: () => {
        viewportTweenRef.current = null;
      },
    });
    viewportTweenRef.current.play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncedViewport]);
}
