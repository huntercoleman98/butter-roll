import { useEffect, useRef, useState } from "react";
import { uuid } from "../utils/uuid";
import type Konva from "konva";
import MapCanvas, { type ActiveTool } from "../components/MapCanvas";
import MapSizeInput from "../components/MapSizeInput";
import DicePanel from "../components/DicePanel";
import DiceOverlay from "../components/DiceOverlay";
import InitiativePanel from "../components/InitiativePanel";
import MonstersPanel from "../components/MonstersPanel";
import TokenMonsterWindow from "../components/TokenMonsterWindow";
import TokenLibrary from "../components/TokenLibrary";
import { ContextMenu } from "../components/ContextMenu";
import { useOutsideClick } from "../hooks/useOutsideClick";
import type { Monster } from "../types/monster";
import {
  useGameSocket,
  uploadAsset,
  fetchMonsters,
  type ArrowOverlay,
  type RadiusCircle,
} from "../hooks/useGameSocket";
import { useDiceHistory } from "../hooks/useDiceHistory";
import { useInitiative } from "../hooks/useInitiative";
import { useTokenClipboard } from "../hooks/useTokenClipboard";
import { useTokenKeyboardMove } from "../hooks/useTokenKeyboardMove";
import { usePages } from "../hooks/usePages";
import { usePanels } from "../hooks/usePanels";
import "../App.css";

export default function DM() {
  const { pages, presentedPageId, ping, diceResult, connected, send } =
    useGameSocket();
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

  const mapAreaRef = useRef<HTMLDivElement>(null);
  const mapInputRef = useRef<HTMLInputElement>(null);
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
  } = useDiceHistory({ diceResult, send });

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

  async function handleMapFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !activeId) return;
    e.target.value = "";
    const url = await uploadAsset(file);
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

  // Place a token at the current viewport center. The library menu stays open
  // so several tokens can be dropped in a row.
  function placeToken(url: string) {
    if (!activeId) return;
    const stage = stageRef.current;
    let x = (mapAreaRef.current?.clientWidth ?? window.innerWidth) / 2;
    let y = (mapAreaRef.current?.clientHeight ?? window.innerHeight) / 2;
    if (stage) {
      const scale = stage.scaleX();
      x = (x - stage.x()) / scale;
      y = (y - stage.y()) / scale;
    }
    send({
      case: "tokenAdd",
      value: { pageId: activeId, token: { id: uuid(), url, x, y } },
    });
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

          <input
            ref={mapInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleMapFile}
          />
          <div className="menu-group map-menu-group" ref={mapMenuRef}>
            <button onClick={() => setMapMenuOpen((o) => !o)}>Map ▾</button>
            {mapMenuOpen && (
              <div className="window map-dropdown">
                <div className="window-body">
                  <button
                    onClick={() => {
                      mapInputRef.current?.click();
                      setMapMenuOpen(false);
                    }}
                  >
                    Set Map…
                  </button>
                  {activePage?.mapSize && (
                    <div className="map-dropdown-row">
                      <MapSizeInput
                        label="W"
                        value={activePage.mapSize.width}
                        onChange={(n) => handleMapSizeInput("width", String(n))}
                      />
                      <MapSizeInput
                        label="H"
                        value={activePage.mapSize.height}
                        onChange={(n) =>
                          handleMapSizeInput("height", String(n))
                        }
                      />
                      <button
                        style={{ padding: "2px 4px" }}
                        onClick={() => setAspectLocked((l) => !l)}
                        title={
                          aspectLocked
                            ? "Unlock aspect ratio"
                            : "Lock aspect ratio"
                        }
                      >
                        {aspectLocked
                          ? "Aspect ratio locked"
                          : "Aspect ratio unlocked"}
                      </button>
                    </div>
                  )}
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
                  <TokenLibrary onPlaceToken={placeToken} />
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
                      Clear Fog
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
          return (
            <TokenMonsterWindow
              token={token}
              monsters={monsters}
              x={monsterWindow.x}
              y={monsterWindow.y}
              onUpdate={(update) => {
                send({
                  case: "tokenUpdate",
                  value: { pageId: activeId, id: token.id, ...update },
                });
                // Wounds reaching max HP marks the token dead. Never undone
                // automatically — the DM removes the status by hand.
                const hp = update.hp ?? token.hp;
                const wounds = update.wounds ?? token.wounds;
                if (
                  (update.wounds !== undefined || update.hp !== undefined) &&
                  hp != null &&
                  hp > 0 &&
                  wounds != null &&
                  wounds >= hp &&
                  !(token.statusEffects ?? []).includes("dead")
                ) {
                  send({
                    case: "tokenStatus",
                    value: {
                      pageId: activeId,
                      id: token.id,
                      statusEffects: [...(token.statusEffects ?? []), "dead"],
                    },
                  });
                }
              }}
              onRoll={handleMonsterRoll}
              onClose={() => setMonsterWindow(null)}
            />
          );
        })()}
      <DiceOverlay requests={privateRollRequests} onResult={handleDiceResult} />
    </div>
  );
}
