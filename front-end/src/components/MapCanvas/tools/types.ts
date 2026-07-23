import type { ReactNode } from "react";
import type Konva from "konva";

export type ActiveTool =
  | "select"
  | "fog-reveal-box"
  | "fog-reveal-poly"
  | "fog-hide"
  | "arrow"
  | "radius";

export interface DraftRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Shared state handed to every tool's mousedown handler. `start` is the
// left-button press point already converted to world coordinates.
export interface ToolContext {
  stage: Konva.Stage;
  evt: MouseEvent;
  start: { x: number; y: number };
  targetIsToken: boolean;
}

// A tool encapsulates one mousedown flow and (optionally) the overlay it draws.
export interface Tool {
  // true = "I consumed this mousedown"; the dispatcher stops after this.
  onMouseDown(ctx: ToolContext): boolean;
  overlay?: ReactNode;
}
