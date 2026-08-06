import { useState } from "react";
import { uuid } from "../utils/uuid";
import type {
  DiceRollResult,
  DiceRequest,
  OutgoingPayload,
} from "./useGameSocket";

// Owns dice-roll dispatch for the DM: the queue of private rolls handed to
// <DiceOverlay> and the three "roll" entry points. The history itself is the
// socket's diceLog (accumulated at the source), shown in full; the DM's own
// private rolls are pushed into that same log via appendDiceResult so they
// interleave with broadcasts in arrival order. Initiative-roll resolution
// reacts to the latest diceResult separately in useInitiative.
export function useDiceHistory({
  diceLog,
  appendDiceResult,
  send,
}: {
  diceLog: DiceRollResult[];
  appendDiceResult: (result: DiceRollResult) => void;
  send: (payload: OutgoingPayload) => void;
}) {
  const [privateRollRequests, setPrivateRollRequests] = useState<DiceRequest[]>(
    [],
  );

  // A private roll resolved locally by <DiceOverlay> (never broadcast); record
  // it as the DM's in the shared log.
  function handleDiceResult(result: DiceRollResult) {
    appendDiceResult({ ...result, private: true, playerName: "DM" });
  }

  function handleRoll(
    expression: string,
    isPrivate: boolean,
    advMode?: "advantage" | "disadvantage",
    label?: string,
  ) {
    if (isPrivate) {
      setPrivateRollRequests((prev) => [
        ...prev,
        { id: uuid(), expression, advMode, label },
      ]);
    } else {
      send({
        case: "diceRollRequest",
        value: { expression, playerName: "DM", advMode, label },
      });
    }
  }

  // Rolls the DM makes on someone's behalf. playerName defaults to "DM" but is
  // overridden when rolling from a player's character sheet, so the log reads
  // "<Player> rolled …" rather than "DM rolled …".
  function handleMonsterRoll(
    expression: string,
    label?: string,
    playerName = "DM",
  ) {
    send({
      case: "diceRollRequest",
      value: { expression, playerName, label },
    });
  }

  return {
    history: diceLog,
    privateRollRequests,
    handleRoll,
    handleDiceResult,
    handleMonsterRoll,
  };
}
