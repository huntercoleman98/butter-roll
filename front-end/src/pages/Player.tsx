import { lazy, Suspense, useEffect, useState } from "react";
import { useGameSocket, fetchConfig } from "../hooks/useGameSocket";
import { usePlayerDice } from "../hooks/usePlayerDice";
import { usePlayerProfile } from "../hooks/usePlayerProfile";
import CharacterSheet from "../components/CharacterSheet";
import PlayerSetup from "../components/PlayerSetup";
import PlayerDiceTab from "../components/PlayerDiceTab";
import PlayerTabRow from "../components/PlayerTabRow";
import "../App.css";

// Lazy so MDXEditor (a heavy dependency) only loads when the Notes tab is opened.
const PlayerNotes = lazy(() => import("../components/PlayerNotes"));

export default function Player() {
  const { diceLog, myClientId, connected, send } = useGameSocket();
  const [tab, setTab] = useState<"sheet" | "dice" | "notes">("sheet");
  // The folder id the onboarding token picker is confined to (from /api/config);
  // undefined until loaded, meaning "whole library" until we know otherwise.
  const [playerTokenFolderId, setPlayerTokenFolderId] = useState<
    string | undefined
  >(undefined);

  const {
    profile,
    character,
    setupName,
    setSetupName,
    setupColor,
    setSetupColor,
    setupTokenUrl,
    setSetupTokenUrl,
    handleCharacterChange,
    handleSave,
    handleNewCharacter,
    beginEditProfile,
    existingCharacterName,
  } = usePlayerProfile({ connected, send });

  const {
    expr,
    setExpr,
    isPrivate,
    setIsPrivate,
    advMode,
    setAdvMode,
    error,
    setError,
    history,
    historyRef,
    inputRef,
    handleRoll,
    submit,
    rollCheck,
  } = usePlayerDice({
    playerName: profile?.name,
    diceColor: profile?.color,
    myClientId,
    diceLog,
    send,
  });

  useEffect(() => {
    fetchConfig()
      .then((cfg) => setPlayerTokenFolderId(cfg.playerTokenFolderId || undefined))
      .catch(console.error);
  }, []);

  const ready = connected && myClientId !== null && profile !== null;

  // ── Setup screen ──────────────────────────────────────────────
  if (!profile) {
    return (
      <PlayerSetup
        setupName={setupName}
        setSetupName={setSetupName}
        setupColor={setupColor}
        setSetupColor={setSetupColor}
        setupTokenUrl={setupTokenUrl}
        setSetupTokenUrl={setSetupTokenUrl}
        playerTokenFolderId={playerTokenFolderId}
        existingName={existingCharacterName()}
        spellcastingEnabled={character.spellcastingEnabled}
        onSpellcastingChange={(checked) =>
          handleCharacterChange({ spellcastingEnabled: checked })
        }
        onRetire={handleNewCharacter}
        onSave={handleSave}
      />
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
        <PlayerTabRow
          tab={tab}
          onSelect={setTab}
          ready={ready}
          isPrivate={isPrivate}
          onTogglePrivate={() => setIsPrivate((p) => !p)}
          onEditProfile={beginEditProfile}
        />

        {tab !== "notes" && (
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
        )}

        {tab === "sheet" && (
          <div className="player-sheet-scroll">
            <CharacterSheet
              name={profile.name}
              character={character}
              onChange={handleCharacterChange}
              ready={ready}
              onRollCheck={rollCheck}
              onRoll={handleRoll}
              accentColor={profile.color}
            />
          </div>
        )}

        {tab === "dice" && (
          <PlayerDiceTab
            ready={ready}
            advMode={advMode}
            accentColor={profile.color}
            expr={expr}
            setExpr={setExpr}
            setError={setError}
            error={error}
            submit={submit}
            handleRoll={handleRoll}
            inputRef={inputRef}
            history={history}
            historyRef={historyRef}
          />
        )}

        {tab === "notes" && (
          <Suspense
            fallback={<div className="player-notes-loading">Loading notes…</div>}
          >
            <PlayerNotes
              value={character.notes}
              onChange={(notes) => handleCharacterChange({ notes })}
              ready={ready}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}
