import { useState } from "react";
import {
  filterMonsters,
  parseMaxHp,
  type Monster,
} from "../types/monster";
import type { TokenData } from "../hooks/useGameSocket";
import MonsterStatBlock from "./MonsterStatBlock";

function NumberInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const [local, setLocal] = useState(String(value));
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setLocal(String(value));
  }

  return (
    <input
      type="number"
      className="token-monster-num"
      min={0}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        const n = Number(local);
        if (!isNaN(n) && n >= 0) onChange(n);
        else setLocal(String(value));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}

interface Props {
  token: TokenData;
  monsters: Monster[];
  x: number;
  y: number;
  onUpdate: (update: { monster?: string; hp?: number; wounds?: number }) => void;
  onRoll: (expression: string, label?: string, metadata?: string) => void;
  onClose: () => void;
}

export default function TokenMonsterWindow({
  token,
  monsters,
  x,
  y,
  onUpdate,
  onRoll,
  onClose,
}: Props) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [filter, setFilter] = useState("");

  const linked = monsters.find((m) => m.name === token.monster) ?? null;
  const filtered = filterMonsters(monsters, filter);

  function handleTitleBarDrag(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    const startX = e.clientX - offset.x;
    const startY = e.clientY - offset.y;
    function onMouseMove(ev: MouseEvent) {
      setOffset({ x: ev.clientX - startX, y: ev.clientY - startY });
    }
    function onMouseUp() {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  function linkMonster(m: Monster) {
    onUpdate({ monster: m.name, hp: parseMaxHp(m.hp), wounds: 0 });
    setFilter("");
  }

  const down = (token.wounds ?? 0) >= (token.hp ?? 0) && token.hp != null;

  return (
    <div
      className="window token-monster-window"
      style={{
        position: "fixed",
        left: x + offset.x,
        top: y + offset.y,
        zIndex: 1000,
      }}
    >
      <div
        className="title-bar"
        style={{ cursor: "move" }}
        onMouseDown={handleTitleBarDrag}
      >
        <div className="title-bar-text">
          {token.monster ? token.monster : "Link Monster"}
        </div>
        <div className="title-bar-controls">
          <button aria-label="Close" onClick={onClose} />
        </div>
      </div>
      <div className="window-body token-monster-body">
        {!token.monster ? (
          <>
            <input
              type="text"
              className="monsters-filter"
              autoFocus
              placeholder="Filter by name or level…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <div className="monsters-scroll">
              {monsters.length === 0 ? (
                <div className="monsters-empty">
                  No monsters found — add one-monster JSON files to
                  back-end/assets/monsters/.
                </div>
              ) : filtered.length === 0 ? (
                <div className="monsters-empty">No matches.</div>
              ) : (
                filtered.map((m) => (
                  <div
                    key={m.name}
                    className="monsters-row"
                    onClick={() => linkMonster(m)}
                  >
                    <span className="monsters-row-name">{m.name}</span>
                    <span className="monsters-row-level">LV {m.level}</span>
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          <>
            <div className={`token-monster-hp${down ? " is-down" : ""}`}>
              <label>HP</label>
              <NumberInput
                value={token.hp ?? 0}
                onChange={(v) => onUpdate({ hp: v })}
              />
              <label>Wounds</label>
              <NumberInput
                value={token.wounds ?? 0}
                onChange={(v) => onUpdate({ wounds: v })}
              />
              <button
                className="token-monster-unlink"
                title="Unlink monster"
                onClick={() => onUpdate({ monster: "" })}
              >
                Unlink
              </button>
            </div>
            <div className="monsters-scroll">
              {linked ? (
                <MonsterStatBlock
                  monster={linked}
                  labelName={token.name}
                  onRoll={onRoll}
                />
              ) : (
                <div className="monsters-empty">
                  Unknown monster: {token.monster}. Unlink to pick another.
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
