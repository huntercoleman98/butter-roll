import { useEffect, useRef, useState } from "react";
import { GiTombstone } from "react-icons/gi";
import { uuid } from "../utils/uuid";
import Konva from "konva";
import MapCanvas, { type ActiveTool } from "../components/MapCanvas";
import MapSizeInput from "../components/MapSizeInput";
import DicePanel from "../components/DicePanel";
import DiceOverlay from "../components/DiceOverlay";
import InitiativePanel from "../components/InitiativePanel";
import MonstersPanel from "../components/MonstersPanel";
import TokenMonsterWindow from "../components/TokenMonsterWindow";
import TokenCharacterWindow from "../components/TokenCharacterWindow";
import AssetLibrary from "../components/AssetLibrary";
import { ContextMenu } from "../components/ContextMenu";
import { useOutsideClick } from "../hooks/useOutsideClick";
import type { Monster } from "../types/monster";
import {
  useGameSocket,
  tokenLibraryApi,
  mapLibraryApi,
  fetchMonsters,
  type ArrowOverlay,
  type RadiusCircle,
  type TokenData,
  type CharacterRecord,
} from "../hooks/useGameSocket";
import { useDiceHistory } from "../hooks/useDiceHistory";
import { useInitiative, INITIATIVE_FOCUS_SCALE } from "../hooks/useInitiative";
import { useTokenClipboard } from "../hooks/useTokenClipboard";
import { useTokenKeyboardMove } from "../hooks/useTokenKeyboardMove";
import { usePages } from "../hooks/usePages";
import { usePanels } from "../hooks/usePanels";
import "../App.css";

export default function DM() {
  const {
    pages,
    presentedPageId,
    ping,
    diceResult,
    diceLog,
    appendDiceResult,
    connected,
    characters,
    send,
  } = useGameSocket();
  const [aspectLocked, setAspectLocked] = useState(true);
  const [activeTool, setActiveTool] = useState<ActiveTool>("select");
  const [mapMenuOpen, setMapMenuOpen] = useState(false);
  const [selectedTokenIds, setSelectedTokenIds] = useState<Set<string>>(
    new Set(),
  );
  const [localArrow, setLocalArrow] = useState<ArrowOverlay | null>(null);
  const [localRadius, setLocalRadius] = useState<RadiusCircle | null>(null);
  const [monsters, setMonsters] = useState<Monster[]>([]);
  const [monsterWindow, setMonsterWindow] = useState<{
    tokenId: string;
    x: number;
    y: number;
  } | null>(null);
  const [tokenMenuOpen, setTokenMenuOpen] = useState(false);
  const [playerMenu, setPlayerMenu] = useState<{
    playerId: string;
    name: string;
    // The player's token on the active page, or null when they have none here
    // (a grayed chip) — the token-centric actions are hidden in that case.
    token: TokenData | null;
    x: number;
    y: number;
  } | null>(null);
  // A read-only character sheet opened from the player bar (a retired character
  // has no map token, so it can't reuse the token-driven sheet window).
  const [sheetWindow, setSheetWindow] = useState<{
    name: string;
    data: string | undefined;
    x: number;
    y: number;
  } | null>(null);
  // The shared graveyard menu (all retired characters), opened from the bar.
  const [retiredMenu, setRetiredMenu] = useState<{ x: number; y: number } | null>(
    null,
  );
  // Right-click menu for a pinned (DM/NPC) token chip in the top bar.
  const [pinnedMenu, setPinnedMenu] = useState<{
    token: TokenData;
    x: number;
    y: number;
  } | null>(null);

  const mapAreaRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const tokenMenuRef = useRef<HTMLDivElement>(null);
  const mapMenuRef = useRef<HTMLDivElement>(null);

  const {
    activePage,
    activeId,
    pagesMenuRef,
    pagesMenuOpen,
    setPagesMenuOpen,
    renamingPageId,
    setRenamingPageId,
    renameValue,
    setRenameValue,
    pageContextMenu,
    setPageContextMenu,
    switchToPage,
    handleAddPage,
    handlePresentPage,
    handleDeletePage,
    startRename,
    commitRename,
  } = usePages({
    pages,
    presentedPageId,
    send,
    onPageSwitch: () => setSelectedTokenIds(new Set()),
  });

  const {
    history: diceHistory,
    privateRollRequests,
    handleRoll,
    handleDiceResult,
    handleMonsterRoll,
  } = useDiceHistory({ diceLog, appendDiceResult, send });

  const panels = usePanels();

  const initiative = useInitiative({
    diceResult,
    activePage,
    activeId,
    monsters,
    send,
  });

  const measureToolActive = activeTool === "arrow" || activeTool === "radius";
  const fogToolActive =
    activeTool === "fog-reveal-box" ||
    activeTool === "fog-reveal-poly" ||
    activeTool === "fog-hide";
  const fogToolLabel =
    activeTool === "fog-reveal-box"
      ? "Reveal Box"
      : activeTool === "fog-reveal-poly"
        ? "Reveal Poly"
        : "Hide";

  useTokenClipboard({
    activePage,
    activeId,
    selectedTokenIds,
    stageRef,
    mapAreaRef,
    send,
  });

  useTokenKeyboardMove({ activePage, activeId, selectedTokenIds, send });

  useEffect(() => {
    fetchMonsters().then(setMonsters).catch(console.error);
  }, []);

  function handleTokenDoubleClick(id: string, x: number, y: number) {
    setMonsterWindow({ tokenId: id, x, y });
  }

  // Close each toolbar menu when a mousedown lands outside it. The Pages menu's
  // own dismissal is owned by usePages.
  useOutsideClick(tokenMenuRef, () => setTokenMenuOpen(false), tokenMenuOpen);
  useOutsideClick(mapMenuRef, () => setMapMenuOpen(false), mapMenuOpen);

  // Set the active page's map to a library image. Dimensions are read from the
  // image at selection time (the library only stores the file + its placement).
  function setMapFromLibrary(url: string) {
    if (!activeId) return;
    const img = new Image();
    img.onload = () =>
      send({
        case: "mapSet",
        value: {
          pageId: activeId,
          url,
          width: img.naturalWidth,
          height: img.naturalHeight,
        },
      });
    img.src = url;
  }

  // The world-space point at the center of the DM's current viewport, where
  // newly placed tokens land.
  function viewportCenterWorld() {
    const stage = stageRef.current;
    let x = (mapAreaRef.current?.clientWidth ?? window.innerWidth) / 2;
    let y = (mapAreaRef.current?.clientHeight ?? window.innerHeight) / 2;
    if (stage) {
      const scale = stage.scaleX();
      x = (x - stage.x()) / scale;
      y = (y - stage.y()) / scale;
    }
    return { x, y };
  }

  // Place a token at the current viewport center. The library menu stays open
  // so several tokens can be dropped in a row.
  function placeToken(url: string) {
    if (!activeId) return;
    const { x, y } = viewportCenterWorld();
    send({
      case: "tokenAdd",
      value: { pageId: activeId, token: { id: uuid(), url, x, y } },
    });
  }

  // Add a player's character token to the active page from their bar chip. The
  // token carries the player's stored identity (name, color, image) and owner
  // link; the server enforces one player token per player per page.
  function placePlayerToken(playerId: string, ch: CharacterRecord) {
    if (!activeId || !ch.tokenUrl) return;
    const { x, y } = viewportCenterWorld();
    send({
      case: "tokenAdd",
      value: {
        pageId: activeId,
        token: {
          id: uuid(),
          url: ch.tokenUrl,
          x,
          y,
          name: ch.name,
          color: ch.color || undefined,
          showName: true,
          public: true,
          player: true,
          ownerPlayerId: playerId,
          characterId: ch.characterId,
        },
      },
    });
  }

  // The player's active (non-archived) character, if any. `characters` is keyed
  // by characterId and holds the whole roster, so we resolve the live one here.
  function activeCharacterFor(playerId: string): CharacterRecord | undefined {
    return Object.values(characters).find(
      (c) => c.ownerPlayerId === playerId && !c.archived,
    );
  }

  function handleMoveToken(id: string, x: number, y: number) {
    if (!activeId) return;
    send({ case: "tokenMove", value: { pageId: activeId, id, x, y } });
  }

  function handleMapSizeInput(axis: "width" | "height", value: string) {
    const n = parseInt(value, 10);
    if (!activePage?.mapSize || isNaN(n) || n <= 0 || !activeId) return;
    let { width, height } = activePage.mapSize;
    if (aspectLocked) {
      const ratio = activePage.mapSize.width / activePage.mapSize.height;
      if (axis === "width") {
        width = n;
        height = Math.round(n / ratio);
      } else {
        height = n;
        width = Math.round(n * ratio);
      }
    } else {
      if (axis === "width") width = n;
      else height = n;
    }
    send({ case: "mapResize", value: { pageId: activeId, width, height } });
  }

  function handleFogDraw(poly: { points: number[] }) {
    if (!activeId) return;
    send({
      case: "fogAdd",
      value: { pageId: activeId, id: uuid(), points: poly.points },
    });
  }

  function handleFogRemove(id: string) {
    if (!activeId) return;
    send({ case: "fogRemove", value: { pageId: activeId, id } });
  }

  function handleDeleteTokens(ids: Set<string>) {
    if (!activeId) return;
    for (const id of ids)
      send({ case: "tokenRemove", value: { pageId: activeId, id } });
    initiative.removeByTokenIds(ids);
    setSelectedTokenIds(new Set());
  }

  function handleUpdateToken(
    ids: Set<string>,
    update: {
      color?: string;
      borderWidth?: number;
      name?: string;
      showName?: boolean;
      public?: boolean;
      monster?: string;
      hp?: number;
      wounds?: number;
      pinned?: boolean;
    },
  ) {
    if (!activeId) return;
    for (const id of ids)
      send({ case: "tokenUpdate", value: { pageId: activeId, id, ...update } });
  }

  function handleUpdateTokenStatus(
    ids: Set<string>,
    action: "add" | "remove",
    effectId: string,
  ) {
    if (!activeId) return;
    const page = pages.find((p) => p.id === activeId);
    if (!page) return;
    for (const id of ids) {
      const token = page.tokens.find((t) => t.id === id);
      if (!token) continue;
      const current = token.statusEffects ?? [];
      const next =
        action === "add"
          ? current.includes(effectId)
            ? current
            : [...current, effectId]
          : current.filter((e) => e !== effectId);
      send({
        case: "tokenStatus",
        value: { pageId: activeId, id, statusEffects: next },
      });
    }
  }

  function handleArrowUpdate(arrow: ArrowOverlay) {
    setLocalArrow(arrow);
    send({ case: "arrowUpdate", value: { pageId: activeId, ...arrow } });
  }

  function handleArrowClear() {
    setLocalArrow(null);
    send({ case: "arrowClear", value: { pageId: activeId } });
  }

  function handleRadiusUpdate(circle: RadiusCircle) {
    setLocalRadius(circle);
    send({ case: "radiusUpdate", value: { pageId: activeId, ...circle } });
  }

  function handleRadiusClear() {
    setLocalRadius(null);
    send({ case: "radiusClear", value: { pageId: activeId } });
  }

  function handlePing(pos: { x: number; y: number }) {
    send({ case: "ping", value: { pageId: activeId, ...pos } });
  }

  function handleBringPlayersHere(
    worldCenterX: number,
    worldCenterY: number,
    scale: number,
  ) {
    send({
      case: "viewportSync",
      value: { pageId: activeId, worldCenterX, worldCenterY, scale },
    });
  }

  // Pan/zoom the DM's own stage so the token sits centered at the shared focus
  // zoom (same as initiative "Focus view"). Animated to match the viewer tween.
  function centerViewOnToken(token: TokenData) {
    const stage = stageRef.current;
    const area = mapAreaRef.current;
    if (!stage || !area) return;
    const scale = INITIATIVE_FOCUS_SCALE;
    new Konva.Tween({
      node: stage,
      x: area.clientWidth / 2 - token.x * scale,
      y: area.clientHeight / 2 - token.y * scale,
      scaleX: scale,
      scaleY: scale,
      duration: 0.3,
      easing: Konva.Easings.EaseInOut,
    }).play();
  }

  // Evict a player everywhere: server drops their sheet and all owned tokens
  // across every page, then rebroadcasts so all clients (including us) update.
  // We also prune the local initiative list of their active-page tokens, which
  // is client-only state the server doesn't track.
  function handleDeletePlayer(playerId: string) {
    const tokenIds = new Set(
      (activePage?.tokens ?? [])
        .filter((t) => t.ownerPlayerId === playerId)
        .map((t) => t.id),
    );
    send({ case: "playerRemove", value: { playerId } });
    initiative.removeByTokenIds(tokenIds);
    setSelectedTokenIds(new Set());
  }

  return (
    <div className="window app">
      {/* ── Title bar ── */}
      <div className="title-bar">
        <div className="title-bar-text">Butter Roll — DM</div>
        <div className="title-bar-controls">
          <button aria-label="Minimize"></button>
          <button aria-label="Maximize" disabled></button>
          <button aria-label="Close"></button>
        </div>
      </div>

      <div className="window-body app-body">
        {/* ── Toolbar row ── */}
        <div className="toolbar-row">
          <div className="menu-group pages-menu-group" ref={pagesMenuRef}>
            <button onClick={() => setPagesMenuOpen((o) => !o)}>Pages ▾</button>
            {pagesMenuOpen && (
              <div className="window pages-dropdown">
                <div className="window-body">
                  {pages.map((page) => (
                    <div
                      key={page.id}
                      className={`pages-row${activeId === page.id ? " pages-row-active" : ""}`}
                      onClick={() => switchToPage(page.id)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setPageContextMenu({
                          pageId: page.id,
                          x: e.clientX,
                          y: e.clientY,
                        });
                      }}
                    >
                      {renamingPageId === page.id ? (
                        <input
                          className="pages-row-rename"
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={() => commitRename(page.id, page.name)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur();
                            if (e.key === "Escape") setRenamingPageId(null);
                            e.stopPropagation();
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span className="pages-row-name">{page.name}</span>
                      )}
                      {presentedPageId === page.id ? (
                        <span className="live-badge">● Live</span>
                      ) : (
                        <button
                          className="present-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePresentPage(page.id);
                          }}
                        >
                          Present
                        </button>
                      )}
                    </div>
                  ))}
                  <div
                    className="pages-row pages-add-row"
                    onClick={handleAddPage}
                  >
                    + New Page
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="menu-group map-menu-group" ref={mapMenuRef}>
            <button onClick={() => setMapMenuOpen((o) => !o)}>Map ▾</button>
            {mapMenuOpen && (
              <div className="window map-dropdown">
                <div className="window-body token-dropdown-body">
                  {activePage?.mapSize && (
                    <>
                      <div className="map-dropdown-row">
                        <MapSizeInput
                          label="W"
                          value={activePage.mapSize.width}
                          onChange={(n) =>
                            handleMapSizeInput("width", String(n))
                          }
                        />
                        <MapSizeInput
                          label="H"
                          value={activePage.mapSize.height}
                          onChange={(n) =>
                            handleMapSizeInput("height", String(n))
                          }
                        />
                      </div>
                      <div className="map-aspect-toggle">
                        <input
                          type="checkbox"
                          id="map-aspect-lock"
                          checked={aspectLocked}
                          onChange={(e) => setAspectLocked(e.target.checked)}
                        />
                        <label htmlFor="map-aspect-lock">
                          Lock aspect ratio
                        </label>
                      </div>
                      <hr className="map-dropdown-sep" />
                    </>
                  )}
                  <AssetLibrary
                    api={mapLibraryApi}
                    onSelect={setMapFromLibrary}
                    noun="map"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="menu-group token-menu-group" ref={tokenMenuRef}>
            <button onClick={() => setTokenMenuOpen((o) => !o)}>
              Tokens ▾
            </button>
            {tokenMenuOpen && (
              <div className="window token-dropdown">
                <div className="window-body token-dropdown-body">
                  <AssetLibrary api={tokenLibraryApi} onSelect={placeToken} />
                </div>
              </div>
            )}
          </div>

          <div className="toolbar-right">
            <button
              className={panels.monsters.open ? "toolbar-btn-active" : ""}
              onClick={panels.monsters.toggle}
            >
              Monsters
            </button>
            <button
              className={panels.initiative.open ? "toolbar-btn-active" : ""}
              onClick={panels.initiative.toggle}
            >
              Initiative
            </button>
            <button
              className={panels.dice.open ? "toolbar-btn-active" : ""}
              onClick={panels.dice.toggle}
            >
              Dice
            </button>
            <span className="connection-status">
              {connected ? "● Connected" : "○ Offline"}
            </span>
          </div>
        </div>

        {/* ── Player token bar ── */}
        {(() => {
          // Group the roster by owning player; each chip shows that player's
          // active character. Retired characters are unassociated and reached
          // from the shared graveyard button instead.
          const activeByPlayer = new Map<string, CharacterRecord>();
          let retiredCount = 0;
          for (const c of Object.values(characters)) {
            if (c.archived) retiredCount++;
            else activeByPlayer.set(c.ownerPlayerId, c);
          }
          const players = [...activeByPlayer.entries()];
          // DM/NPC tokens pinned from their right-click menu get a quick-access
          // chip too, after a divider that separates them from player chips.
          const pinnedTokens = (activePage?.tokens ?? []).filter((t) => t.pinned);
          if (
            players.length === 0 &&
            retiredCount === 0 &&
            pinnedTokens.length === 0
          )
            return null;
          // Index this page's player tokens by the character they represent, so
          // a chip is "present" only when its active character's own token is
          // here (a retired character's leftover token has a different id).
          const tokenByCharacter = new Map<string, TokenData>();
          for (const t of activePage?.tokens ?? [])
            if (t.player && t.characterId)
              tokenByCharacter.set(t.characterId, t);
          return (
            <div className="player-token-bar">
              {players.map(([playerId, ch]) => {
                const token = tokenByCharacter.get(ch.characterId) ?? null;
                const name = ch.name || token?.name || "Player";
                const url = ch.tokenUrl || token?.url || "";
                return (
                  <button
                    key={playerId}
                    className={`player-token-chip${token ? "" : " player-token-chip-absent"}`}
                    title={
                      token ? name : `${name} (click to add to this page)`
                    }
                    onClick={() =>
                      token
                        ? centerViewOnToken(token)
                        : placePlayerToken(playerId, ch)
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
                      style={
                        token?.color ? { borderColor: token.color } : undefined
                      }
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
                      onClick={() => centerViewOnToken(token)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setPinnedMenu({ token, x: e.clientX, y: e.clientY });
                      }}
                    >
                      <img
                        className="player-token-chip-img"
                        src={token.url}
                        alt={token.name || "Pinned token"}
                        style={
                          token.color
                            ? { borderColor: token.color }
                            : undefined
                        }
                      />
                      <span className="player-token-chip-name">
                        {token.name || "Token"}
                      </span>
                    </button>
                  ))}
                </>
              )}
              {retiredCount > 0 && (
                <button
                  className="player-token-graveyard"
                  title={`Retired characters (${retiredCount})`}
                  onClick={(e) =>
                    setRetiredMenu({ x: e.clientX, y: e.clientY })
                  }
                >
                  <GiTombstone />
                  <span className="player-token-chip-name">Retired</span>
                </button>
              )}
            </div>
          );
        })()}

        {/* ── Shared graveyard menu (all retired characters) ── */}
        {retiredMenu &&
          (() => {
            const retired = Object.values(characters).filter((c) => c.archived);
            return (
              <ContextMenu
                x={retiredMenu.x}
                y={retiredMenu.y}
                title="Retired characters"
                onClose={() => setRetiredMenu(null)}
              >
                {retired.length === 0 ? (
                  <li className="context-menu-heading">None yet</li>
                ) : (
                  retired.map((c) => (
                    <li
                      key={c.characterId}
                      onClick={() => {
                        setSheetWindow({
                          name: c.name || "Retired character",
                          data: c.data,
                          x: retiredMenu.x,
                          y: retiredMenu.y,
                        });
                        setRetiredMenu(null);
                      }}
                    >
                      View {c.name || "retired character"}
                    </li>
                  ))
                )}
              </ContextMenu>
            );
          })()}

        {/* ── Player token context menu ── */}
        {playerMenu &&
          (() => {
            // Captured for narrowing: the focus/sheet actions only exist when the
            // player has a token on this page; absent players get Delete only.
            const { token } = playerMenu;
            return (
              <ContextMenu
                x={playerMenu.x}
                y={playerMenu.y}
                title={playerMenu.name}
                onClose={() => setPlayerMenu(null)}
              >
                {token && (
                  <li
                    onClick={() => {
                      setMonsterWindow({
                        tokenId: token.id,
                        x: playerMenu.x,
                        y: playerMenu.y,
                      });
                      setPlayerMenu(null);
                    }}
                  >
                    Character sheet
                  </li>
                )}
                {token && (
                  <li
                    onClick={() => {
                      handleBringPlayersHere(
                        token.x,
                        token.y,
                        INITIATIVE_FOCUS_SCALE,
                      );
                      setPlayerMenu(null);
                    }}
                  >
                    Bring player view here
                  </li>
                )}
                <li
                  onClick={() => {
                    handleDeletePlayer(playerMenu.playerId);
                    setPlayerMenu(null);
                  }}
                >
                  Delete
                </li>
              </ContextMenu>
            );
          })()}

        {/* ── Pinned token context menu ── */}
        {pinnedMenu && (
          <ContextMenu
            x={pinnedMenu.x}
            y={pinnedMenu.y}
            title={pinnedMenu.token.name || "Pinned token"}
            onClose={() => setPinnedMenu(null)}
          >
            <li
              onClick={() => {
                handleUpdateToken(new Set([pinnedMenu.token.id]), {
                  pinned: false,
                });
                setPinnedMenu(null);
              }}
            >
              Unpin
            </li>
            <li
              onClick={() => {
                handleBringPlayersHere(
                  pinnedMenu.token.x,
                  pinnedMenu.token.y,
                  INITIATIVE_FOCUS_SCALE,
                );
                setPinnedMenu(null);
              }}
            >
              Bring player view here
            </li>
            <li
              onClick={() => {
                handleDeleteTokens(new Set([pinnedMenu.token.id]));
                setPinnedMenu(null);
              }}
            >
              Delete
            </li>
          </ContextMenu>
        )}

        {/* ── Page context menu ── */}
        {pageContextMenu &&
          (() => {
            const page = pages.find((p) => p.id === pageContextMenu.pageId);
            if (!page) return null;
            return (
              <ContextMenu
                x={pageContextMenu.x}
                y={pageContextMenu.y}
                title="Page"
                onClose={() => setPageContextMenu(null)}
              >
                <li onClick={() => startRename(page)}>Rename</li>
                {pages.length > 1 && (
                  <li onClick={() => handleDeletePage(page.id)}>Delete</li>
                )}
              </ContextMenu>
            );
          })()}

        {/* ── Content area: sidebar + canvas ── */}
        <div className="content">
          <aside className="sidebar">
            <ul className="tree-view">
              <li
                className={activeTool === "select" ? "active" : ""}
                onClick={() => setActiveTool("select")}
              >
                Select
              </li>
              <li>
                <details>
                  <summary className={measureToolActive ? "active" : ""}>
                    Measure
                    {measureToolActive && (
                      <em> ({activeTool === "arrow" ? "Arrow" : "Radius"})</em>
                    )}
                  </summary>
                  <ul>
                    <li
                      className={activeTool === "arrow" ? "active" : ""}
                      onClick={() => setActiveTool("arrow")}
                    >
                      Arrow
                    </li>
                    <li
                      className={activeTool === "radius" ? "active" : ""}
                      onClick={() => setActiveTool("radius")}
                    >
                      Radius
                    </li>
                  </ul>
                </details>
              </li>
              <li>
                <details>
                  <summary className={fogToolActive ? "active" : ""}>
                    Fog
                    {fogToolActive && (
                      <em>
                        {" "}
                        ({fogToolLabel})
                      </em>
                    )}
                  </summary>
                  <ul>
                    <li
                      className={
                        activeTool === "fog-reveal-box" ? "active" : ""
                      }
                      onClick={() => setActiveTool("fog-reveal-box")}
                    >
                      Reveal Box
                    </li>
                    <li
                      className={
                        activeTool === "fog-reveal-poly" ? "active" : ""
                      }
                      onClick={() => setActiveTool("fog-reveal-poly")}
                    >
                      Reveal Poly
                    </li>
                    <li
                      className={activeTool === "fog-hide" ? "active" : ""}
                      onClick={() => setActiveTool("fog-hide")}
                    >
                      Hide
                    </li>
                    <li
                      onClick={() =>
                        activeId &&
                        send({ case: "fogClear", value: { pageId: activeId } })
                      }
                    >
                      Hide All
                    </li>
                  </ul>
                </details>
              </li>
            </ul>
          </aside>

          <MapCanvas
            mapUrl={activePage?.mapUrl ?? null}
            mapSize={activePage?.mapSize ?? null}
            tokens={activePage?.tokens ?? []}
            selectedTokenIds={selectedTokenIds}
            onMoveToken={handleMoveToken}
            onSelectionChange={setSelectedTokenIds}
            mapAreaRef={mapAreaRef}
            onStageReady={(stage) => {
              stageRef.current = stage;
            }}
            fogPolys={activePage?.fogPolys ?? []}
            tool={activeTool}
            onFogDraw={handleFogDraw}
            onFogRemove={handleFogRemove}
            onDeleteTokens={handleDeleteTokens}
            onUpdateToken={handleUpdateToken}
            onUpdateTokenStatus={handleUpdateTokenStatus}
            arrowOverlay={localArrow}
            onArrowUpdate={handleArrowUpdate}
            onArrowClear={handleArrowClear}
            radiusCircle={localRadius}
            onRadiusUpdate={handleRadiusUpdate}
            onRadiusClear={handleRadiusClear}
            ping={ping}
            onPing={handlePing}
            onBringPlayersHere={handleBringPlayersHere}
            onAddToInitiative={initiative.handleAddToInitiative}
            onTokenDoubleClick={handleTokenDoubleClick}
            monsters={monsters}
            initiativeTokenId={
              panels.initiative.open
                ? initiative.entries.find(
                    (e) => e.entryId === initiative.currentId,
                  )?.tokenId ?? null
                : null
            }
          />
        </div>
      </div>
      {panels.initiative.open && (
        <InitiativePanel
          entries={initiative.entries.map((e) => {
            const t = activePage?.tokens.find((t) => t.id === e.tokenId);
            return t ? { ...e, name: t.name || t.monster || "", url: t.url } : e;
          })}
          currentId={initiative.currentId}
          onCurrentChange={initiative.setCurrentId}
          onValueChange={(entryId, value) =>
            initiative.setEntries((prev) =>
              prev.map((e) => (e.entryId === entryId ? { ...e, value } : e)),
            )
          }
          onRemove={(entryId) =>
            initiative.setEntries((prev) =>
              prev.filter((e) => e.entryId !== entryId),
            )
          }
          onClose={panels.initiative.close}
          zIndex={panels.initiative.zIndex}
          onFocus={panels.initiative.focus}
          focusView={initiative.focusView}
          onFocusViewChange={initiative.setFocusView}
        />
      )}
      {panels.dice.open && (
        <DicePanel
          history={diceHistory}
          onRoll={handleRoll}
          onClose={panels.dice.close}
          zIndex={panels.dice.zIndex}
          onFocus={panels.dice.focus}
        />
      )}
      {panels.monsters.open && (
        <MonstersPanel
          monsters={monsters}
          onRoll={handleMonsterRoll}
          onClose={panels.monsters.close}
          zIndex={panels.monsters.zIndex}
          onFocus={panels.monsters.focus}
        />
      )}
      {monsterWindow &&
        (() => {
          const token = activePage?.tokens.find(
            (t) => t.id === monsterWindow.tokenId,
          );
          if (!token) return null;
          // A player's own token shows their (read-only) character sheet instead
          // of the monster-link window.
          if (token.player && token.ownerPlayerId) {
            // Attribute rolls made from the sheet to the player, not the DM.
            const pname = token.name || "Player";
            return (
              <TokenCharacterWindow
                name={pname}
                data={activeCharacterFor(token.ownerPlayerId)?.data}
                x={monsterWindow.x}
                y={monsterWindow.y}
                ready={connected}
                onRollCheck={(mod, label) => {
                  const expr =
                    mod === 0 ? "1d20" : mod > 0 ? `1d20+${mod}` : `1d20${mod}`;
                  handleMonsterRoll(expr, label, pname);
                }}
                onRoll={(expr, label) => handleMonsterRoll(expr, label, pname)}
                onClose={() => setMonsterWindow(null)}
              />
            );
          }
          return (
            <TokenMonsterWindow
              token={token}
              monsters={monsters}
              x={monsterWindow.x}
              y={monsterWindow.y}
              onUpdate={(update) => {
                // The `dead` status is kept in sync with HP by the backend rules
                // engine (see docs/config.md), inside this same tokenUpdate — no
                // client-side status handling needed.
                send({
                  case: "tokenUpdate",
                  value: { pageId: activeId, id: token.id, ...update },
                });
              }}
              onRoll={handleMonsterRoll}
              onClose={() => setMonsterWindow(null)}
            />
          );
        })()}
      {sheetWindow && (
        <TokenCharacterWindow
          name={sheetWindow.name}
          data={sheetWindow.data}
          x={sheetWindow.x}
          y={sheetWindow.y}
          ready={connected}
          onRollCheck={(mod, label) => {
            const expr =
              mod === 0 ? "1d20" : mod > 0 ? `1d20+${mod}` : `1d20${mod}`;
            handleMonsterRoll(expr, label, sheetWindow.name);
          }}
          onRoll={(expr, label) =>
            handleMonsterRoll(expr, label, sheetWindow.name)
          }
          onClose={() => setSheetWindow(null)}
        />
      )}
      <DiceOverlay requests={privateRollRequests} onResult={handleDiceResult} />
    </div>
  );
}
