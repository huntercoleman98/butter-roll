import { useEffect, useRef, useState } from "react";
import type { OutgoingPayload } from "./useGameSocket";
import { uuid } from "../utils/uuid";
import {
  type Character,
  emptyCharacter,
  normalizeCharacter,
} from "../components/character";

const STORAGE_KEY = "butterroll-player-profile";
const CHAR_KEY = "butterroll-character";
const CHAR_PUSH_DEBOUNCE_MS = 500;

export interface PlayerProfile {
  // Durable, browser-stored identity. Anchors the player ↔ token link across
  // reconnects and restarts (server matches it against Token.owner_player_id).
  playerId: string;
  // The player's currently-active character. name/color/tokenUrl describe this
  // character; switching characters mints a new id and archives the old one.
  activeCharacterId: string;
  name: string;
  color: string;
  // The token image the player picked; used to create their map token on join.
  tokenUrl: string;
}

function loadCharacter(): Character {
  try {
    const raw = localStorage.getItem(CHAR_KEY);
    if (!raw) return emptyCharacter();
    return normalizeCharacter(JSON.parse(raw));
  } catch {
    return emptyCharacter();
  }
}

function loadProfile(): PlayerProfile | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<PlayerProfile>;
    if (!p.name) return null;
    // Migrate older profiles by minting a stable playerId and persisting it, so
    // the id doesn't change on the next load. Pre-roster profiles reuse the
    // playerId as their first character id, matching the server's migration.
    const playerId = p.playerId || uuid();
    const migrated: PlayerProfile = {
      playerId,
      activeCharacterId: p.activeCharacterId || playerId,
      name: p.name,
      color: p.color || "#4c6ef5",
      tokenUrl: p.tokenUrl || "",
    };
    if (!p.playerId || !p.activeCharacterId) saveProfile(migrated);
    return migrated;
  } catch {
    return null;
  }
}

function saveProfile(p: PlayerProfile) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
}

// Owns the player's durable identity (profile) and character sheet, plus the
// one-way localStorage → backend sync. localStorage is the source of truth; the
// server copy exists only so the DM can view the sheet. Also drives the setup
// screen's form fields and the create/edit/retire flows.
export function usePlayerProfile({
  connected,
  send,
}: {
  connected: boolean;
  send: (payload: OutgoingPayload) => void;
}) {
  const [profile, setProfile] = useState<PlayerProfile | null>(() =>
    loadProfile(),
  );
  const [character, setCharacter] = useState<Character>(() => loadCharacter());
  const [setupName, setSetupName] = useState("");
  const [setupColor, setSetupColor] = useState("#4c6ef5");
  const [setupTokenUrl, setSetupTokenUrl] = useState("");
  // When starting a fresh character, the id to assign on save (the setup screen
  // is reused for it). null means "edit the current character in place".
  const [pendingCharacterId, setPendingCharacterId] = useState<string | null>(
    null,
  );
  const charPushRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        characterId: profile.activeCharacterId,
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

  function pushCharacter(next: Character) {
    if (!profile) return;
    send({
      case: "characterUpdate",
      value: {
        playerId: profile.playerId,
        characterId: profile.activeCharacterId,
        data: JSON.stringify(next),
      },
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
    // the persisted profile since we don't clear storage on edit). pending-
    // CharacterId, set by "New character", assigns a fresh id; otherwise we keep
    // the current character and just edit its identity in place.
    const existing = loadProfile();
    const playerId = profile?.playerId || existing?.playerId || uuid();
    const activeCharacterId =
      pendingCharacterId ||
      profile?.activeCharacterId ||
      existing?.activeCharacterId ||
      playerId;
    const p: PlayerProfile = {
      playerId,
      activeCharacterId,
      name,
      color: setupColor,
      tokenUrl: setupTokenUrl,
    };
    saveProfile(p);
    setProfile(p);
    setPendingCharacterId(null);
  }

  // Retire the current character and start a fresh one. The old sheet is
  // archived server-side (kept, not deleted) so the DM can still view it and a
  // future "revive" can bring it back. Locally we reset the sheet and drop into
  // the setup screen to pick the new character's name/color/token.
  function handleNewCharacter() {
    // The retire button lives on the settings screen, where `profile` state is
    // null (it's cleared to show that screen), so fall back to the persisted
    // profile in storage.
    const current = profile ?? loadProfile();
    if (!current) return;
    if (!window.confirm(`Retire ${current.name} and start a new character?`))
      return;
    send({
      case: "characterUpdate",
      value: {
        playerId: current.playerId,
        characterId: current.activeCharacterId,
        data: JSON.stringify(character),
        archived: true,
      },
    });
    // Commit the new active-character id to storage right away (keeping the old
    // name/token as a placeholder). If the player abandons setup and reloads,
    // the persisted profile already points at the fresh id, so we never re-push
    // the just-archived character as active and wipe its sheet. Assumes the
    // switch happens while connected, so the archive above reaches the server.
    const newId = uuid();
    saveProfile({ ...current, activeCharacterId: newId });
    const fresh = emptyCharacter();
    localStorage.setItem(CHAR_KEY, JSON.stringify(fresh));
    setCharacter(fresh);
    setPendingCharacterId(newId);
    setSetupName("");
    setSetupColor("#4c6ef5");
    setSetupTokenUrl("");
    setProfile(null);
  }

  // Drop back to the setup screen to change name / color / token, pre-filling
  // the form from the current profile.
  function beginEditProfile() {
    if (!profile) return;
    setSetupName(profile.name);
    setSetupColor(profile.color);
    setSetupTokenUrl(profile.tokenUrl);
    setProfile(null);
  }

  // The name of the character currently being edited, or null for a brand-new
  // player (mid-"retire" flow). Drives the setup screen's Settings section and
  // Save/Enter label. Read lazily so main-UI renders don't touch localStorage.
  function existingCharacterName(): string | null {
    return pendingCharacterId ? null : (loadProfile()?.name ?? null);
  }

  return {
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
  };
}
