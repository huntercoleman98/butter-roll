import { useEffect, useState } from "react";
import { uuid } from "../utils/uuid";
import type {
  DiceRollResult,
  DiceRequest,
  OutgoingPayload,
} from "./useGameSocket";

// Owns the dice log and roll dispatch: the broadcast history, the queue of
// private rolls handed to <DiceOverlay>, and the three "roll" entry points.
// The incoming `diceResult` (a broadcast from the server) is appended here;
// initiative-roll resolution reacts to the same result separately in
// useInitiative.
export function useDiceHistory({
  diceResult,
  send,
}: {
  diceResult: DiceRollResult | null;
  send: (payload: OutgoingPayload) => void;
}) {
  const [history, setHistory] = useState<DiceRollResult[]>([]);
  const [privateRollRequests, setPrivateRollRequests] = useState<DiceRequest[]>(
    [],
  );

  // Append each broadcast roll result to the history log.
  useEffect(() => {
    if (!diceResult) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- accumulating each new broadcast result; reacting to an external changing value is the intended use of an effect
    setHistory((prev) => [...prev, diceResult]);
  }, [diceResult]);

  // A private roll resolved locally by <DiceOverlay>; log it as the DM's.
  function handleDiceResult(result: DiceRollResult) {
    setHistory((prev) => [
      ...prev,
      { ...result, private: true, playerName: "DM" },
    ]);
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
    history,
    privateRollRequests,
    handleRoll,
    handleDiceResult,
    handleMonsterRoll,
  };
}
