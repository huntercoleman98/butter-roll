import { useEffect, useRef, useState } from "react";
import { GiCog, GiSheikahEye, GiSightDisabled } from "react-icons/gi";
import {
  useGameSocket,
  fetchConfig,
  type DiceRollResult,
} from "../hooks/useGameSocket";
import { parseDiceExpression } from "../utils/parseDiceExpression";
import { uuid } from "../utils/uuid";
import CharacterSheet from "../components/CharacterSheet";
import {
  type Character,
  emptyCharacter,
  normalizeCharacter,
} from "../components/character";
import TokenLibrary from "../components/TokenLibrary";
import "../App.css";

const DIE_SIDES = [4, 6, 8, 10, 12, 20, 100];
const STORAGE_KEY = "butterroll-player-profile";
const CHAR_KEY = "butterroll-character";
const CHAR_PUSH_DEBOUNCE_MS = 500;

function loadCharacter(): Character {
  try {
    const raw = localStorage.getItem(CHAR_KEY);
    if (!raw) return emptyCharacter();
    return normalizeCharacter(JSON.parse(raw));
  } catch {
    return emptyCharacter();
  }
}

interface PlayerProfile {
  // Durable, browser-stored identity. Anchors the player ↔ token link across
  // reconnects and restarts (server matches it against Token.owner_player_id).
  playerId: string;
  name: string;
  color: string;
  // The token image the player picked; used to create their map token on join.
  tokenUrl: string;
}

function loadProfile(): PlayerProfile | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<PlayerProfile>;
    if (!p.name) return null;
    // Migrate older profiles ({ name, color }) by minting a stable playerId and
    // persisting it, so the id doesn't change on the next load.
    const migrated: PlayerProfile = {
      playerId: p.playerId || uuid(),
      name: p.name,
      color: p.color || "#4c6ef5",
      tokenUrl: p.tokenUrl || "",
    };
    if (!p.playerId) saveProfile(migrated);
    return migrated;
  } catch {
    return null;
  }
}

function saveProfile(p: PlayerProfile) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
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

export default function Player() {
  const { diceResult, myClientId, connected, send } = useGameSocket();
  const [profile, setProfile] = useState<PlayerProfile | null>(() =>
    loadProfile(),
  );
  const [setupName, setSetupName] = useState("");
  const [setupColor, setSetupColor] = useState("#4c6ef5");
  const [setupTokenUrl, setSetupTokenUrl] = useState("");
  const [tab, setTab] = useState<"sheet" | "dice">("sheet");
  const [expr, setExpr] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [advMode, setAdvMode] = useState<"normal" | "advantage" | "disadvantage">("normal");
  const [error, setError] = useState("");
  const [history, setHistory] = useState<DiceRollResult[]>([]);
  const [character, setCharacter] = useState<Character>(() => loadCharacter());
  // The folder id the onboarding token picker is confined to (from /api/config);
  // undefined until loaded, meaning "whole library" until we know otherwise.
  const [playerTokenFolderId, setPlayerTokenFolderId] = useState<
    string | undefined
  >(undefined);
  const historyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const charPushRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const el = historyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [history]);

  useEffect(() => {
    fetchConfig()
      .then((cfg) => setPlayerTokenFolderId(cfg.playerTokenFolderId || undefined))
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (
      diceResult &&
      diceResult.clientId === myClientId &&
      !diceResult.private
    ) {
      setHistory((prev) => [...prev, diceResult]);
    }
  }, [diceResult, myClientId]);

  // Register our identity (name, color, token image) with the server whenever we
  // connect so the DM's player bar can show us. This no longer places a token —
  // the DM adds our token by clicking us in that bar. Idempotent, so re-sending
  // on every reconnect is safe. `send` is intentionally excluded — it's a fresh
  // closure each render.
  useEffect(() => {
    if (!profile || !profile.tokenUrl || !connected) return;
    send({
      case: "playerJoin",
      value: {
        playerId: profile.playerId,
        name: profile.name,
        color: profile.color,
        tokenUrl: profile.tokenUrl,
        pageId: "",
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, connected]);

  // Push the sheet to the backend on (re)connect so the server (and the DM) have
  // the current copy even after a restart. Edits push via handleCharacterChange.
  useEffect(() => {
    if (profile && connected) pushCharacter(character);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, connected]);

  // One-way sync: localStorage is the player's source of truth; we mirror the
  // serialized sheet to the backend (debounced) so the DM can view it.
  function pushCharacter(next: Character) {
    if (!profile) return;
    send({
      case: "characterUpdate",
      value: { playerId: profile.playerId, data: JSON.stringify(next) },
    });
  }

  function handleCharacterChange(patch: Partial<Character>) {
    setCharacter((prev) => {
      const next = { ...prev, ...patch };
      localStorage.setItem(CHAR_KEY, JSON.stringify(next));
      if (charPushRef.current) clearTimeout(charPushRef.current);
      charPushRef.current = setTimeout(
        () => pushCharacter(next),
        CHAR_PUSH_DEBOUNCE_MS,
      );
      return next;
    });
  }

  function handleSave() {
    const name = setupName.trim();
    if (!name || !setupTokenUrl) return;
    // Preserve the existing playerId when re-editing (loadProfile still returns
    // the persisted profile since we don't clear storage on edit).
    const p: PlayerProfile = {
      playerId: profile?.playerId || loadProfile()?.playerId || uuid(),
      name,
      color: setupColor,
      tokenUrl: setupTokenUrl,
    };
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
        case: "diceRollResult",
        value: {
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
        },
      });
      setHistory((prev) => [
        ...prev,
        { expression: trimmed, sides, rolls: rawRolls, modifier, total, private: true, label },
      ]);
    } else {
      send({
        case: "diceRollRequest",
        value: {
          expression: trimmed,
          clientId: myClientId ?? undefined,
          playerName: profile.name,
          diceColor: profile.color,
          advMode: advMode !== "normal" ? advMode : undefined,
          label,
        },
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

  // A d20 check with a flat modifier, respecting the adv/disadv toggle. Used by
  // the character sheet for ability checks, attacks, and spell casts.
  function rollCheck(mod: number, baseLabel: string) {
    const expression = mod === 0 ? "1d20" : mod > 0 ? `1d20+${mod}` : `1d20${mod}`;
    const label =
      advMode !== "normal"
        ? `${baseLabel} ${advMode === "advantage" ? "with advantage" : "with disadvantage"}`
        : baseLabel;
    handleRoll(expression, label);
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
          <p>Choose a name, color, and token.</p>
          <div className="player-setup-fields">
            <label htmlFor="setup-name">Character Name</label>
            <input
              id="setup-name"
              type="text"
              autoFocus
              maxLength={20}
              placeholder="Character name"
              value={setupName}
              onChange={(e) => setSetupName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
              }}
            />
            <label htmlFor="setup-color" title="Used for your dice and token border">
              Your Color
            </label>
            <input
              id="setup-color"
              type="color"
              value={setupColor}
              onChange={(e) => setSetupColor(e.target.value)}
            />
          </div>

          <div className="player-setup-token">
            <div className="player-setup-token-label">
              Token
              {setupTokenUrl ? (
                <img
                  className="player-setup-token-preview"
                  src={setupTokenUrl}
                  alt="Selected token"
                />
              ) : (
                <span className="player-setup-token-hint">
                  Pick one below or upload your own
                </span>
              )}
            </div>
            <div className="player-setup-token-picker">
              <TokenLibrary
                onPlaceToken={setSetupTokenUrl}
                readOnly
                rootFolderId={playerTokenFolderId}
              />
            </div>
          </div>

          <button
            disabled={!setupName.trim() || !setupTokenUrl}
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
            <li aria-selected={tab === "sheet"}>
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setTab("sheet");
                }}
              >
                Sheet
              </a>
            </li>
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
                setSetupTokenUrl(profile.tokenUrl);
                setProfile(null);
              }}
            >
              <GiCog />
            </button>
          </div>
        </div>

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
          {!connected && <span className="player-offline">○ Offline</span>}
        </div>

        {tab === "sheet" && (
          <div className="player-sheet-scroll">
            <CharacterSheet
              name={profile.name}
              character={character}
              onChange={handleCharacterChange}
              ready={ready}
              onRollCheck={rollCheck}
              onRoll={handleRoll}
            />
          </div>
        )}

        {tab === "dice" && (
          <>
            <div className="player-tab-body">
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
        )}
      </div>
    </div>
  );
}
