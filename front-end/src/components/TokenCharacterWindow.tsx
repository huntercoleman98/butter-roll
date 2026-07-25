import { useMemo, useState } from "react";
import type { TokenData } from "../hooks/useGameSocket";
import CharacterSheet from "./CharacterSheet";
import { type Character, normalizeCharacter } from "./character";

interface Props {
  token: TokenData;
  // The owner's serialized sheet blob (from useGameSocket.characters), or
  // undefined if the player hasn't pushed one yet.
  data: string | undefined;
  x: number;
  y: number;
  ready: boolean;
  onRollCheck: (mod: number, label: string) => void;
  onRoll: (expression: string, label?: string) => void;
  onClose: () => void;
}

// Read-only view of a player's character sheet, opened when the DM double-clicks
// that player's token. Editing lives on the player's own /player view.
export default function TokenCharacterWindow({
  token,
  data,
  x,
  y,
  ready,
  onRollCheck,
  onRoll,
  onClose,
}: Props) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const character = useMemo<Character | null>(() => {
    if (!data) return null;
    try {
      return normalizeCharacter(JSON.parse(data));
    } catch {
      return null;
    }
  }, [data]);

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

  return (
    <div
      className="window token-character-window"
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
        <div className="title-bar-text">{token.name || "Player Character"}</div>
        <div className="title-bar-controls">
          <button aria-label="Close" onClick={onClose} />
        </div>
      </div>
      <div className="window-body token-character-body">
        {character ? (
          <CharacterSheet
            name={token.name}
            character={character}
            readOnly
            ready={ready}
            onRollCheck={onRollCheck}
            onRoll={onRoll}
          />
        ) : (
          <div className="monsters-empty">
            No character sheet yet — this player hasn't filled one in.
          </div>
        )}
      </div>
    </div>
  );
}
