import { useEffect, useRef, useState } from "react";
import type { DiceRollResult, OutgoingPayload } from "./useGameSocket";
import {
  parseDiceExpression,
  rollLocally,
  advantageLabel,
  d20AdvantageLabel,
} from "../utils/parseDiceExpression";

export type AdvState = "normal" | "advantage" | "disadvantage";

// Owns the player's dice flow: the roll-bar input state (expression, private
// toggle, advantage mode, error), the local roll-history log, and the three
// roll entry points. `handleRoll`/`rollCheck` are handed to <CharacterSheet> so
// ability checks and attacks route through the same path as the die grid.
export function usePlayerDice({
  playerName,
  diceColor,
  myClientId,
  diceResult,
  send,
}: {
  playerName: string | undefined;
  diceColor: string | undefined;
  myClientId: string | null;
  diceResult: DiceRollResult | null;
  send: (payload: OutgoingPayload) => void;
}) {
  const [expr, setExpr] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [advMode, setAdvMode] = useState<AdvState>("normal");
  const [error, setError] = useState("");
  const [history, setHistory] = useState<DiceRollResult[]>([]);
  const historyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the history view pinned to the newest roll.
  useEffect(() => {
    const el = historyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [history]);

  // Append each of our own public broadcast results as they arrive. Private
  // rolls are added synchronously in handleRoll instead (they never round-trip).
  useEffect(() => {
    if (
      diceResult &&
      diceResult.clientId === myClientId &&
      !diceResult.private
    ) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- accumulating each new broadcast result; reacting to an external changing value is the intended use of an effect
      setHistory((prev) => [...prev, diceResult]);
    }
  }, [diceResult, myClientId]);

  function handleRoll(expression: string, label?: string) {
    if (!playerName) return;
    const trimmed = expression.trim();
    if (!trimmed) return;
    const parsed = parseDiceExpression(trimmed);
    if (!parsed) {
      setError("Invalid expression. Use e.g. 2d6+3 (max 20 dice).");
      return;
    }
    setError("");

    if (isPrivate) {
      const { sides, modifier } = parsed;
      const { rolls, total } = rollLocally(parsed, advMode);
      send({
        case: "diceRollResult",
        value: {
          expression: trimmed,
          sides,
          rolls,
          modifier,
          total,
          clientId: myClientId ?? undefined,
          private: true,
          playerName,
          diceColor,
          label,
        },
      });
      setHistory((prev) => [
        ...prev,
        { expression: trimmed, sides, rolls, modifier, total, private: true, label },
      ]);
    } else {
      send({
        case: "diceRollRequest",
        value: {
          expression: trimmed,
          clientId: myClientId ?? undefined,
          playerName,
          diceColor,
          advMode: advMode !== "normal" ? advMode : undefined,
          label,
        },
      });
    }
  }

  function submit() {
    const trimmed = expr.trim();
    const parsed = parseDiceExpression(trimmed);
    const label = parsed
      ? d20AdvantageLabel(parsed.count, parsed.sides, advMode)
      : undefined;
    handleRoll(trimmed, label);
    inputRef.current?.select();
  }

  // A d20 check with a flat modifier, respecting the adv/disadv toggle. Used by
  // the character sheet for ability checks, attacks, and spell casts.
  function rollCheck(mod: number, baseLabel: string) {
    const expression = mod === 0 ? "1d20" : mod > 0 ? `1d20+${mod}` : `1d20${mod}`;
    const suffix = advantageLabel(advMode);
    handleRoll(expression, suffix ? `${baseLabel} ${suffix}` : baseLabel);
  }

  return {
    expr,
    setExpr,
    isPrivate,
    setIsPrivate,
    advMode,
    setAdvMode,
    error,
    setError,
    history,
    historyRef,
    inputRef,
    handleRoll,
    submit,
    rollCheck,
  };
}
