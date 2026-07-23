import { useRef, useState } from "react";
import MapCanvas from "../components/MapCanvas";
import DiceOverlay from "../components/DiceOverlay";
import { useGameSocket, type DiceRollResult } from "../hooks/useGameSocket";
import "../App.css";

const RESULT_DISPLAY_MS = 5000;

export default function Viewer() {
  const {
    pages,
    presentedPageId,
    arrowOverlay,
    radiusCircle,
    ping,
    viewportSync,
    diceRequests,
    send,
  } = useGameSocket();
  const mapAreaRef = useRef<HTMLDivElement>(null);
  const presentedPage = pages.find((p) => p.id === presentedPageId) ?? null;
  const [diceResult, setDiceResult] = useState<DiceRollResult | null>(null);
  const resultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleDiceResult(result: DiceRollResult) {
    send({ case: "diceRollResult", value: { ...result } });
    if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
    setDiceResult(result);
    resultTimerRef.current = setTimeout(
      () => setDiceResult(null),
      RESULT_DISPLAY_MS,
    );
  }

  function formatModifier(mod: number) {
    if (mod === 0) return "";
    return mod > 0 ? ` + ${mod}` : ` − ${Math.abs(mod)}`;
  }

  return (
    <div className="app">
      <MapCanvas
        mapUrl={presentedPage?.mapUrl ?? null}
        mapSize={presentedPage?.mapSize ?? null}
        tokens={presentedPage?.tokens.filter((t) => t.public) ?? []}
        fogPolys={presentedPage?.fogPolys ?? []}
        mapAreaRef={mapAreaRef}
        arrowOverlay={arrowOverlay}
        ping={ping}
        radiusCircle={radiusCircle}
        syncedViewport={viewportSync}
        readOnly
      />
      <DiceOverlay requests={diceRequests} onResult={handleDiceResult} />
      {diceResult && (
        <div className="dice-result-popup">
          <div className="window">
            <div className="title-bar">
              <div className="title-bar-text">Roll Result</div>
            </div>
            <div className="window-body dice-result-body">
              {diceResult.playerName && (
                <div className="dice-result-name">
                  {diceResult.playerName} rolled{diceResult.label ? ` ${diceResult.label}` : ""}:
                </div>
              )}
              <div className="dice-result-expression">
                {diceResult.expression}
              </div>
              <div className="dice-result-rolls">
                [{diceResult.rolls.join(", ")}]
                {formatModifier(diceResult.modifier)}
              </div>
              <div className="dice-result-total">{diceResult.total}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
