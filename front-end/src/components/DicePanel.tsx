import { useEffect, useRef, useState } from "react";
import { GiSheikahEye, GiSightDisabled } from "react-icons/gi";
import type { DiceRollResult } from "../hooks/useGameSocket";
import {
  parseDiceExpression,
  d20AdvantageLabel,
} from "../utils/parseDiceExpression";

interface Props {
  history: DiceRollResult[];
  onRoll: (expression: string, isPrivate: boolean, advMode?: "advantage" | "disadvantage", label?: string) => void;
  onClose: () => void;
  zIndex?: number;
  onFocus?: () => void;
}

const DIE_SIDES = [4, 6, 8, 10, 12, 20, 100];
const BONUS_VALUES = [4, 3, 2, 1, -1, -2, -3, -4];

function formatEntry(r: DiceRollResult): string {
  const name = r.playerName ?? "?";
  const desc = r.label ? `${r.expression} ${r.label}` : r.expression;
  const showRolls = r.rolls.length > 1 || r.modifier !== 0;
  const rollsStr = showRolls ? ` (${r.rolls.join(", ")})` : "";
  const tag = r.private ? " 🔒" : "";
  return `${name}: ${desc} → ${r.total}${rollsStr}${tag}`;
}

function applyBonus(expr: string, b: number | null): string {
  if (!b) return expr;
  const p = parseDiceExpression(expr);
  if (!p) return expr;
  const m = p.modifier + b;
  return `${p.count}d${p.sides}${m > 0 ? `+${m}` : m < 0 ? `${m}` : ""}`;
}

export default function DicePanel({ history, onRoll, onClose, zIndex = 150, onFocus }: Props) {
  const [expr, setExpr] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [advMode, setAdvMode] = useState<"normal" | "advantage" | "disadvantage">("normal");
  const [bonus, setBonus] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [controlsHeight, setControlsHeight] = useState<number | null>(null);
  const [pos, setPos] = useState(() => ({ x: window.innerWidth - 240, y: 60 }));
  const panelRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = historyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [history]);

  function submit() {
    const trimmed = expr.trim();
    if (!trimmed) return;
    const withBonus = applyBonus(trimmed, bonus);
    const parsed = parseDiceExpression(withBonus);
    if (!parsed) {
      setError("Invalid expression. Use e.g. 2d6+3 (max 20 dice).");
      return;
    }
    setError("");
    const av = advMode !== "normal" ? advMode : undefined;
    const label = d20AdvantageLabel(parsed.count, parsed.sides, advMode);
    onRoll(withBonus, isPrivate, av, label);
    inputRef.current?.select();
  }

  function handleDragStart(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    const startX = e.clientX - pos.x;
    const startY = e.clientY - pos.y;

    function onMouseMove(ev: MouseEvent) {
      setPos({ x: ev.clientX - startX, y: ev.clientY - startY });
    }
    function onMouseUp() {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  function handleResizeMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    const panel = panelRef.current;
    if (!panel) return;
    const startY = e.clientY;
    const startHeight =
      panel.querySelector<HTMLElement>(".dice-controls")?.offsetHeight ?? 0;

    function onMouseMove(ev: MouseEvent) {
      setControlsHeight(Math.max(40, startHeight + (ev.clientY - startY)));
    }
    function onMouseUp() {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  return (
    <div
      className="window dice-window"
      style={{ position: "fixed", left: pos.x, top: pos.y, zIndex }}
      ref={panelRef}
      onMouseDown={onFocus}
    >
      <div
        className="title-bar"
        onMouseDown={handleDragStart}
        style={{ cursor: "move" }}
      >
        <div className="title-bar-text">Dice</div>
        <div className="title-bar-controls">
          <button aria-label="Close" onClick={onClose} />
        </div>
      </div>
      <div className="window-body dice-window-body">
        <div
          className="dice-controls"
          style={controlsHeight !== null ? { height: controlsHeight } : {}}
        >
          <div className="dice-adv-row">
            <button
              className={`dice-adv-btn${advMode === "advantage" ? " is-active" : ""}`}
              onClick={() => setAdvMode((m) => m === "advantage" ? "normal" : "advantage")}
            >
              Adv
            </button>
            <button
              className={`dice-adv-btn${advMode === "disadvantage" ? " is-active" : ""}`}
              onClick={() => setAdvMode((m) => m === "disadvantage" ? "normal" : "disadvantage")}
            >
              Dis
            </button>
          </div>
          <div className="dice-mid">
            <div className="dice-die-buttons">
              {DIE_SIDES.map((sides) => (
                <button
                  key={sides}
                  onClick={() => {
                    const av = advMode !== "normal" ? advMode : undefined;
                    const label = d20AdvantageLabel(1, sides, advMode);
                    onRoll(applyBonus(`d${sides}`, bonus), isPrivate, av, label);
                  }}
                >
                  d{sides}
                </button>
              ))}
            </div>
            <div className="dice-bonus-col">
              {BONUS_VALUES.map((n) => (
                <button
                  key={n}
                  className={`dice-bonus-btn${bonus === n ? " is-active" : ""}`}
                  onClick={() => setBonus((b) => (b === n ? null : n))}
                >
                  {n > 0 ? `+${n}` : n}
                </button>
              ))}
            </div>
          </div>
          <div className="dice-roll-row">
            <input
              ref={inputRef}
              type="text"
              placeholder="e.g. 2d6+3"
              value={expr}
              onChange={(e) => {
                setExpr(e.target.value);
                setError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
            <button onClick={submit}>Roll</button>
            <button
              onClick={() => setIsPrivate((p) => !p)}
              title={isPrivate ? "Private" : "Public"}
              className="icon-btn"
            >
              {isPrivate ? <GiSightDisabled /> : <GiSheikahEye />}
            </button>
          </div>
          {error && (
            <div style={{ padding: "2px 4px", fontSize: 10, color: "#c00" }}>
              {error}
            </div>
          )}
        </div>
        <div
          className="dice-resize-handle"
          onMouseDown={handleResizeMouseDown}
        />
        <div className="dice-history" ref={historyRef}>
          {history.map((r, i) => (
            <div key={i} style={{ color: r.private ? "#888" : undefined }}>
              {formatEntry(r)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
