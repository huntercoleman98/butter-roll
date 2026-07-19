import { useEffect, useRef, useState } from "react";

function uuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => {
    const n = parseInt(c);
    return (n ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (n / 4)))).toString(16);
  });
}
import type Konva from "konva";
import MapCanvas, { type ActiveTool } from "../components/MapCanvas";
import MapSizeInput from "../components/MapSizeInput";
import DicePanel from "../components/DicePanel";
import DiceOverlay from "../components/DiceOverlay";
import InitiativePanel, { type InitiativeEntry } from "../components/InitiativePanel";
import MonstersPanel from "../components/MonstersPanel";
import TokenMonsterWindow from "../components/TokenMonsterWindow";
import type { Monster } from "../types/monster";
import {
  useGameSocket,
  uploadAsset,
  uploadTokenAsset,
  fetchTokenAssets,
  fetchMonsters,
  type TokenData,
  type ArrowOverlay,
  type RadiusCircle,
  type DiceRollResult,
  type DiceRequest,
} from "../hooks/useGameSocket";
import "../App.css";

type PageContextMenu = { pageId: string; x: number; y: number };

type Clipboard = {
  tokens: TokenData[];
  centroid: { x: number; y: number };
};

export default function DM() {
  const { pages, presentedPageId, ping, diceResult, connected, send } =
    useGameSocket();
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [aspectLocked, setAspectLocked] = useState(true);
  const [activeTool, setActiveTool] = useState<ActiveTool>("select");
  const [mapMenuOpen, setMapMenuOpen] = useState(false);
  const [pagesMenuOpen, setPagesMenuOpen] = useState(false);
  const [renamingPageId, setRenamingPageId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [pageContextMenu, setPageContextMenu] =
    useState<PageContextMenu | null>(null);
  const [selectedTokenIds, setSelectedTokenIds] = useState<Set<string>>(
    new Set(),
  );
  const [clipboard, setClipboard] = useState<Clipboard | null>(null);
  const [localArrow, setLocalArrow] = useState<ArrowOverlay | null>(null);
  const [localRadius, setLocalRadius] = useState<RadiusCircle | null>(null);
  const [dicePanelOpen, setDicePanelOpen] = useState(false);
  const [diceHistory, setDiceHistory] = useState<DiceRollResult[]>([]);
  const [privateRollRequests, setPrivateRollRequests] = useState<DiceRequest[]>([]);
  const [initiativePanelOpen, setInitiativePanelOpen] = useState(false);
  const [initiativeEntries, setInitiativeEntries] = useState<InitiativeEntry[]>([]);
  const [initiativeCurrentId, setInitiativeCurrentId] = useState<string | null>(null);
  const [topPanel, setTopPanel] = useState<"initiative" | "dice" | "monsters">("dice");
  const [monsters, setMonsters] = useState<Monster[]>([]);
  const [monstersPanelOpen, setMonstersPanelOpen] = useState(false);
  const [monsterWindow, setMonsterWindow] = useState<{
    tokenId: string;
    x: number;
    y: number;
  } | null>(null);
  const [tokenMenuOpen, setTokenMenuOpen] = useState(false);
  const [tokenAssets, setTokenAssets] = useState<string[]>([]);

  const mapAreaRef = useRef<HTMLDivElement>(null);
  const pendingInitiativeRolls = useRef<{ entryId: string; label: string }[]>(
    [],
  );
  const mapInputRef = useRef<HTMLInputElement>(null);
  const tokenUploadRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const cursorWorldPos = useRef({ x: 0, y: 0 });

  // On first snapshot, initialize active page to the presented page.
  useEffect(() => {
    if (activePageId === null && pages.length > 0) {
      setActivePageId(presentedPageId ?? pages[0].id);
    }
  }, [pages, presentedPageId, activePageId]);

  // If the active page is deleted remotely, fall back to the first page.
  useEffect(() => {
    if (
      activePageId &&
      pages.length > 0 &&
      !pages.find((p) => p.id === activePageId)
    ) {
      setActivePageId(pages[0].id);
    }
  }, [pages, activePageId]);

  const activePage =
    pages.find((p) => p.id === activePageId) ?? pages[0] ?? null;
  const activeId = activePage?.id ?? "";

  const measureToolActive = activeTool === "arrow" || activeTool === "radius";
  const fogToolActive =
    activeTool === "fog-reveal" || activeTool === "fog-hide";

  // Track cursor position in world space for paste targeting.
  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      const stage = stageRef.current;
      const container = mapAreaRef.current;
      if (!stage || !container) return;
      const rect = container.getBoundingClientRect();
      const scale = stage.scaleX();
      cursorWorldPos.current = {
        x: (e.clientX - rect.left - stage.x()) / scale,
        y: (e.clientY - rect.top - stage.y()) / scale,
      };
    }
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  // Ctrl/Cmd+C to copy selected tokens; Ctrl/Cmd+V to paste at cursor.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!e.metaKey && !e.ctrlKey) return;
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (e.key === "c") {
        if (!activePage || selectedTokenIds.size === 0) return;
        const selected = activePage.tokens.filter((t) =>
          selectedTokenIds.has(t.id),
        );
        if (selected.length === 0) return;
        const centroid = {
          x: selected.reduce((s, t) => s + t.x, 0) / selected.length,
          y: selected.reduce((s, t) => s + t.y, 0) / selected.length,
        };
        setClipboard({ tokens: selected, centroid });
        e.preventDefault();
      }

      if (e.key === "v") {
        if (!clipboard || !activeId) return;
        const { x: cx, y: cy } = clipboard.centroid;
        const { x: px, y: py } = cursorWorldPos.current;
        for (const t of clipboard.tokens) {
          send({
            type: "token_add",
            pageId: activeId,
            id: uuid(),
            url: t.url,
            x: px + (t.x - cx),
            y: py + (t.y - cy),
            ...(t.color !== undefined && { color: t.color }),
            ...(t.borderWidth !== undefined && { borderWidth: t.borderWidth }),
            ...(t.statusEffects !== undefined && {
              statusEffects: t.statusEffects,
            }),
          });
        }
        e.preventDefault();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [activePage, selectedTokenIds, clipboard, activeId, send]);

  useEffect(() => {
    if (!diceResult) return;
    setDiceHistory((prev) => [...prev, diceResult]);
    // Resolve a pending initiative roll matching this result's label.
    if (diceResult.private || !diceResult.label) return;
    const idx = pendingInitiativeRolls.current.findIndex(
      (p) => p.label === diceResult.label,
    );
    if (idx === -1) return;
    const [pending] = pendingInitiativeRolls.current.splice(idx, 1);
    setInitiativeEntries((prev) =>
      prev.map((e) =>
        e.entryId === pending.entryId ? { ...e, value: diceResult.total } : e,
      ),
    );
  }, [diceResult]);

  useEffect(() => {
    fetchMonsters().then(setMonsters).catch(console.error);
  }, []);

  function handleDiceResult(result: DiceRollResult) {
    setDiceHistory((prev) => [
      ...prev,
      { ...result, private: true, playerName: "DM" },
    ]);
  }

  function handleMonsterRoll(expression: string, label?: string) {
    send({ type: "dice_roll_request", expression, playerName: "DM", label });
  }

  function handleTokenDoubleClick(id: string, x: number, y: number) {
    setMonsterWindow({ tokenId: id, x, y });
  }

  function handleRoll(expression: string, isPrivate: boolean, advMode?: "advantage" | "disadvantage", label?: string) {
    if (isPrivate) {
      setPrivateRollRequests((prev) => [
        ...prev,
        { id: crypto.randomUUID(), expression, advMode, label },
      ]);
    } else {
      send({ type: "dice_roll_request", expression, playerName: "DM", advMode, label });
    }
  }

  // Close token menu on outside click.
  useEffect(() => {
    if (!tokenMenuOpen) return;
    function handleClick(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest(".token-menu-group"))
        setTokenMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [tokenMenuOpen]);

  // Close map menu on outside click.
  useEffect(() => {
    if (!mapMenuOpen) return;
    function handleClick(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest(".map-menu-group"))
        setMapMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [mapMenuOpen]);

  // Close pages menu on outside click.
  useEffect(() => {
    if (!pagesMenuOpen) return;
    function handleClick(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest(".pages-menu-group")) {
        setPagesMenuOpen(false);
        setRenamingPageId(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [pagesMenuOpen]);

  // Close page context menu on outside click or Escape.
  useEffect(() => {
    if (!pageContextMenu) return;
    function handleClick() {
      setPageContextMenu(null);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPageContextMenu(null);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [pageContextMenu]);

  async function handleMapFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !activeId) return;
    e.target.value = "";
    const url = await uploadAsset(file);
    const img = new Image();
    img.onload = () =>
      send({
        type: "map_set",
        pageId: activeId,
        url,
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
    img.src = url;
  }

  function openTokenMenu() {
    setTokenMenuOpen(true);
    fetchTokenAssets().then(setTokenAssets).catch(console.error);
  }

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
    send({ type: "token_add", pageId: activeId, id: uuid(), url, x, y });
    setTokenMenuOpen(false);
  }

  async function handleTokenUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    e.target.value = "";
    const urls = await Promise.all(files.map(uploadTokenAsset));
    setTokenAssets((prev) => [...prev, ...urls]);
  }

  function handleMoveToken(id: string, x: number, y: number) {
    if (!activeId) return;
    send({ type: "token_move", pageId: activeId, id, x, y });
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
    send({ type: "map_resize", pageId: activeId, width, height });
  }

  function handleFogDraw(rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) {
    if (!activeId) return;
    send({
      type: "fog_add",
      pageId: activeId,
      id: uuid(),
      ...rect,
    });
  }

  function handleFogRemove(id: string) {
    if (!activeId) return;
    send({ type: "fog_remove", pageId: activeId, id });
  }

  function handleDeleteTokens(ids: Set<string>) {
    if (!activeId) return;
    for (const id of ids) send({ type: "token_remove", pageId: activeId, id });
    setInitiativeEntries((prev) => {
      const next = prev.filter((e) => !ids.has(e.tokenId));
      if (initiativeCurrentId !== null) {
        const removed = prev.find((e) => ids.has(e.tokenId) && e.entryId === initiativeCurrentId);
        if (removed) setInitiativeCurrentId(null);
      }
      return next;
    });
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
      send({ type: "token_update", pageId: activeId, id, ...update });
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
      send({ type: "token_status", pageId: activeId, id, statusEffects: next });
    }
  }

  function handleArrowUpdate(arrow: ArrowOverlay) {
    setLocalArrow(arrow);
    send({ type: "arrow_update", pageId: activeId, ...arrow });
  }

  function handleArrowClear() {
    setLocalArrow(null);
    send({ type: "arrow_clear", pageId: activeId });
  }

  function handleRadiusUpdate(circle: RadiusCircle) {
    setLocalRadius(circle);
    send({ type: "radius_update", pageId: activeId, ...circle });
  }

  function handleRadiusClear() {
    setLocalRadius(null);
    send({ type: "radius_clear", pageId: activeId });
  }

  function handlePing(pos: { x: number; y: number }) {
    send({ type: "ping", pageId: activeId, ...pos });
  }

  function handleAddToInitiative(tokenIds: Set<string>) {
    if (!activePage) return;
    const affected = activePage.tokens.filter((t) => tokenIds.has(t.id));
    const toAdd = affected.map((t) => ({
      entryId: uuid(),
      tokenId: t.id,
      name: t.name || t.monster || "",
      url: t.url,
      value: 0,
    }));
    // Monster-linked tokens roll initiative (1d20 + DEX) on /view; the
    // result sets their initiative value when it comes back.
    toAdd.forEach((entry, i) => {
      const monster = monsters.find((m) => m.name === affected[i].monster);
      if (!monster) return;
      const dex = monster.stats.dexterity;
      const expression = `1d20${dex > 0 ? `+${dex}` : dex < 0 ? `${dex}` : ""}`;
      const label = `${entry.name || monster.name} initiative`;
      pendingInitiativeRolls.current.push({ entryId: entry.entryId, label });
      send({ type: "dice_roll_request", expression, playerName: "DM", label });
    });
    if (toAdd.length > 0) setInitiativeEntries((prev) => [...prev, ...toAdd]);
  }

  function handleBringPlayersHere(
    worldCenterX: number,
    worldCenterY: number,
    scale: number,
  ) {
    send({
      type: "viewport_sync",
      pageId: activeId,
      worldCenterX,
      worldCenterY,
      scale,
    });
  }

  function switchToPage(pageId: string) {
    setActivePageId(pageId);
    setSelectedTokenIds(new Set());
    setPagesMenuOpen(false);
    setRenamingPageId(null);
  }

  function handleAddPage() {
    const id = uuid();
    const name = `Page ${pages.length + 1}`;
    send({ type: "page_add", id, name });
    setActivePageId(id);
    setPagesMenuOpen(false);
  }

  function handlePresentPage(id: string) {
    send({ type: "page_present", id });
    setPagesMenuOpen(false);
  }

  function handleDeletePage(id: string) {
    setPageContextMenu(null);
    if (id === activeId) {
      const other = pages.find((p) => p.id !== id);
      if (other) setActivePageId(other.id);
    }
    send({ type: "page_remove", id });
  }

  function startRename(page: { id: string; name: string }) {
    setPageContextMenu(null);
    setRenamingPageId(page.id);
    setRenameValue(page.name);
    if (!pagesMenuOpen) setPagesMenuOpen(true);
  }

  function commitRename(pageId: string, currentName: string) {
    const name = renameValue.trim() || currentName;
    send({ type: "page_rename", id: pageId, name });
    setRenamingPageId(null);
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
          <div className="menu-group pages-menu-group">
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
          <div className="menu-group map-menu-group">
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

          <div className="menu-group token-menu-group">
            <button onClick={() => (tokenMenuOpen ? setTokenMenuOpen(false) : openTokenMenu())}>
              Tokens ▾
            </button>
            {tokenMenuOpen && (
              <div className="window token-dropdown">
                <div className="window-body token-dropdown-body">
                  <div className="token-upload-row">
                    <button onClick={() => tokenUploadRef.current?.click()}>
                      Upload new…
                    </button>
                    <input
                      ref={tokenUploadRef}
                      type="file"
                      accept="image/*"
                      multiple
                      style={{ display: "none" }}
                      onChange={handleTokenUpload}
                    />
                  </div>
                  {tokenAssets.length === 0 ? (
                    <div className="token-empty">No tokens uploaded yet.</div>
                  ) : (
                    <div className="token-grid">
                      {tokenAssets.map((url) => (
                        <button
                          key={url}
                          className="token-thumb"
                          onClick={() => placeToken(url)}
                          title={url.split("/").pop()}
                        >
                          <img src={url} alt="" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="toolbar-right">
            <button
              className={monstersPanelOpen ? "toolbar-btn-active" : ""}
              onClick={() => {
                setMonstersPanelOpen((o) => !o);
                setTopPanel("monsters");
              }}
            >
              Monsters
            </button>
            <button
              className={initiativePanelOpen ? "toolbar-btn-active" : ""}
              onClick={() => {
                setInitiativePanelOpen((o) => !o);
                setTopPanel("initiative");
              }}
            >
              Initiative
            </button>
            <button
              className={dicePanelOpen ? "toolbar-btn-active" : ""}
              onClick={() => {
                setDicePanelOpen((o) => !o);
                setTopPanel("dice");
              }}
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
              <div
                className="window context-menu"
                style={{
                  position: "fixed",
                  left: pageContextMenu.x,
                  top: pageContextMenu.y,
                  zIndex: 200,
                }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className="title-bar">
                  <div className="title-bar-text">Page</div>
                  <div className="title-bar-controls">
                    <button
                      aria-label="Close"
                      onClick={() => setPageContextMenu(null)}
                    />
                  </div>
                </div>
                <div className="window-body">
                  <ul className="tree-view">
                    <li onClick={() => startRename(page)}>Rename</li>
                    {pages.length > 1 && (
                      <li onClick={() => handleDeletePage(page.id)}>Delete</li>
                    )}
                  </ul>
                </div>
              </div>
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
                        ({activeTool === "fog-reveal" ? "Reveal" : "Hide"})
                      </em>
                    )}
                  </summary>
                  <ul>
                    <li
                      className={activeTool === "fog-reveal" ? "active" : ""}
                      onClick={() => setActiveTool("fog-reveal")}
                    >
                      Reveal
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
                        send({ type: "fog_clear", pageId: activeId })
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
            fogRects={activePage?.fogRects ?? []}
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
            onAddToInitiative={handleAddToInitiative}
            onTokenDoubleClick={handleTokenDoubleClick}
            monsters={monsters}
            initiativeTokenId={
              initiativePanelOpen
                ? initiativeEntries.find((e) => e.entryId === initiativeCurrentId)
                    ?.tokenId ?? null
                : null
            }
          />
        </div>
      </div>
      {initiativePanelOpen && (
        <InitiativePanel
          entries={initiativeEntries.map((e) => {
            const t = activePage?.tokens.find((t) => t.id === e.tokenId);
            return t ? { ...e, name: t.name || t.monster || "", url: t.url } : e;
          })}
          currentId={initiativeCurrentId}
          onCurrentChange={setInitiativeCurrentId}
          onValueChange={(entryId, value) =>
            setInitiativeEntries((prev) =>
              prev.map((e) => (e.entryId === entryId ? { ...e, value } : e)),
            )
          }
          onRemove={(entryId) =>
            setInitiativeEntries((prev) =>
              prev.filter((e) => e.entryId !== entryId),
            )
          }
          onClose={() => setInitiativePanelOpen(false)}
          zIndex={topPanel === "initiative" ? 151 : 150}
          onFocus={() => setTopPanel("initiative")}
        />
      )}
      {dicePanelOpen && (
        <DicePanel
          history={diceHistory}
          onRoll={handleRoll}
          onClose={() => setDicePanelOpen(false)}
          zIndex={topPanel === "dice" ? 151 : 150}
          onFocus={() => setTopPanel("dice")}
        />
      )}
      {monstersPanelOpen && (
        <MonstersPanel
          monsters={monsters}
          onRoll={handleMonsterRoll}
          onClose={() => setMonstersPanelOpen(false)}
          zIndex={topPanel === "monsters" ? 151 : 150}
          onFocus={() => setTopPanel("monsters")}
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
              onUpdate={(update) =>
                send({
                  type: "token_update",
                  pageId: activeId,
                  id: token.id,
                  ...update,
                })
              }
              onRoll={handleMonsterRoll}
              onClose={() => setMonsterWindow(null)}
            />
          );
        })()}
      <DiceOverlay requests={privateRollRequests} onResult={handleDiceResult} />
    </div>
  );
}
