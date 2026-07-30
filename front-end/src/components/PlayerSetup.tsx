import { tokenLibraryApi } from "../hooks/useGameSocket";
import AssetLibrary from "./AssetLibrary";

interface Props {
  setupName: string;
  setSetupName: (v: string) => void;
  setupColor: string;
  setSetupColor: (v: string) => void;
  setupTokenUrl: string;
  setSetupTokenUrl: (v: string) => void;
  // The folder the onboarding token picker is confined to; undefined = whole library.
  playerTokenFolderId: string | undefined;
  // The name of the character being edited, or null for a brand-new player. When
  // set, the extra Settings section (spellcasting toggle, retire) is shown and
  // the submit button reads "Save" rather than "Enter".
  existingName: string | null;
  spellcastingEnabled: boolean;
  onSpellcastingChange: (checked: boolean) => void;
  onRetire: () => void;
  onSave: () => void;
}

// The onboarding / settings screen shown while the player has no active profile
// (first run, or after clicking the gear / retiring a character). Purely a view:
// all state and handlers live in <Player>.
export default function PlayerSetup({
  setupName,
  setSetupName,
  setupColor,
  setSetupColor,
  setupTokenUrl,
  setSetupTokenUrl,
  playerTokenFolderId,
  existingName,
  spellcastingEnabled,
  onSpellcastingChange,
  onRetire,
  onSave,
}: Props) {
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
              if (e.key === "Enter") onSave();
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
            <AssetLibrary
              api={tokenLibraryApi}
              onSelect={setSetupTokenUrl}
              readOnly
              rootFolderId={playerTokenFolderId}
            />
          </div>
        </div>

        {existingName && (
          <fieldset className="player-settings">
            <legend>Settings</legend>
            <div className="player-settings-row">
              <div className="player-settings-row-text">
                <span className="player-settings-row-title">Spellcasting</span>
                <span className="player-settings-row-desc">
                  Show the spell list on your character sheet.
                </span>
              </div>
              <div className="player-settings-row-action">
                <input
                  type="checkbox"
                  id="setting-spellcasting"
                  checked={spellcastingEnabled}
                  onChange={(e) => onSpellcastingChange(e.target.checked)}
                />
                <label htmlFor="setting-spellcasting" />
              </div>
            </div>
            <div className="player-settings-row">
              <div className="player-settings-row-text">
                <span className="player-settings-row-title">Retire character</span>
                <span className="player-settings-row-desc">
                  Archive {existingName} and start a new character.
                </span>
              </div>
              <button onClick={onRetire} className="player-settings-row-action">
                Retire…
              </button>
            </div>
          </fieldset>
        )}

        <button
          disabled={!setupName.trim() || !setupTokenUrl}
          onClick={onSave}
          style={{ marginTop: 12 }}
        >
          {existingName ? "Save" : "Enter"}
        </button>
      </div>
    </div>
  );
}
