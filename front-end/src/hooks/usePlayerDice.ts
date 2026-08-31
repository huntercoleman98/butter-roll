import { useEffect, useMemo, useRef, useState } from "react";
import type { DiceRollResult, OutgoingPayload } from "./useGameSocket";
import {
  parseDiceExpression,
  rollLocally,
  advantageLabel,
  d20AdvantageLabel,
} from "../utils/parseDiceExpression";

export type AdvState = "normal" | "advantage" | "disadvantage";

// Owns the player's dice flow: the roll-bar input state (expression, private
// toggle, advantage mode, error) and the three roll entry points.
// `handleRoll`/`rollCheck` are handed to <CharacterSheet> so ability checks and
// attacks route through the same path as the die grid. The history is *derived*
// from the socket's diceLog (our own rolls, by clientId) — both public and
// private rolls arrive there as broadcast echoes, so there's nothing to
// accumulate locally.
export function usePlayerDice({
  playerName,
  diceColor,
  myClientId,
  diceLog,
  send,
}: {
  playerName: string | undefined;
  diceColor: string | undefined;
  myClientId: string | null;
  diceLog: DiceRollResult[];
  send: (payload: OutgoingPayload) => void;
}) {
  const [expr, setExpr] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [advMode, setAdvMode] = useState<AdvState>("normal");
  const [error, setError] = useState("");
  const historyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Our own rolls, in arrival order. Every roll we make — public (resolved and
  // rebroadcast by the viewer) or private (we broadcast the result directly) —
  // echoes back carrying our clientId, so filtering the shared log is all we need.
  const history = useMemo(
    () => diceLog.filter((r) => r.clientId === myClientId),
    [diceLog, myClientId],
  );

  // Keep the history view pinned to the newest roll.
  useEffect(() => {
    const el = historyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [history]);

  // metadata/tokenId flow through only on the public (diceRollRequest) path,
  // where the server evaluates rules: they let a companion's attack fire the
  // same webhooks a DM-driven monster roll does (metadata tags the roll as
  // 'to_hit'; tokenId resolves the firing token so its tags render into the
  // webhook body). They have no meaning on the private path, which resolves
  // locally and broadcasts a bare result.
  function handleRoll(
    expression: string,
    label?: string,
    metadata?: string,
    tokenId?: string,
  ) {
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
      // Resolved locally, but still broadcast so the DM sees the tower roll. It
      // echoes back with our clientId, landing in diceLog → history like any
      // other roll — no separate local append needed.
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
          metadata,
          tokenId,
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
