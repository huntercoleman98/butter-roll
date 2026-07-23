import type Konva from "konva";

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 10;

export function clientToWorld(
  stage: Konva.Stage,
  clientX: number,
  clientY: number,
) {
  const rect = stage.container().getBoundingClientRect();
  return {
    x: (clientX - rect.left - stage.x()) / stage.scaleX(),
    y: (clientY - rect.top - stage.y()) / stage.scaleY(),
  };
}

// Ray-casting point-in-polygon test. pts is a flat [x0,y0, x1,y1, ...] list.
export function pointInPoly(px: number, py: number, pts: number[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const xi = pts[i],
      yi = pts[i + 1],
      xj = pts[j],
      yj = pts[j + 1];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

export function startDrag(
  onMove: (ev: MouseEvent) => void,
  onUp: (ev: MouseEvent) => void,
) {
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", function handler(ev: MouseEvent) {
    onUp(ev);
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", handler);
  });
}
