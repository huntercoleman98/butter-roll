import { useCallback, useEffect, useRef } from "react";
import DiceBox from "@3d-dice/dice-box";
import type { DiceRequest, DiceRollResult } from "../hooks/useGameSocket";
import { parseDiceExpression } from "../utils/parseDiceExpression";

const DICE_CLEAR_DELAY_MS = 5000;

interface Props {
  requests: DiceRequest[];
  onResult: (result: DiceRollResult) => void;
}

export default function DiceOverlay({ requests, onResult }: Props) {
  const boxRef = useRef<InstanceType<typeof DiceBox> | null>(null);
  const readyRef = useRef(false);
  const mountedRef = useRef(true);
  const processedIdsRef = useRef(new Set<string>());
  const pendingQueueRef = useRef<DiceRequest[]>([]);
  const outstandingRef = useRef(0);
  const clearTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onResultRef = useRef(onResult);

  useEffect(() => {
    onResultRef.current = onResult;
  });

  const doRoll = useCallback((box: InstanceType<typeof DiceBox>, req: DiceRequest) => {
    const parsed = parseDiceExpression(req.expression);
    if (!parsed) return;
    const { count, sides, modifier } = parsed;

    const useAdvDisadv = req.advMode != null && count === 1 && sides === 20;
    const notation = useAdvDisadv ? `2d${sides}` : `${count}d${sides}`;

    if (clearTimeoutRef.current !== null) {
      clearTimeout(clearTimeoutRef.current);
      clearTimeoutRef.current = null;
    }

    outstandingRef.current += 1;

    box
      .add(notation, req.diceColor ? { themeColor: req.diceColor } : {})
      .then((results: unknown) => {
        if (!mountedRef.current) return;
        outstandingRef.current -= 1;

        const dice = results as Array<{ value: number; sides: number }>;
        const values = dice.map((d) => d.value);
        let rolls: number[];
        let total: number;
        if (useAdvDisadv) {
          const picked =
            req.advMode === "advantage"
              ? Math.max(...values)
              : Math.min(...values);
          rolls = values;
          total = picked + modifier;
        } else {
          rolls = values;
          total = rolls.reduce((s, v) => s + v, 0) + modifier;
        }

        onResultRef.current({
          expression: req.expression,
          sides,
          rolls,
          modifier,
          total,
          clientId: req.clientId,
          playerName: req.playerName,
          diceColor: req.diceColor,
          label: req.label,
        });

        // Start the clear timer only once all concurrent rolls have settled.
        if (outstandingRef.current === 0) {
          clearTimeoutRef.current = setTimeout(() => {
            clearTimeoutRef.current = null;
            if (mountedRef.current) {
              try {
                box.clear();
              } catch {
                /* ignore */
              }
            }
          }, DICE_CLEAR_DELAY_MS);
        }
      })
      .catch(console.error);
  }, []);

  // Initialize once — no color dependency, color is supplied per-roll.
  useEffect(() => {
    // Per-effect cancellation flag. StrictMode (and any remount) runs this
    // effect twice with the same refs; a shared mountedRef guard is defeated
    // because the second mount resets it to true before the first init()
    // resolves. Without this local flag, a stale box whose canvas has already
    // been removed from the DOM could win the shared boxRef — the physics
    // worker still resolves rolls (result reported) but nothing renders.
    let cancelled = false;
    mountedRef.current = true;
    readyRef.current = false;

    const container = document.createElement("div");
    container.id = "dice-box-container";
    document.body.appendChild(container);

    const box = new DiceBox("#dice-box-container", {
      assetPath: "/assets/",
      theme: "default",
      scale: 5,
      gravity: 5,
    });

    box
      .init()
      .then(() => {
        if (cancelled) return;
        boxRef.current = box;
        readyRef.current = true;
        const queued = pendingQueueRef.current.splice(0);
        for (const req of queued) {
          doRoll(box, req);
        }
      })
      .catch(console.error);

    return () => {
      cancelled = true;
      mountedRef.current = false;
      readyRef.current = false;
      boxRef.current = null;
      if (clearTimeoutRef.current !== null) {
        clearTimeout(clearTimeoutRef.current);
        clearTimeoutRef.current = null;
      }
      try {
        box.clear();
      } catch {
        /* ignore */
      }
      container.remove();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Dispatch new requests as they arrive.
  useEffect(() => {
    for (const req of requests) {
      if (processedIdsRef.current.has(req.id)) continue;
      processedIdsRef.current.add(req.id);

      if (readyRef.current && boxRef.current) {
        doRoll(boxRef.current, req);
      } else {
        pendingQueueRef.current.push(req);
      }
    }
  }, [requests, doRoll]);

  return null;
}
