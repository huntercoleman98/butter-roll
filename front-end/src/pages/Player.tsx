import { useEffect, useRef, useState } from "react";
import { GiCog, GiSheikahEye, GiSightDisabled } from "react-icons/gi";
import { useGameSocket, type DiceRollResult } from "../hooks/useGameSocket";
import { parseDiceExpression } from "../utils/parseDiceExpression";
import "../App.css";

const DIE_SIDES = [4, 6, 8, 10, 12, 20, 100];
const STORAGE_KEY = "butterroll-player-profile";
const STATS_KEY = "butterroll-ability-scores";
const ABILITY_NAMES = ["STR", "CON", "DEX", "INT", "WIS", "CHA"] as const;
type AbilityName = (typeof ABILITY_NAMES)[number];

interface PlayerProfile {
  name: string;
  color: string;
}

function loadProfile(): PlayerProfile | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PlayerProfile;
  } catch {
    return null;
  }
}

function saveProfile(p: PlayerProfile) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
}

function defaultScores(): Record<AbilityName, number> {
  return Object.fromEntries(ABILITY_NAMES.map((n) => [n, 10])) as Record<
    AbilityName,
    number
  >;
}

function loadScores(): Record<AbilityName, number> {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (!raw) return defaultScores();
    return JSON.parse(raw) as Record<AbilityName, number>;
  } catch {
    return defaultScores();
  }
}

function rollLocally(count: number, sides: number): number[] {
  return Array.from({ length: count }, () =>
    Math.floor(Math.random() * sides) + 1,
  );
}

function formatEntry(r: DiceRollResult): string {
  if (r.private) return `${r.label ?? r.expression} → 🗼 rolled in the tower`;
  const desc = r.label ? `${r.expression} ${r.label}` : r.expression;
  const showRolls = r.rolls.length > 1 || r.modifier !== 0;
  const rollsStr = showRolls ? ` (${r.rolls.join(", ")})` : "";
  return `${desc} → ${r.total}${rollsStr}`;
}

function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

function modStr(score: number): string {
  const m = abilityMod(score);
  return m >= 0 ? `+${m}` : `${m}`;
}

export default function Player() {
  const { diceResult, myClientId, connected, send } = useGameSocket();
  const [profile, setProfile] = useState<PlayerProfile | null>(() =>
    loadProfile(),
  );
  const [setupName, setSetupName] = useState("");
  const [setupColor, setSetupColor] = useState("#4c6ef5");
  const [tab, setTab] = useState<"dice" | "stats">("dice");
  const [scores, setScores] = useState<Record<AbilityName, number>>(() =>
    loadScores(),
  );
  const [expr, setExpr] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [advMode, setAdvMode] = useState<"normal" | "advantage" | "disadvantage">("normal");
  const [error, setError] = useState("");
  const [history, setHistory] = useState<DiceRollResult[]>([]);
  const historyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    localStorage.setItem(STATS_KEY, JSON.stringify(scores));
  }, [scores]);

  useEffect(() => {
    const el = historyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [history]);

  useEffect(() => {
    if (
      diceResult &&
      diceResult.clientId === myClientId &&
      !diceResult.private
    ) {
      setHistory((prev) => [...prev, diceResult]);
    }
  }, [diceResult, myClientId]);

  function handleSave() {
    const name = setupName.trim();
    if (!name) return;
    const p: PlayerProfile = { name, color: setupColor };
    saveProfile(p);
    setProfile(p);
  }

  function handleRoll(expression: string, label?: string) {
    if (!profile) return;
    const trimmed = expression.trim();
    if (!trimmed) return;
    const parsed = parseDiceExpression(trimmed);
    if (!parsed) {
      setError("Invalid expression. Use e.g. 2d6+3 (max 20 dice).");
      return;
    }
    setError("");

    if (isPrivate) {
      const { count, sides, modifier } = parsed;
      const useAdvDisadv = advMode !== "normal" && count === 1 && sides === 20;
      const rawRolls = useAdvDisadv ? rollLocally(2, sides) : rollLocally(count, sides);
      const total = useAdvDisadv
        ? (advMode === "advantage" ? Math.max(...rawRolls) : Math.min(...rawRolls)) + modifier
        : rawRolls.reduce((a, b) => a + b, 0) + modifier;
      send({
        type: "dice_roll_result",
        expression: trimmed,
        sides,
        rolls: rawRolls,
        modifier,
        total,
        clientId: myClientId ?? undefined,
        private: true,
        playerName: profile.name,
        diceColor: profile.color,
        label,
      });
      setHistory((prev) => [
        ...prev,
        { expression: trimmed, sides, rolls: rawRolls, modifier, total, private: true, label },
      ]);
    } else {
      send({
        type: "dice_roll_request",
        expression: trimmed,
        clientId: myClientId ?? undefined,
        playerName: profile.name,
        diceColor: profile.color,
        advMode: advMode !== "normal" ? advMode : undefined,
        label,
      });
    }
  }

  function submit() {
    const trimmed = expr.trim();
    const parsed = parseDiceExpression(trimmed);
    const label = parsed && parsed.sides === 20 && parsed.count === 1 && advMode !== "normal"
      ? (advMode === "advantage" ? "with advantage" : "with disadvantage")
      : undefined;
    handleRoll(trimmed, label);
    inputRef.current?.select();
  }

  function rollStat(ability: AbilityName) {
    const mod = abilityMod(scores[ability]);
    const expression = mod === 0 ? "1d20" : mod > 0 ? `1d20+${mod}` : `1d20${mod}`;
    const label =
      advMode !== "normal"
        ? `${ability} ${advMode === "advantage" ? "with advantage" : "with disadvantage"}`
        : ability;
    handleRoll(expression, label);
  }

  function handleScoreChange(ability: AbilityName, value: string) {
    const n = parseInt(value);
    if (!isNaN(n))
      setScores((prev) => ({ ...prev, [ability]: Math.min(30, Math.max(1, n)) }));
  }

  const ready = connected && myClientId !== null && profile !== null;

  // ── Setup screen ──────────────────────────────────────────────
  if (!profile) {
    return (
      <div className="window app player-app">
        <div className="title-bar">
          <div className="title-bar-text">Butter Roll — Player Setup</div>
          <div className="title-bar-controls">
            <button aria-label="Minimize"></button>
            <button aria-label="Maximize" disabled></button>
            <button aria-label="Close"></button>
          </div>
        </div>
        <div className="window-body player-setup-body">
          <p>Choose a name and dice color.</p>
          <div className="player-setup-fields">
            <label htmlFor="setup-name">Name</label>
            <input
              id="setup-name"
              type="text"
              autoFocus
              maxLength={20}
              placeholder="Your name"
              value={setupName}
              onChange={(e) => setSetupName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
              }}
            />
            <label htmlFor="setup-color">Dice color</label>
            <input
              id="setup-color"
              type="color"
              value={setupColor}
              onChange={(e) => setSetupColor(e.target.value)}
            />
          </div>
          <button
            disabled={!setupName.trim()}
            onClick={handleSave}
            style={{ marginTop: 12 }}
          >
            Enter
          </button>
        </div>
      </div>
    );
  }

  // ── Main UI ────────────────────────────────────────────────────
  return (
    <div className="window app player-app">
      <div className="title-bar">
        <div className="title-bar-text">Butter Roll — {profile.name}</div>
        <div className="title-bar-controls">
          <button aria-label="Minimize"></button>
          <button aria-label="Maximize" disabled></button>
          <button aria-label="Close"></button>
        </div>
      </div>

      <div className="window-body player-body">
        <div className="player-tab-row">
          <menu role="tablist">
            <li aria-selected={tab === "dice"}>
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setTab("dice");
                }}
              >
                Dice
              </a>
            </li>
            <li aria-selected={tab === "stats"}>
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setTab("stats");
                }}
              >
                Stats
              </a>
            </li>
          </menu>
          <div className="player-tab-row-actions">
            <button
              disabled={!ready}
              onClick={() => setIsPrivate((p) => !p)}
              title={isPrivate ? "Private (in the tower)" : "Public"}
              className="icon-btn"
            >
              {isPrivate ? <GiSightDisabled /> : <GiSheikahEye />}
            </button>
            <button
              className="icon-btn"
              title="Change name / color"
              onClick={() => {
                setSetupName(profile.name);
                setSetupColor(profile.color);
                setProfile(null);
              }}
            >
              <GiCog />
            </button>
          </div>
        </div>

        <div className="player-tab-body">
          <div className="player-adv-row">
            <button
              disabled={!ready}
              onClick={() => setAdvMode((m) => m === "advantage" ? "normal" : "advantage")}
              title="Advantage"
              className={`player-adv-btn${advMode === "advantage" ? " is-active" : ""}`}
            >
              Adv
            </button>
            <button
              disabled={!ready}
              onClick={() => setAdvMode((m) => m === "disadvantage" ? "normal" : "disadvantage")}
              title="Disadvantage"
              className={`player-adv-btn${advMode === "disadvantage" ? " is-active" : ""}`}
            >
              Dis
            </button>
          </div>

          {tab === "dice" && (
            <div className="player-controls">
              <div className="player-die-grid">
                {DIE_SIDES.map((sides) => (
                  <button
                    key={sides}
                    disabled={!ready}
                    onClick={() => {
                      const label = sides === 20 && advMode !== "normal"
                        ? (advMode === "advantage" ? "with advantage" : "with disadvantage")
                        : undefined;
                      handleRoll(`d${sides}`, label);
                    }}
                    className="player-die-btn"
                    style={{ borderLeft: `4px solid ${profile.color}` }}
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
              {!connected && (
                <div className="player-offline">○ Offline</div>
              )}
            </div>
          )}

          {tab === "stats" && (
            <div className="player-stats">
              {ABILITY_NAMES.map((ability) => (
                <div key={ability} className="player-stat-row">
                  <span className="player-stat-label">{ability}</span>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={scores[ability]}
                    onChange={(e) => handleScoreChange(ability, e.target.value)}
                    className="player-stat-input"
                  />
                  <span className="player-stat-mod">
                    {modStr(scores[ability])}
                  </span>
                  <button
                    disabled={!ready}
                    onClick={() => rollStat(ability)}
                    className="player-stat-roll"
                  >
                    Roll
                  </button>
                </div>
              ))}
            </div>
          )}
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
      </div>
    </div>
  );
}
