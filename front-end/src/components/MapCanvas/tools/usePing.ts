import { useRef } from "react";
import type { ActiveTool, ToolContext } from "./types";

interface PingOptions {
  readOnly: boolean;
  tool: ActiveTool;
  onPing?: (pos: { x: number; y: number }) => void;
}

// Long-press ping in select mode. Non-consuming: it arms a timer alongside the
// marquee-select handler and, when the press lands on a token, sets a flag so
// the ensuing token click is swallowed rather than treated as a selection.
export function usePing({ readOnly, tool, onPing }: PingOptions) {
  const suppressNextTokenClickRef = useRef(false);

  function onMouseDown({ evt, start, targetIsToken }: ToolContext) {
    if (readOnly || tool !== "select" || !onPing) return;
    let pingCancelled = false;
    const pingTimer = setTimeout(() => {
      if (!pingCancelled) {
        if (targetIsToken) suppressNextTokenClickRef.current = true;
        onPing(start);
      }
    }, 500);
    function cancelPing() {
      pingCancelled = true;
      clearTimeout(pingTimer);
      window.removeEventListener("mouseup", cancelPing);
      window.removeEventListener("mousemove", checkPingMove);
    }
    function checkPingMove(ev: MouseEvent) {
      const dx = ev.clientX - evt.clientX;
      const dy = ev.clientY - evt.clientY;
      if (dx * dx + dy * dy > 25) cancelPing();
    }
    window.addEventListener("mouseup", cancelPing);
    window.addEventListener("mousemove", checkPingMove);
  }

  // Reads and clears the suppress flag; returns true if the next token click
  // should be ignored.
  function consumeSuppressedClick(): boolean {
    if (suppressNextTokenClickRef.current) {
      suppressNextTokenClickRef.current = false;
      return true;
    }
    return false;
  }

  return { onMouseDown, consumeSuppressedClick };
}
