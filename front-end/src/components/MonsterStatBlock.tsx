import type { Monster, MonsterStats } from "../types/monster";
import DiceText from "./DiceText";

interface Props {
  monster: Monster;
  /** Name used in roll labels (e.g. the token's name); defaults to the monster name. */
  labelName?: string;
  onRoll: (expression: string, label?: string, metadata?: string) => void;
}

const STAT_LABELS: [keyof MonsterStats, string, string][] = [
  ["strength", "STR", "str_check"],
  ["dexterity", "DEX", "dex_check"],
  ["constitution", "CON", "con_check"],
  ["intelligence", "INT", "int_check"],
  ["wisdom", "WIS", "wis_check"],
  ["charisma", "CHA", "cha_check"],
];

function bonusToString(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

export default function MonsterStatBlock({ monster, labelName, onRoll }: Props) {
  const rollName = labelName || monster.name;
  return (
    <div className="monster-stat-block">
      <div className="monster-stat-row">
        <span>
          <strong>AC</strong> {monster.ac}
        </span>
        <span>
          <strong>HP</strong> {monster.hp}
        </span>
        <span>
          <strong>MV</strong> {monster.movement}
        </span>
        <span>
          <strong>AL</strong> {monster.alignment}
        </span>
        <span>
          <strong>LV</strong> {monster.level}
        </span>
      </div>
      <div className="monster-columns">
        <div className="monster-stats-col">
          {STAT_LABELS.map(([key, label, metadata]) => {
            const bonus = monster.stats[key];
            const expr = `1d20${bonusToString(bonus)}`;
            return (
              <button
                key={key}
                className="monster-stat-btn"
                title={expr}
                onClick={() => onRoll(expr, `${rollName} — ${label}`, metadata)}
              >
                <strong>{label}</strong> {bonusToString(bonus)}
              </button>
            );
          })}
        </div>
        <div className="monster-main-col">
          <div className="monster-section-title">Attacks</div>
          <ul className="monster-section-list">
            {monster.attacks.map((a) => {
              const bonus = a.toHit;
              const toHitExpr = `1d20${bonus != null ? bonusToString(bonus) : ""}`;
              return (
                <li key={a.name}>
                  {a.perRound} <strong>{a.name}</strong>
                  {a.range ? ` (${a.range})` : ""}
                  {bonus != null && (
                    <>
                      {" "}
                      <button
                        className="dice-text-btn"
                        title={toHitExpr}
                        onClick={() =>
                          onRoll(
                            toHitExpr,
                            `${rollName} — ${a.name} (to hit)`,
                            "to_hit",
                          )
                        }
                      >
                        {bonusToString(bonus)}
                      </button>
                    </>
                  )}
                  {a.damage && (
                    <div className="monster-attack-damage">
                      <DiceText
                        text={a.damage}
                        label={`${rollName} — ${a.name} (damage)`}
                        metadata="damage"
                        onRoll={onRoll}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {monster.abilities != null && monster.abilities.length > 0 && (
            <>
              <div className="monster-section-title">Abilities</div>
              <ul className="monster-section-list">
                {monster.abilities.map((a) => (
                  <li key={a.name}>
                    <strong>{a.name}</strong>:{" "}
                    <DiceText
                      text={a.description}
                      label={`${rollName} — ${a.name}`}
                      onRoll={onRoll}
                    />
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
