import { GiTombstone } from "react-icons/gi";
import { ContextMenu } from "./ContextMenu";
import {
  useTokenBar,
  type PlayerMenuState,
  type PinnedMenuState,
  type RetiredMenuState,
} from "../hooks/useTokenBar";
import type { CharacterRecord, TokenData } from "../hooks/useGameSocket";

interface TokenUpdate {
  color?: string;
  borderWidth?: number;
  name?: string;
  showName?: boolean;
  public?: boolean;
  monster?: string;
  hp?: number;
  wounds?: number;
  pinned?: boolean;
}

interface Props {
  characters: Record<string, CharacterRecord>;
  // The active page's tokens (used to resolve player chips and pinned chips).
  tokens: TokenData[];
  onCenterToken: (token: TokenData) => void;
  onPlacePlayerToken: (playerId: string, ch: CharacterRecord) => void;
  onBringViewHere: (x: number, y: number) => void;
  onDeleteTokens: (ids: Set<string>) => void;
  onUpdateToken: (ids: Set<string>, update: TokenUpdate) => void;
  onDeletePlayer: (playerId: string) => void;
  // Open a token-backed character sheet (the player-chip "Character sheet" item).
  onOpenCharacterSheet: (tokenId: string, x: number, y: number) => void;
  // Open a retired character's stored sheet (from the graveyard menu).
  onViewRetired: (
    name: string,
    data: string | undefined,
    x: number,
    y: number,
  ) => void;
}

// Shared graveyard menu listing every retired (unassociated) character.
function RetiredMenu({
  menu,
  retired,
  onView,
  onClose,
}: {
  menu: RetiredMenuState;
  retired: CharacterRecord[];
  onView: (
    name: string,
    data: string | undefined,
    x: number,
    y: number,
  ) => void;
  onClose: () => void;
}) {
  return (
    <ContextMenu
      x={menu.x}
      y={menu.y}
      title="Retired characters"
      onClose={onClose}
    >
      {retired.length === 0 ? (
        <li className="context-menu-heading">None yet</li>
      ) : (
        retired.map((c) => (
          <li
            key={c.characterId}
            onClick={() => {
              onView(c.name || "Retired character", c.data, menu.x, menu.y);
              onClose();
            }}
          >
            View {c.name || "retired character"}
          </li>
        ))
      )}
    </ContextMenu>
  );
}

// Right-click menu for a player chip. The sheet/focus actions only exist when
// the player has a token on this page; absent players get Delete only.
function PlayerChipMenu({
  menu,
  onOpenSheet,
  onBringHere,
  onDelete,
  onClose,
}: {
  menu: PlayerMenuState;
  onOpenSheet: (tokenId: string, x: number, y: number) => void;
  onBringHere: (x: number, y: number) => void;
  onDelete: (playerId: string) => void;
  onClose: () => void;
}) {
  const { token } = menu;
  return (
    <ContextMenu x={menu.x} y={menu.y} title={menu.name} onClose={onClose}>
      {token && (
        <li
          onClick={() => {
            onOpenSheet(token.id, menu.x, menu.y);
            onClose();
          }}
        >
          Character sheet
        </li>
      )}
      {token && (
        <li
          onClick={() => {
            onBringHere(token.x, token.y);
            onClose();
          }}
        >
          Bring player view here
        </li>
      )}
      <li
        onClick={() => {
          onDelete(menu.playerId);
          onClose();
        }}
      >
        Delete
      </li>
    </ContextMenu>
  );
}

// Right-click menu for a pinned DM/NPC token chip.
function PinnedTokenMenu({
  menu,
  onUnpin,
  onBringHere,
  onDelete,
  onClose,
}: {
  menu: PinnedMenuState;
  onUnpin: (id: string) => void;
  onBringHere: (x: number, y: number) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const { token } = menu;
  return (
    <ContextMenu
      x={menu.x}
      y={menu.y}
      title={token.name || "Pinned token"}
      onClose={onClose}
    >
      <li
        onClick={() => {
          onUnpin(token.id);
          onClose();
        }}
      >
        Unpin
      </li>
      <li
        onClick={() => {
          onBringHere(token.x, token.y);
          onClose();
        }}
      >
        Bring player view here
      </li>
      <li
        onClick={() => {
          onDelete(token.id);
          onClose();
        }}
      >
        Delete
      </li>
    </ContextMenu>
  );
}

// The DM top-bar roster strip: a chip per player (their active character), then
// any pinned DM/NPC tokens after a divider, then the retired-characters button —
// plus the three right-click menus those chips open. Menu state and groupings
// live in useTokenBar; every action is delegated up via callback props.
export default function TokenBar({
  characters,
  tokens,
  onCenterToken,
  onPlacePlayerToken,
  onBringViewHere,
  onDeleteTokens,
  onUpdateToken,
  onDeletePlayer,
  onOpenCharacterSheet,
  onViewRetired,
}: Props) {
  const {
    playerMenu,
    setPlayerMenu,
    retiredMenu,
    setRetiredMenu,
    pinnedMenu,
    setPinnedMenu,
    players,
    retired,
    tokenByCharacter,
    pinnedTokens,
  } = useTokenBar(characters, tokens);

  const showBar =
    players.length > 0 || retired.length > 0 || pinnedTokens.length > 0;

  return (
    <>
      {showBar && (
        <div className="player-token-bar">
          {players.map(([playerId, ch]) => {
            const token = tokenByCharacter.get(ch.characterId) ?? null;
            const name = ch.name || token?.name || "Player";
            const url = ch.tokenUrl || token?.url || "";
            return (
              <button
                key={playerId}
                className={`player-token-chip${token ? "" : " player-token-chip-absent"}`}
                title={token ? name : `${name} (click to add to this page)`}
                onClick={() =>
                  token ? onCenterToken(token) : onPlacePlayerToken(playerId, ch)
                }
                onContextMenu={(e) => {
                  e.preventDefault();
                  setPlayerMenu({
                    playerId,
                    name,
                    token,
                    x: e.clientX,
                    y: e.clientY,
                  });
                }}
              >
                <img
                  className="player-token-chip-img"
                  src={url}
                  alt={name}
                  style={token?.color ? { borderColor: token.color } : undefined}
                />
                <span className="player-token-chip-name">{name}</span>
              </button>
            );
          })}
          {pinnedTokens.length > 0 && (
            <>
              <div className="player-token-divider" />
              {pinnedTokens.map((token) => (
                <button
                  key={token.id}
                  className="player-token-chip"
                  title={token.name || "Pinned token"}
                  onClick={() => onCenterToken(token)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setPinnedMenu({ token, x: e.clientX, y: e.clientY });
                  }}
                >
                  <img
                    className="player-token-chip-img"
                    src={token.url}
                    alt={token.name || "Pinned token"}
                    style={token.color ? { borderColor: token.color } : undefined}
                  />
                  <span className="player-token-chip-name">
                    {token.name || "Token"}
                  </span>
                </button>
              ))}
            </>
          )}
          {retired.length > 0 && (
            <button
              className="player-token-graveyard"
              title={`Retired characters (${retired.length})`}
              onClick={(e) => setRetiredMenu({ x: e.clientX, y: e.clientY })}
            >
              <GiTombstone />
              <span className="player-token-chip-name">Retired</span>
            </button>
          )}
        </div>
      )}

      {retiredMenu && (
        <RetiredMenu
          menu={retiredMenu}
          retired={retired}
          onView={onViewRetired}
          onClose={() => setRetiredMenu(null)}
        />
      )}
      {playerMenu && (
        <PlayerChipMenu
          menu={playerMenu}
          onOpenSheet={onOpenCharacterSheet}
          onBringHere={onBringViewHere}
          onDelete={onDeletePlayer}
          onClose={() => setPlayerMenu(null)}
        />
      )}
      {pinnedMenu && (
        <PinnedTokenMenu
          menu={pinnedMenu}
          onUnpin={(id) => onUpdateToken(new Set([id]), { pinned: false })}
          onBringHere={onBringViewHere}
          onDelete={(id) => onDeleteTokens(new Set([id]))}
          onClose={() => setPinnedMenu(null)}
        />
      )}
    </>
  );
}
