import { lazy, Suspense, useEffect, useState } from "react";
import { useGameSocket, fetchConfig, fetchMonsters } from "../hooks/useGameSocket";
import { usePlayerDice } from "../hooks/usePlayerDice";
import { usePlayerProfile } from "../hooks/usePlayerProfile";
import { useCompanions } from "../hooks/useCompanions";
import type { Monster } from "../types/monster";
import CharacterSheet from "../components/CharacterSheet";
import PlayerSetup from "../components/PlayerSetup";
import PlayerDiceTab from "../components/PlayerDiceTab";
import PlayerCompanionsTab from "../components/PlayerCompanionsTab";
import PlayerTabRow from "../components/PlayerTabRow";
import { downloadTextFile } from "../utils/download";
import "../App.css";

// Lazy so MDXEditor (a heavy dependency) only loads when the Notes tab is opened.
const PlayerNotes = lazy(() => import("../components/PlayerNotes"));

export default function Player() {
  const { diceLog, myClientId, connected, send, pages, presentedPageId, characters } =
    useGameSocket();
  const [tab, setTab] = useState<"sheet" | "dice" | "notes" | "companions">(
    "sheet",
  );
  const [monsters, setMonsters] = useState<Monster[]>([]);
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
    handleLoginAs,
    handleLogout,
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
    fetchMonsters().then(setMonsters).catch(console.error);
  }, []);

  const ready = connected && myClientId !== null && profile !== null;

  const { companions, hasCompanions } = useCompanions(
    pages,
    presentedPageId,
    profile?.playerId,
  );

  // If the player is viewing Companions when access disappears (DM switches
  // page, unassigns, or removes the token), snap them back to the Sheet tab.
  // Adjusting state during render (not in an effect) is the recommended pattern.
  if (!hasCompanions && tab === "companions") setTab("sheet");

  // ── Setup screen ──────────────────────────────────────────────
  if (!profile) {
    // null on a first run or mid-retire (choosing/creating a character), the
    // current name when editing an existing profile via the gear.
    const existingName = existingCharacterName();
    // Active characters that can be adopted on this device. Offered whenever the
    // player is choosing a character (first run or mid-retire), but not when
    // they're just editing their current profile in place.
    const loginCandidates =
      existingName === null
        ? Object.values(characters)
            .filter((c) => !c.archived && c.ownerPlayerId)
            .sort((a, b) => a.name.localeCompare(b.name))
        : [];
    return (
      <PlayerSetup
        loginCandidates={loginCandidates}
        onLoginAs={handleLoginAs}
        onLogout={handleLogout}
        setupName={setupName}
        setSetupName={setSetupName}
        setupColor={setupColor}
        setSetupColor={setSetupColor}
        setupTokenUrl={setupTokenUrl}
        setSetupTokenUrl={setSetupTokenUrl}
        playerTokenFolderId={playerTokenFolderId}
        existingName={existingName}
        spellcastingEnabled={character.spellcastingEnabled}
        onSpellcastingChange={(checked) =>
          handleCharacterChange({ spellcastingEnabled: checked })
        }
        notesEmpty={!character.notes.trim()}
        onExportNotes={() => {
          const name = existingName ?? "character";
          const safe = name.replace(/[^\w.-]+/g, "_");
          downloadTextFile(`${safe}-notes.md`, character.notes, "text/markdown");
        }}
        onRetire={handleNewCharacter}
        onSave={handleSave}
      />
    );
  }

  // ── Main UI ────────────────────────────────────────────────────
  // The map the DM is currently presenting (if any). Rendered blurred behind
  // the centered app window so it fills the side margins on wide screens
  // instead of dead gray space — the player still feels "in" the scene.
  const presentedMapUrl =
    pages.find((p) => p.id === presentedPageId)?.mapUrl ?? null;

  return (
    <>
      {presentedMapUrl && (
        <div
          className="player-map-backdrop"
          style={{ backgroundImage: `url("${presentedMapUrl}")` }}
        />
      )}
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
          hasCompanions={hasCompanions}
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

        {tab === "companions" && presentedPageId && (
          <PlayerCompanionsTab
            companions={companions}
            monsters={monsters}
            pageId={presentedPageId}
            ready={ready}
            onUpdate={(id, update) =>
              send({
                case: "tokenUpdate",
                value: { pageId: presentedPageId, id, ...update },
              })
            }
            onRoll={handleRoll}
          />
        )}
      </div>
      </div>
    </>
  );
}
