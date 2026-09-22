import { useState } from "react";
import type { Monster } from "../types/monster";
import type { TokenData } from "../hooks/useGameSocket";
import MonsterStatBlock from "./MonsterStatBlock";

// Commit-on-blur/Enter numeric input, mirroring the DM token-monster tracker.
// Wounds may exceed HP (a downed companion), matching the DM's tracker.
function NumberInput({
  value,
  disabled,
  onChange,
}: {
  value: number;
  disabled?: boolean;
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
      disabled={disabled}
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
  companions: TokenData[];
  monsters: Monster[];
  pageId: string;
  ready: boolean;
  /** Commit an HP/wounds change to the given companion token. */
  onUpdate: (id: string, update: { hp?: number; wounds?: number }) => void;
  /** Roll through the player's dice pipeline (attributed, TV animation). */
  onRoll: (
    expression: string,
    label?: string,
    metadata?: string,
    tokenId?: string,
  ) => void;
}

// The player's "Companions" tab: a vertical list of statblocks for the monster
// tokens the DM has assigned to this player (familiars, mounts, summons) on the
// presented page. Reuses the DM's <MonsterStatBlock>; rolls go through the
// player's own dice handler so they animate on /view and are attributed here.
export default function PlayerCompanionsTab({
  companions,
  monsters,
  ready,
  onUpdate,
  onRoll,
}: Props) {
  return (
    <div className="player-companions-scroll">
      {companions.map((token) => {
        const linked = monsters.find((m) => m.name === token.monster) ?? null;
        const down = (token.wounds ?? 0) >= (token.hp ?? 0) && token.hp != null;
        return (
          <div key={token.id} className="player-companion">
            <div className="player-companion-title">
              {token.name || token.monster}
            </div>
            <div className={`token-monster-hp${down ? " is-down" : ""}`}>
              <label>HP</label>
              <NumberInput
                value={token.hp ?? 0}
                disabled={!ready}
                onChange={(v) => onUpdate(token.id, { hp: v })}
              />
              <label>Wounds</label>
              <NumberInput
                value={token.wounds ?? 0}
                disabled={!ready}
                onChange={(v) => onUpdate(token.id, { wounds: v })}
              />
            </div>
            {linked ? (
              <MonsterStatBlock
                monster={linked}
                labelName={token.name}
                onRoll={(expr, label, metadata) =>
                  onRoll(expr, label, metadata, token.id)
                }
              />
            ) : (
              <div className="monsters-empty">
                Unknown creature: {token.monster}.
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
