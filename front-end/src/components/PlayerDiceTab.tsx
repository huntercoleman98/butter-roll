import type { RefObject } from "react";
import type { DiceRollResult } from "../hooks/useGameSocket";
import { d20AdvantageLabel, type AdvModeOrNormal } from "../utils/parseDiceExpression";

const DIE_SIDES = [4, 6, 8, 10, 12, 20, 100];

function formatEntry(r: DiceRollResult): string {
  if (r.private) return `${r.label ?? r.expression} → 🗼 rolled in the tower`;
  const desc = r.label ? `${r.expression} ${r.label}` : r.expression;
  const showRolls = r.rolls.length > 1 || r.modifier !== 0;
  const rollsStr = showRolls ? ` (${r.rolls.join(", ")})` : "";
  return `${desc} → ${r.total}${rollsStr}`;
}

interface Props {
  ready: boolean;
  advMode: AdvModeOrNormal;
  accentColor: string;
  expr: string;
  setExpr: (v: string) => void;
  setError: (v: string) => void;
  error: string;
  submit: () => void;
  handleRoll: (expression: string, label?: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  history: DiceRollResult[];
  historyRef: RefObject<HTMLDivElement | null>;
}

// The "Dice" tab of the player window: the quick-roll die grid, the free-form
// expression input, and the roll-history log. All roll state lives in
// usePlayerDice (owned by <Player>); this is the view.
export default function PlayerDiceTab({
  ready,
  advMode,
  accentColor,
  expr,
  setExpr,
  setError,
  error,
  submit,
  handleRoll,
  inputRef,
  history,
  historyRef,
}: Props) {
  return (
    <>
      <div className="player-tab-body">
        <div className="player-controls">
          <div className="player-die-grid">
            {DIE_SIDES.map((sides) => (
              <button
                key={sides}
                disabled={!ready}
                onClick={() =>
                  handleRoll(`d${sides}`, d20AdvantageLabel(1, sides, advMode))
                }
                className="player-die-btn"
                style={{ borderLeft: `4px solid ${accentColor}` }}
              >
                d{sides}
              </button>
            ))}
          </div>

          <div className="player-roll-row">
            <input
              ref={inputRef}
              type="text"
              placeholder="e.g. 2d6+3"
              value={expr}
              disabled={!ready}
              onChange={(e) => {
                setExpr(e.target.value);
                setError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
            <button disabled={!ready} onClick={submit}>
              Roll
            </button>
          </div>

          {error && <div className="player-error">{error}</div>}
        </div>
      </div>

      <div className="player-history-wrapper">
        <div className="player-history-label">Roll History</div>
        <div className="player-history" ref={historyRef}>
          {history.length === 0 ? (
            <div className="player-history-empty">No rolls yet.</div>
          ) : (
            history.map((r, i) => (
              <div key={i} className="player-history-entry">
                {formatEntry(r)}
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
