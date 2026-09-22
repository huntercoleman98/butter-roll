import { useEffect, useRef, useState } from "react";
import {
  create,
  fromJsonString,
  toJsonString,
  type MessageInitShape,
} from "@bufbuild/protobuf";
import { EnvelopeSchema, type Envelope, type Token } from "../gen/butterroll/v1/game_pb";
import { uuid } from "../utils/uuid";
import type { GearItem } from "../components/character";

// The token/message wire schema lives in proto/butterroll/v1/game.proto and is
// code-generated into ../gen. TokenData is re-exported from there so components
// keep a stable import site.
export type TokenData = Token;

// Client-side view model for a revealed fog polygon. Structurally compatible
// with the generated FogPoly (which also carries a $typeName tag).
export interface FogPoly {
  id: string;
  points: number[];
}

export interface ArrowOverlay {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Ping {
  x: number;
  y: number;
}

export interface RadiusCircle {
  x: number;
  y: number;
  x2: number;
  y2: number;
}

export interface DiceRequest {
  id: string;
  expression: string;
  clientId?: string;
  playerName?: string;
  diceColor?: string;
  advMode?: "advantage" | "disadvantage";
  label?: string;
}

export interface DiceRollResult {
  expression: string;
  sides: number;
  rolls: number[];
  modifier: number;
  total: number;
  private?: boolean;
  clientId?: string;
  playerName?: string;
  diceColor?: string;
  label?: string;
}

export interface ViewportSync {
  worldCenterX: number;
  worldCenterY: number;
  scale: number;
}

// A character record as tracked client-side: the opaque sheet blob plus the
// display name and token image mirrored from their join (see proto Character).
// A player (ownerPlayerId) owns a roster of these — one active (archived ==
// false) plus any retired sheets.
export interface CharacterRecord {
  characterId: string;
  ownerPlayerId: string;
  archived: boolean;
  data: string;
  name: string;
  tokenUrl: string;
  color: string;
}

// The room's shared coin pool (see proto PartyWallet). A standalone, freely
// editable pot separate from any character's personal coins.
export interface PartyWallet {
  gp: number;
  sp: number;
  cp: number;
}

// A party inventory item is a gear item that also knows its section (""=unsorted).
export interface PartyInvItem extends GearItem {
  sectionId: string;
}

// A flat, non-nestable bucket in the party inventory (see proto PartySection).
export interface PartySection {
  id: string;
  name: string;
}

export interface Page {
  id: string;
  name: string;
  mapUrl: string | null;
  mapSize: { width: number; height: number } | null;
  tokens: TokenData[];
  fogPolys: FogPoly[];
  tags: string[];
}

const API_BASE = "";

// The `payload` init of an Envelope — a discriminated union of every message
// type ({ case: "tokenMove", value: { pageId, id, x, y } }, etc.), generated
// from the proto oneof. This is the single source of truth for what send()
// accepts.
export type OutgoingPayload = NonNullable<
  MessageInitShape<typeof EnvelopeSchema>["payload"]
>;

export function useGameSocket() {
  const [pages, setPages] = useState<Page[]>([]);
  const [presentedPageId, setPresentedPageId] = useState<string | null>(null);
  const [arrowOverlay, setArrowOverlay] = useState<ArrowOverlay | null>(null);
  const [radiusCircle, setRadiusCircle] = useState<RadiusCircle | null>(null);
  const [ping, setPing] = useState<Ping | null>(null);
  const [viewportSync, setViewportSync] = useState<ViewportSync | null>(null);
  const [diceRequests, setDiceRequests] = useState<DiceRequest[]>([]);
  // The latest broadcast result, kept for one-shot reactions (useInitiative
  // matches an initiative roll back to its entry). diceLog is the accumulated
  // stream that the roll-history views derive from — see the comment there.
  const [diceResult, setDiceResult] = useState<DiceRollResult | null>(null);
  // Append-only log of every roll result seen, accumulated here (at the socket,
  // where results actually arrive) rather than re-accumulated by each consumer
  // in an effect. Holds broadcast results (public rolls resolved by the viewer,
  // plus players' private rolls) and, via appendDiceResult, the local-only
  // results a client resolves itself (the DM's private tower rolls, which never
  // broadcast) — so ordering stays true to arrival. Consumers filter/slice it:
  // the DM shows all of it, a player shows only their own (by clientId).
  const [diceLog, setDiceLog] = useState<DiceRollResult[]>([]);
  const [connected, setConnected] = useState(false);
  const [myClientId, setMyClientId] = useState<string | null>(null);
  // Character records keyed by characterId. Multiple may share an ownerPlayerId
  // (a player's roster); consumers group by ownerPlayerId and pick the active one.
  const [characters, setCharacters] = useState<Record<string, CharacterRecord>>(
    {},
  );
  // The room's shared party inventory: one ordered list every player reads and
  // writes. Stored as GearItem[] (field-compatible with the wire PartyItem) so
  // the same InventoryList UI renders it as a character's Gear section.
  const [partyInventory, setPartyInventory] = useState<PartyInvItem[]>([]);
  const [partySections, setPartySections] = useState<PartySection[]>([]);
  // The shared party coin pool. Defaults to all-zero until a snapshot arrives.
  const [partyWallet, setPartyWallet] = useState<PartyWallet>({
    gp: 0,
    sp: 0,
    cp: 0,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const pingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const presentedPageIdRef = useRef<string | null>(null);

  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${window.location.host}/api/ws`;
    // Auto-reconnect with capped exponential backoff. A dropped socket (a phone
    // sleeping, a wifi blip mid-session) would otherwise strand that client on a
    // dead connection until a manual reload. On reopen the server replays a fresh
    // snapshot and usePlayerProfile re-announces off the connected false→true
    // edge, so re-syncing is automatic and identity survives (anchored on the
    // durable playerId, not the per-connection clientId).
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    let unmounted = false;

    function updatePage(pageId: string, updater: (p: Page) => Page) {
      setPages((prev) => prev.map((p) => (p.id === pageId ? updater(p) : p)));
    }

    function handleMessage(e: MessageEvent) {
      let env: Envelope;
      try {
        env = fromJsonString(EnvelopeSchema, e.data as string);
      } catch {
        console.warn("bad WS message", e.data);
        return;
      }

      const payload = env.payload;
      switch (payload.case) {
        case "snapshot": {
          const s = payload.value;
          setPages(
            s.pages.map((p) => ({
              id: p.id,
              name: p.name,
              mapUrl: p.mapUrl || null,
              mapSize:
                p.mapWidth && p.mapHeight
                  ? { width: p.mapWidth, height: p.mapHeight }
                  : null,
              tokens: p.tokens,
              fogPolys: p.fogPolys,
              tags: p.tags,
            })),
          );
          presentedPageIdRef.current = s.presentedPageId;
          setPresentedPageId(s.presentedPageId);
          setPartyInventory(
            s.partyInventory.map((it) => ({
              id: it.id,
              name: it.name,
              qty: it.qty,
              slotsEach: it.slotsEach,
              sectionId: it.sectionId,
            })),
          );
          setPartySections(
            s.partySections.map((sec) => ({ id: sec.id, name: sec.name })),
          );
          setPartyWallet({
            gp: s.partyWallet?.gp ?? 0,
            sp: s.partyWallet?.sp ?? 0,
            cp: s.partyWallet?.cp ?? 0,
          });
          setCharacters(
            Object.fromEntries(
              s.characters.map((c) => [
                c.characterId,
                {
                  characterId: c.characterId,
                  ownerPlayerId: c.playerId,
                  archived: c.archived,
                  data: c.data,
                  name: c.name,
                  tokenUrl: c.tokenUrl,
                  color: c.color,
                },
              ]),
            ),
          );
          break;
        }

        case "mapSet": {
          const m = payload.value;
          updatePage(m.pageId, (p) => ({
            ...p,
            mapUrl: m.url,
            mapSize: { width: m.width, height: m.height },
          }));
          break;
        }

        case "mapResize": {
          const m = payload.value;
          updatePage(m.pageId, (p) => ({
            ...p,
            mapSize: { width: m.width, height: m.height },
          }));
          break;
        }

        case "tokenAdd": {
          const m = payload.value;
          if (!m.token) break;
          const token = m.token;
          updatePage(m.pageId, (p) => ({
            ...p,
            tokens: [...p.tokens, token],
          }));
          break;
        }

        case "tokenMove": {
          const m = payload.value;
          updatePage(m.pageId, (p) => {
            const idx = p.tokens.findIndex((t) => t.id === m.id);
            if (idx === -1) return p;
            // Move the token to the end so it renders on top.
            const updated = { ...p.tokens[idx], x: m.x, y: m.y };
            return {
              ...p,
              tokens: [
                ...p.tokens.slice(0, idx),
                ...p.tokens.slice(idx + 1),
                updated,
              ],
            };
          });
          break;
        }

        case "tokenMoveBatch": {
          const m = payload.value;
          const pos = new Map(m.moves.map((mv) => [mv.id, mv]));
          // Apply all moves in one state update so every token's new position
          // lands in the same render — moved tokens are appended together (in
          // their existing relative order) so they still render on top.
          updatePage(m.pageId, (p) => {
            const moved: TokenData[] = [];
            const rest: TokenData[] = [];
            for (const t of p.tokens) {
              const mv = pos.get(t.id);
              if (mv) moved.push({ ...t, x: mv.x, y: mv.y });
              else rest.push(t);
            }
            if (moved.length === 0) return p;
            return { ...p, tokens: [...rest, ...moved] };
          });
          break;
        }

        case "tokenRemove": {
          const m = payload.value;
          updatePage(m.pageId, (p) => ({
            ...p,
            tokens: p.tokens.filter((t) => t.id !== m.id),
          }));
          break;
        }

        case "tokenUpdate": {
          const m = payload.value;
          updatePage(m.pageId, (p) => ({
            ...p,
            tokens: p.tokens.map((t) => {
              if (t.id !== m.id) return t;
              const next: TokenData = { ...t };
              if (m.color !== undefined) next.color = m.color;
              if (m.borderWidth !== undefined) next.borderWidth = m.borderWidth;
              if (m.name !== undefined) next.name = m.name;
              if (m.showName !== undefined) next.showName = m.showName;
              if (m.public !== undefined) next.public = m.public;
              if (m.monster !== undefined) next.monster = m.monster;
              if (m.hp !== undefined) next.hp = m.hp;
              if (m.wounds !== undefined) next.wounds = m.wounds;
              if (m.pinned !== undefined) next.pinned = m.pinned;
              // Assign/clear a companion's controlling player ("" clears).
              if (m.ownerPlayerId !== undefined)
                next.ownerPlayerId = m.ownerPlayerId;
              // Unlinking clears the HP tracker (mirrors the server).
              if (m.monster === "") {
                next.monster = "";
                next.hp = undefined;
                next.wounds = undefined;
              }
              return next;
            }),
          }));
          break;
        }

        case "tokenStatus": {
          const m = payload.value;
          updatePage(m.pageId, (p) => ({
            ...p,
            tokens: p.tokens.map((t) =>
              t.id !== m.id ? t : { ...t, statusEffects: m.statusEffects },
            ),
          }));
          break;
        }

        case "tokenTags": {
          const m = payload.value;
          updatePage(m.pageId, (p) => ({
            ...p,
            tokens: p.tokens.map((t) =>
              t.id !== m.id ? t : { ...t, tags: m.tags },
            ),
          }));
          break;
        }

        case "fogAdd": {
          const m = payload.value;
          updatePage(m.pageId, (p) => ({
            ...p,
            fogPolys: [...p.fogPolys, { id: m.id, points: m.points }],
          }));
          break;
        }

        case "fogRemove": {
          const m = payload.value;
          updatePage(m.pageId, (p) => ({
            ...p,
            fogPolys: p.fogPolys.filter((r) => r.id !== m.id),
          }));
          break;
        }

        case "fogClear": {
          const m = payload.value;
          updatePage(m.pageId, (p) => ({ ...p, fogPolys: [] }));
          break;
        }

        case "pageAdd": {
          const m = payload.value;
          setPages((prev) => [
            ...prev,
            {
              id: m.id,
              name: m.name,
              mapUrl: null,
              mapSize: null,
              tokens: [],
              fogPolys: [],
              tags: [],
            },
          ]);
          break;
        }

        case "pageRemove":
          setPages((prev) => prev.filter((p) => p.id !== payload.value.id));
          break;

        case "pageRename": {
          const m = payload.value;
          updatePage(m.id, (p) => ({ ...p, name: m.name }));
          break;
        }

        case "pageTags": {
          const m = payload.value;
          updatePage(m.id, (p) => ({ ...p, tags: m.tags }));
          break;
        }

        case "pagePresent":
          presentedPageIdRef.current = payload.value.id;
          setPresentedPageId(payload.value.id);
          break;

        case "arrowUpdate": {
          const m = payload.value;
          if (m.pageId === presentedPageIdRef.current)
            setArrowOverlay({ x1: m.x1, y1: m.y1, x2: m.x2, y2: m.y2 });
          break;
        }

        case "arrowClear":
          if (payload.value.pageId === presentedPageIdRef.current)
            setArrowOverlay(null);
          break;

        case "radiusUpdate": {
          const m = payload.value;
          if (m.pageId === presentedPageIdRef.current)
            setRadiusCircle({ x: m.x, y: m.y, x2: m.x2, y2: m.y2 });
          break;
        }

        case "radiusClear":
          if (payload.value.pageId === presentedPageIdRef.current)
            setRadiusCircle(null);
          break;

        case "ping": {
          const m = payload.value;
          if (m.pageId === presentedPageIdRef.current) {
            if (pingTimeoutRef.current) clearTimeout(pingTimeoutRef.current);
            setPing({ x: m.x, y: m.y });
            pingTimeoutRef.current = setTimeout(() => setPing(null), 2000);
          }
          break;
        }

        case "viewportSync": {
          const m = payload.value;
          if (m.pageId === presentedPageIdRef.current)
            setViewportSync({
              worldCenterX: m.worldCenterX,
              worldCenterY: m.worldCenterY,
              scale: m.scale,
            });
          break;
        }

        case "hello":
          setMyClientId(payload.value.clientId);
          break;

        case "characterUpdate": {
          const m = payload.value;
          // A player's own sheet push carries only data (name/tokenUrl empty);
          // the join-driven update carries the identity. Keep whichever field a
          // message leaves blank, mirroring the server's merge.
          setCharacters((prev) => {
            const existing = prev[m.characterId];
            return {
              ...prev,
              [m.characterId]: {
                characterId: m.characterId,
                // A retired character is unassociated (mirrors the server, which
                // clears the owner on archive but rebroadcasts the raw message).
                ownerPlayerId: m.archived ? "" : m.playerId,
                archived: m.archived,
                data: m.data,
                name: m.name || existing?.name || "",
                tokenUrl: m.tokenUrl || existing?.tokenUrl || "",
                color: m.color || existing?.color || "",
              },
            };
          });
          break;
        }

        case "playerRemove": {
          const { playerId } = payload.value;
          setPages((prev) =>
            prev.map((p) => ({
              ...p,
              tokens: p.tokens.filter((t) => t.ownerPlayerId !== playerId),
            })),
          );
          // Drop the player's entire roster (every character they own).
          setCharacters((prev) =>
            Object.fromEntries(
              Object.entries(prev).filter(
                ([, ch]) => ch.ownerPlayerId !== playerId,
              ),
            ),
          );
          break;
        }

        case "partyItemAdd": {
          const it = payload.value.item;
          if (!it) break;
          setPartyInventory((prev) => [
            ...prev,
            {
              id: it.id,
              name: it.name,
              qty: it.qty,
              slotsEach: it.slotsEach,
              sectionId: it.sectionId,
            },
          ]);
          break;
        }

        case "partyItemUpdate": {
          const m = payload.value;
          setPartyInventory((prev) =>
            prev.map((it) => {
              if (it.id !== m.id) return it;
              const next: PartyInvItem = { ...it };
              if (m.name !== undefined) next.name = m.name;
              if (m.qty !== undefined) next.qty = m.qty;
              if (m.slotsEach !== undefined) next.slotsEach = m.slotsEach;
              if (m.sectionId !== undefined) next.sectionId = m.sectionId;
              return next;
            }),
          );
          break;
        }

        case "partyItemRemove": {
          const { id } = payload.value;
          setPartyInventory((prev) => prev.filter((it) => it.id !== id));
          break;
        }

        case "partyItemReorder": {
          const { ids } = payload.value;
          setPartyInventory((prev) => {
            const byId = new Map(prev.map((it) => [it.id, it]));
            const seen = new Set<string>();
            const next: PartyInvItem[] = [];
            for (const id of ids) {
              const it = byId.get(id);
              if (it && !seen.has(id)) {
                next.push(it);
                seen.add(id);
              }
            }
            // Keep any current item the message omitted (racing add safety).
            for (const it of prev) if (!seen.has(it.id)) next.push(it);
            return next;
          });
          break;
        }

        case "partyWallet": {
          const m = payload.value;
          setPartyWallet({ gp: m.gp, sp: m.sp, cp: m.cp });
          break;
        }

        case "partySectionAdd": {
          const sec = payload.value.section;
          if (!sec) break;
          setPartySections((prev) => [...prev, { id: sec.id, name: sec.name }]);
          break;
        }

        case "partySectionRename": {
          const m = payload.value;
          setPartySections((prev) =>
            prev.map((sec) =>
              sec.id === m.id ? { ...sec, name: m.name } : sec,
            ),
          );
          break;
        }

        case "partySectionRemove": {
          const { id } = payload.value;
          setPartySections((prev) => prev.filter((sec) => sec.id !== id));
          // Orphan the section's items back to unsorted (mirrors the server).
          setPartyInventory((prev) =>
            prev.map((it) =>
              it.sectionId === id ? { ...it, sectionId: "" } : it,
            ),
          );
          break;
        }

        case "partySectionReorder": {
          const { ids } = payload.value;
          setPartySections((prev) => {
            const byId = new Map(prev.map((sec) => [sec.id, sec]));
            const seen = new Set<string>();
            const next: PartySection[] = [];
            for (const id of ids) {
              const sec = byId.get(id);
              if (sec && !seen.has(id)) {
                next.push(sec);
                seen.add(id);
              }
            }
            for (const sec of prev) if (!seen.has(sec.id)) next.push(sec);
            return next;
          });
          break;
        }

        case "diceRollRequest": {
          const m = payload.value;
          setDiceRequests((prev) => [
            ...prev,
            {
              id: uuid(),
              expression: m.expression,
              clientId: m.clientId || undefined,
              playerName: m.playerName || undefined,
              diceColor: m.diceColor || undefined,
              advMode: m.advMode as "advantage" | "disadvantage" | undefined,
              label: m.label || undefined,
            },
          ]);
          break;
        }

        case "diceRollResult": {
          const m = payload.value;
          const result: DiceRollResult = {
            expression: m.expression,
            sides: m.sides,
            rolls: m.rolls,
            modifier: m.modifier,
            total: m.total,
            clientId: m.clientId || undefined,
            private: m.private,
            playerName: m.playerName || undefined,
            diceColor: m.diceColor || undefined,
            label: m.label || undefined,
          };
          setDiceResult(result);
          setDiceLog((prev) => [...prev, result]);
          break;
        }

        case "initiativeStart":
        case "initiativeEnd":
          // Server-side rule trigger only; nothing for clients to render.
          break;
        default:
          console.warn("unknown message case", payload.case);
      }
    }

    function connect() {
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen = () => {
        attempts = 0;
        setConnected(true);
      };
      ws.onclose = () => {
        setConnected(false);
        if (unmounted) return;
        // 1s, 2s, 4s … capped at 15s.
        const delay = Math.min(1000 * 2 ** attempts, 15000);
        attempts += 1;
        reconnectTimer = setTimeout(connect, delay);
      };
      ws.onerror = (e) => console.error("WebSocket error", e);
      ws.onmessage = handleMessage;
    }

    connect();

    return () => {
      unmounted = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, []);

  function send(payload: OutgoingPayload) {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(toJsonString(EnvelopeSchema, create(EnvelopeSchema, { payload })));
    }
  }

  // Record a result this client resolved locally without broadcasting it (the
  // DM's private tower rolls). Public and player-private rolls already reach
  // diceLog via the diceRollResult message; this keeps the local-only ones in
  // the same ordered stream.
  function appendDiceResult(result: DiceRollResult) {
    setDiceLog((prev) => [...prev, result]);
  }

  return {
    pages,
    presentedPageId,
    arrowOverlay,
    radiusCircle,
    ping,
    viewportSync,
    diceRequests,
    diceResult,
    diceLog,
    appendDiceResult,
    connected,
    myClientId,
    characters,
    partyInventory,
    partySections,
    partyWallet,
    send,
  };
}


// ── Asset library (organizational layer over a flat asset store) ──────────────
// The same folder/upload/rearrange machinery backs both the token store and the
// map store; the two differ only by their REST base path (see AssetLibraryApi).

/** A named, nestable folder. parentId "" means it lives at the root. */
export interface AssetFolder {
  id: string;
  name: string;
  parentId: string;
}

/** An image asset plus its display name and folder. folderId "" = root. */
export interface Asset {
  url: string;
  name: string;
  folderId: string;
}

export interface AssetLibrary {
  folders: AssetFolder[];
  // Kept named `tokens` to match the server's JSON (and the original token-only
  // shape); holds map assets for the map library.
  tokens: Asset[];
}

// Back-compat aliases (tokens were the original and only consumer).
export type TokenFolder = AssetFolder;
export type TokenAsset = Asset;
export type TokenLibrary = AssetLibrary;

/**
 * The four REST operations a library browser needs, bound to one asset store's
 * base path (e.g. "/api/assets/tokens"). `tokenLibraryApi` and `mapLibraryApi`
 * below are the two concrete stores.
 */
export interface AssetLibraryApi {
  fetch: () => Promise<AssetLibrary>;
  save: (lib: AssetLibrary) => Promise<AssetLibrary>;
  upload: (file: File) => Promise<string>;
  remove: (url: string) => Promise<void>;
}

// Build an AssetLibraryApi over a store's base path. Delete/save use a plain
// body to stay CORS "simple requests" (no preflight), matching the upload flow.
function makeAssetLibraryApi(base: string): AssetLibraryApi {
  return {
    async fetch() {
      const res = await fetch(`${API_BASE}${base}/library`);
      if (!res.ok) throw new Error(`Failed to fetch library: ${res.statusText}`);
      return res.json() as Promise<AssetLibrary>;
    },
    async save(lib) {
      const res = await fetch(`${API_BASE}${base}/library`, {
        method: "POST",
        body: JSON.stringify(lib),
      });
      if (!res.ok) throw new Error(`Failed to save library: ${res.statusText}`);
      return res.json() as Promise<AssetLibrary>;
    },
    async upload(file) {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API_BASE}${base}`, { method: "POST", body: form });
      if (!res.ok) throw new Error(`Asset upload failed: ${res.statusText}`);
      const data = (await res.json()) as { url: string };
      return data.url;
    },
    async remove(url) {
      const res = await fetch(`${API_BASE}${base}/delete`, {
        method: "POST",
        body: JSON.stringify({ url }),
      });
      if (!res.ok) throw new Error(`Failed to delete asset: ${res.statusText}`);
    },
  };
}

export const tokenLibraryApi = makeAssetLibraryApi("/api/assets/tokens");
export const mapLibraryApi = makeAssetLibraryApi("/api/assets/maps");

/** Fetch the aggregated monster list served from back-end/assets/monsters/. */
export async function fetchMonsters(): Promise<import("../types/monster").Monster[]> {
  const res = await fetch(`${API_BASE}/api/monsters`);
  if (!res.ok) throw new Error(`Failed to fetch monsters: ${res.statusText}`);
  return res.json() as Promise<import("../types/monster").Monster[]>;
}

/** Fetch the room's behavior config (rules) served by GET /api/config. */
export async function fetchConfig(): Promise<import("../types/config").Config> {
  const res = await fetch(`${API_BASE}/api/config`);
  if (!res.ok) throw new Error(`Failed to fetch config: ${res.statusText}`);
  return res.json() as Promise<import("../types/config").Config>;
}
