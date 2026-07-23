import Konva from "konva";
import { MIN_SCALE, MAX_SCALE, startDrag } from "../canvasMath";

interface PanZoomOptions {
  // Called when a right-click ends without meaningful movement (context menu).
  // Left undefined to disable the canvas context menu entirely.
  onContextRequest?: (clientX: number, clientY: number) => void;
}

export function usePanZoom({ onContextRequest }: PanZoomOptions) {
  function onWheel(e: Konva.KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault();
    const stage = e.target.getStage();
    if (!stage) return;
    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition()!;
    const factor = e.evt.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, oldScale * factor));
    stage.scale({ x: newScale, y: newScale });
    stage.position({
      x: pointer.x - (pointer.x - stage.x()) * (newScale / oldScale),
      y: pointer.y - (pointer.y - stage.y()) * (newScale / oldScale),
    });
  }

  // Handles right-button pan/context. Returns true when it consumed the event.
  function onMouseDown(
    stage: Konva.Stage,
    evt: MouseEvent,
    targetIsToken: boolean,
  ): boolean {
    if (evt.button !== 2) return false;
    if (targetIsToken) return true; // no pan/menu when right-clicking a token
    evt.preventDefault();
    const startClientX = evt.clientX;
    const startClientY = evt.clientY;
    const startPos = {
      x: evt.clientX - stage.x(),
      y: evt.clientY - stage.y(),
    };
    startDrag(
      (ev) =>
        stage.position({
          x: ev.clientX - startPos.x,
          y: ev.clientY - startPos.y,
        }),
      (ev) => {
        const dx = ev.clientX - startClientX;
        const dy = ev.clientY - startClientY;
        if (dx * dx + dy * dy < 16) onContextRequest?.(ev.clientX, ev.clientY);
      },
    );
    return true;
  }

  return { onWheel, onMouseDown };
}
