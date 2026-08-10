import { useRef, useState } from "react";
import {
  GiTrashCan,
  GiSheikahEye,
  GiSightDisabled,
  GiSwordClash,
  GiPin,
} from "react-icons/gi";
import type { TokenData } from "../../../hooks/useGameSocket";
import {
  STATUS_EFFECTS,
  STATUS_EFFECT_MAP,
} from "../../../constants/statusEffects";
import { filterMonsters, parseMaxHp, type Monster } from "../../../types/monster";
import { startDrag } from "../canvasMath";
import { useOutsideClick } from "../../../hooks/useOutsideClick";
import TagEditor from "../../TagEditor";

interface TokenContextMenuProps {
  x: number;
  y: number;
  tokenId: string;
  tokens: TokenData[];
  selectedTokenIds?: Set<string>;
  monsters: Monster[];
  onClose: () => void;
  onUpdateToken?: (
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
  ) => void;
  onUpdateTokenStatus?: (
    ids: Set<string>,
    action: "add" | "remove",
    effectId: string,
  ) => void;
  // Add/remove a tag across the affected selection (mirrors onUpdateTokenStatus).
  // The menu shows only tags shared by every selected token.
  onUpdateTokenTags?: (
    ids: Set<string>,
    action: "add" | "remove",
    tag: string,
  ) => void;
  onDeleteTokens?: (ids: Set<string>) => void;
  onAddToInitiative?: (tokenIds: Set<string>) => void;
}

function effectSelectText(effects: Set<string>): string {
  if (effects.size === 0) return "None selected";
  if (effects.size < 3)
    return [...effects].map((id) => STATUS_EFFECT_MAP.get(id)?.label).join(", ");
  return `${effects.size} effects selected`;
}

// Derives the shared/mixed seed values across the affected selection. Mixed
// fields come back null so the inputs render blank until edited.
function computeSeed(
  tokens: TokenData[],
  affectedIds: Set<string>,
  clickedId: string,
) {
  const affected = tokens.filter((t) => affectedIds.has(t.id));
  const firstColor = affected[0]?.color ?? "#c084fc";
  const sharedColor = affected.every((t) => (t.color ?? "#c084fc") === firstColor)
    ? firstColor
    : null;
  const firstBW = affected[0]?.borderWidth ?? 4;
  const sharedBW = affected.every((t) => (t.borderWidth ?? 4) === firstBW)
    ? firstBW
    : null;
  const firstEffects = new Set(affected[0]?.statusEffects ?? []);
  const sharedStatuses = new Set(
    [...firstEffects].filter((e) =>
      affected.every((t) => t.statusEffects?.includes(e)),
    ),
  );
  const firstMonster = affected[0]?.monster ?? "";
  const sharedMonster = affected.every((t) => (t.monster ?? "") === firstMonster)
    ? firstMonster
    : null;
  const clickedToken = tokens.find((t) => t.id === clickedId);
  return {
    color: sharedColor,
    borderWidth: sharedBW,
    statuses: sharedStatuses,
    monster: sharedMonster,
    name: clickedToken?.name ?? "",
    showName: clickedToken?.showName ?? false,
    public: clickedToken?.public ?? false,
  };
}

// sharedTagsOf returns the tags common to every token in ids (their intersection),
// so a multi-selection shows only tags all of them have. Derived from the live
// tokens prop each render, so it reflects add/remove echoes.
function sharedTagsOf(tokens: TokenData[], ids: Set<string>): string[] {
  const affected = tokens.filter((t) => ids.has(t.id));
  if (affected.length === 0) return [];
  return (affected[0].tags ?? []).filter((tag) =>
    affected.every((t) => t.tags?.includes(tag)),
  );
}

// Self-contained token panel: name, visibility, color/border, status effects,
// and monster linking. Mount it with `key={tokenId}` so its seed state resets
// when the menu opens on a different token.
export function TokenContextMenu({
  x,
  y,
  tokenId,
  tokens,
  selectedTokenIds,
  monsters,
  onClose,
  onUpdateToken,
  onUpdateTokenStatus,
  onUpdateTokenTags,
  onDeleteTokens,
  onAddToInitiative,
}: TokenContextMenuProps) {
  function affectedIds(): Set<string> {
    return selectedTokenIds?.has(tokenId)
      ? selectedTokenIds
      : new Set([tokenId]);
  }

  // Compute the seed once at mount (the component is keyed on tokenId, so it
  // remounts — and reseeds — whenever the menu opens on a different token).
  const [seed] = useState(() => computeSeed(tokens, affectedIds(), tokenId));

  const [menuColor, setMenuColor] = useState<string | null>(seed.color);
  const [menuBorderWidth, setMenuBorderWidth] = useState<number | null>(
    seed.borderWidth,
  );
  const [menuName, setMenuName] = useState(seed.name);
  const [menuShowName, setMenuShowName] = useState(seed.showName);
  const [menuPublic, setMenuPublic] = useState(seed.public);
  // Whether the clicked token is pinned to the DM top bar. Only meaningful for a
  // single non-player token (see the pin control in the title bar).
  const [menuPinned, setMenuPinned] = useState(
    () => tokens.find((t) => t.id === tokenId)?.pinned ?? false,
  );
  const [menuSharedStatuses, setMenuSharedStatuses] = useState<Set<string>>(
    seed.statuses,
  );
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  // Shared monster of the affected tokens: "" = none linked, null = mixed.
  const [menuMonster, setMenuMonster] = useState<string | null>(seed.monster);
  const [monsterDropdownOpen, setMonsterDropdownOpen] = useState(false);
  const [monsterFilter, setMonsterFilter] = useState("");
  const [menuOffset, setMenuOffset] = useState({ x: 0, y: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const statusDropdownRef = useRef<HTMLDivElement>(null);
  const monsterDropdownRef = useRef<HTMLDivElement>(null);
  const updateDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nameDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useOutsideClick(containerRef, onClose);
  useOutsideClick(
    statusDropdownRef,
    () => setStatusDropdownOpen(false),
    statusDropdownOpen,
  );
  useOutsideClick(
    monsterDropdownRef,
    () => setMonsterDropdownOpen(false),
    monsterDropdownOpen,
  );

  function scheduleUpdate(
    ids: Set<string>,
    update: { color?: string; borderWidth?: number },
  ) {
    if (updateDebounceRef.current) clearTimeout(updateDebounceRef.current);
    updateDebounceRef.current = setTimeout(
      () => onUpdateToken?.(ids, update),
      300,
    );
  }

  function scheduleNameUpdate(ids: Set<string>, name: string, showName: boolean) {
    if (nameDebounceRef.current) clearTimeout(nameDebounceRef.current);
    nameDebounceRef.current = setTimeout(
      () => onUpdateToken?.(ids, { name, showName }),
      500,
    );
  }

  function handleDelete() {
    onDeleteTokens?.(affectedIds());
    onClose();
  }

  function handleLinkMonster(m: Monster) {
    onUpdateToken?.(affectedIds(), {
      monster: m.name,
      hp: parseMaxHp(m.hp),
      wounds: 0,
    });
    setMenuMonster(m.name);
    setMonsterDropdownOpen(false);
    setMonsterFilter("");
  }

  function handleUnlinkMonster() {
    onUpdateToken?.(affectedIds(), { monster: "" });
    setMenuMonster("");
  }

  const multiSelected = affectedIds().size > 1;
  // A player's character token is backed by their sheet, not a monster stat
  // block, so monster linking is disabled for it.
  const isPlayerToken = tokens.some((t) => affectedIds().has(t.id) && t.player);

  return (
    <div
      ref={containerRef}
      className="window context-menu"
      style={{
        position: "fixed",
        left: x + menuOffset.x,
        top: y + menuOffset.y,
        zIndex: 1000,
      }}
    >
      <div
        className="title-bar"
        style={{ cursor: "move" }}
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          const startX = e.clientX - menuOffset.x;
          const startY = e.clientY - menuOffset.y;
          startDrag(
            (ev) =>
              setMenuOffset({
                x: ev.clientX - startX,
                y: ev.clientY - startY,
              }),
            () => {},
          );
        }}
      >
        <div className="title-bar-text">Token</div>
        <div className="title-bar-controls">
          {/* Pin to the DM top bar. Only a single non-player (DM/NPC) token can
              be pinned; the icon never changes — a pinned button just renders
              pressed-in. */}
          {!multiSelected && !isPlayerToken && (
            <button
              className={`title-bar-pin${menuPinned ? " pinned" : ""}`}
              title={menuPinned ? "Unpin from top bar" : "Pin to top bar"}
              aria-pressed={menuPinned}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => {
                const next = !menuPinned;
                setMenuPinned(next);
                onUpdateToken?.(new Set([tokenId]), { pinned: next });
              }}
            >
              <GiPin />
            </button>
          )}
          <button aria-label="Close" onClick={onClose} />
        </div>
      </div>
      <div className="window-body">
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 4,
            marginBottom: 4,
          }}
        >
          <button
            className="icon-btn"
            title={
              menuPublic
                ? "Public — visible to players"
                : "Private — hidden from players"
            }
            onClick={() => {
              const next = !menuPublic;
              setMenuPublic(next);
              onUpdateToken?.(affectedIds(), { public: next });
            }}
          >
            {menuPublic ? <GiSheikahEye /> : <GiSightDisabled />}
          </button>
          {onAddToInitiative && (
            <button
              className="icon-btn"
              title="Add to initiative"
              onClick={() => {
                onAddToInitiative(affectedIds());
                onClose();
              }}
            >
              <GiSwordClash />
            </button>
          )}
          <button onClick={handleDelete} title="Delete" className="icon-btn">
            <GiTrashCan />
          </button>
        </div>
        <div className="context-menu-fields">
          <label>Name</label>
          <input
            type="text"
            value={multiSelected ? "--" : menuName}
            placeholder="Token name"
            // A player token's name is driven by the player's character name, so
            // it's read-only here.
            disabled={multiSelected || isPlayerToken}
            title={isPlayerToken ? "Set by the player's character name" : undefined}
            onChange={(e) => {
              setMenuName(e.target.value);
              scheduleNameUpdate(new Set([tokenId]), e.target.value, menuShowName);
            }}
          />
          <span />
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              id="ctx-show-name"
              checked={menuShowName}
              onChange={(e) => {
                setMenuShowName(e.target.checked);
                scheduleNameUpdate(affectedIds(), menuName, e.target.checked);
              }}
            />
            <label htmlFor="ctx-show-name" style={{ cursor: "pointer" }}>
              Display name
            </label>
          </div>
          <label>Border color</label>
          <input
            type="color"
            value={menuColor ?? "#808080"}
            // A player token's border color is driven by the player's chosen
            // color, so it's read-only here.
            disabled={isPlayerToken}
            title={isPlayerToken ? "Set by the player's color" : undefined}
            onChange={(e) => {
              setMenuColor(e.target.value);
              scheduleUpdate(affectedIds(), { color: e.target.value });
            }}
          />
          <label>Border width</label>
          <input
            type="number"
            value={menuBorderWidth !== null ? menuBorderWidth : ""}
            placeholder="—"
            min={0}
            onChange={(e) => {
              const v = e.target.value === "" ? null : Number(e.target.value);
              setMenuBorderWidth(v);
              if (v !== null) scheduleUpdate(affectedIds(), { borderWidth: v });
            }}
          />
          <label style={{ marginTop: 6 }}>Status effects</label>
          <div ref={statusDropdownRef} style={{ position: "relative", minWidth: 150 }}>
            <button
              style={{
                width: "100%",
                textAlign: "left",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              onClick={() => setStatusDropdownOpen((v) => !v)}
            >
              {effectSelectText(menuSharedStatuses)} ▾
            </button>
            {statusDropdownOpen && (
              <div
                className="window"
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  right: 0,
                  zIndex: 10,
                  margin: 0,
                }}
              >
                <ul
                  className="tree-view"
                  style={{ margin: 0, maxHeight: 120, overflowY: "auto" }}
                >
                  {STATUS_EFFECTS.map((effect) => {
                    const checked = menuSharedStatuses.has(effect.id);
                    return (
                      <li
                        key={effect.id}
                        className={checked ? "active" : ""}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          cursor: "pointer",
                          userSelect: "none",
                        }}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          const ids = affectedIds();
                          const next = new Set(menuSharedStatuses);
                          if (checked) next.delete(effect.id);
                          else next.add(effect.id);
                          setMenuSharedStatuses(next);
                          onUpdateTokenStatus?.(
                            ids,
                            checked ? "remove" : "add",
                            effect.id,
                          );
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {}}
                          tabIndex={-1}
                        />
                        {effect.label}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
          {onUpdateTokenTags && (
            <>
              <label style={{ marginTop: 6 }}>Tags</label>
              <TagEditor
                tags={sharedTagsOf(tokens, affectedIds())}
                onAdd={(tag) => onUpdateTokenTags(affectedIds(), "add", tag)}
                onRemove={(tag) => onUpdateTokenTags(affectedIds(), "remove", tag)}
              />
            </>
          )}
          <label style={{ marginTop: 6 }}>Monster</label>
          {isPlayerToken ? (
            <button
              disabled
              style={{
                width: "100%",
                textAlign: "left",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              Player Character
            </button>
          ) : menuMonster === "" ? (
            <div
              ref={monsterDropdownRef}
              style={{ position: "relative", minWidth: 150 }}
            >
              <button
                style={{
                  width: "100%",
                  textAlign: "left",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                onClick={() => setMonsterDropdownOpen((v) => !v)}
              >
                Link monster… ▾
              </button>
              {monsterDropdownOpen && (
                <div
                  className="window"
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    right: 0,
                    zIndex: 10,
                    margin: 0,
                    padding: 4,
                  }}
                >
                  <input
                    type="text"
                    className="monsters-filter"
                    autoFocus
                    placeholder="Filter by name or level…"
                    value={monsterFilter}
                    onChange={(e) => setMonsterFilter(e.target.value)}
                  />
                  <div className="monsters-scroll" style={{ maxHeight: 160 }}>
                    {monsters.length === 0 ? (
                      <div className="monsters-empty">No monsters found.</div>
                    ) : (
                      filterMonsters(monsters, monsterFilter).map((m) => (
                        <div
                          key={m.name}
                          className="monsters-row"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            handleLinkMonster(m);
                          }}
                        >
                          <span className="monsters-row-name">{m.name}</span>
                          <span className="monsters-row-level">LV {m.level}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                minWidth: 0,
              }}
            >
              <span
                style={{
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {menuMonster ?? "--"}
              </span>
              <button onClick={handleUnlinkMonster}>Unlink</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
