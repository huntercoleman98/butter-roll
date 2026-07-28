import { useEffect, useRef, useState } from "react";
import {
  create,
  fromJsonString,
  toJsonString,
  type MessageInitShape,
} from "@bufbuild/protobuf";
import { EnvelopeSchema, type Envelope, type Token } from "../gen/butterroll/v1/game_pb";
import { uuid } from "../utils/uuid";

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

// A player's record as tracked client-side: the opaque sheet blob plus the
// display name and token image mirrored from their join (see proto Character).
export interface CharacterRecord {
  data: string;
  name: string;
  tokenUrl: string;
  color: string;
}

export interface Page {
  id: string;
  name: string;
  mapUrl: string | null;
  mapSize: { width: number; height: number } | null;
  tokens: TokenData[];
  fogPolys: FogPoly[];
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
  const [diceResult, setDiceResult] = useState<DiceRollResult | null>(null);
  const [connected, setConnected] = useState(false);
  const [myClientId, setMyClientId] = useState<string | null>(null);
  // Player records keyed by playerId (owner_player_id): sheet blob + name + token.
  const [characters, setCharacters] = useState<Record<string, CharacterRecord>>(
    {},
  );

  const wsRef = useRef<WebSocket | null>(null);
  const pingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const presentedPageIdRef = useRef<string | null>(null);

  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${window.location.host}/api/ws`);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = (e) => console.error("WebSocket error", e);

    function updatePage(pageId: string, updater: (p: Page) => Page) {
      setPages((prev) => prev.map((p) => (p.id === pageId ? updater(p) : p)));
    }

    ws.onmessage = (e: MessageEvent) => {
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
            })),
          );
          presentedPageIdRef.current = s.presentedPageId;
          setPresentedPageId(s.presentedPageId);
          setCharacters(
            Object.fromEntries(
              s.characters.map((c) => [
                c.playerId,
                {
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
            const existing = prev[m.playerId];
            return {
              ...prev,
              [m.playerId]: {
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
          setCharacters((prev) => {
            const next = { ...prev };
            delete next[playerId];
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
          setDiceResult({
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
          });
          break;
        }

        default:
          console.warn("unknown message case", payload.case);
      }
    };

    return () => ws.close();
  }, []);

  function send(payload: OutgoingPayload) {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(toJsonString(EnvelopeSchema, create(EnvelopeSchema, { payload })));
    }
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
    connected,
    myClientId,
    characters,
    send,
  };
}

/** Upload a file to the server's asset store. Returns the absolute URL. */
export async function uploadAsset(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/api/assets`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(`Asset upload failed: ${res.statusText}`);
  const data = (await res.json()) as { url: string };
  return data.url;
}

/** Upload a file to the token asset store. Returns the absolute URL. */
export async function uploadTokenAsset(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/api/assets/tokens`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(`Token upload failed: ${res.statusText}`);
  const data = (await res.json()) as { url: string };
  return data.url;
}

/** Fetch the list of all uploaded token asset URLs. */
export async function fetchTokenAssets(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/assets/tokens`);
  if (!res.ok) throw new Error(`Failed to fetch tokens: ${res.statusText}`);
  return res.json() as Promise<string[]>;
}

// ── Token library (organizational layer over the flat token store) ────────────

/** A named, nestable folder. parentId "" means it lives at the root. */
export interface TokenFolder {
  id: string;
  name: string;
  parentId: string;
}

/** A token image plus its display name and folder. folderId "" = root. */
export interface TokenAsset {
  url: string;
  name: string;
  folderId: string;
}

export interface TokenLibrary {
  folders: TokenFolder[];
  tokens: TokenAsset[];
}

/** Delete a token image file. The library reconciles the removal on next read. */
export async function deleteTokenAsset(url: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/assets/tokens/delete`, {
    method: "POST",
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error(`Failed to delete token: ${res.statusText}`);
}

/** Fetch the token library, reconciled server-side against files on disk. */
export async function fetchTokenLibrary(): Promise<TokenLibrary> {
  const res = await fetch(`${API_BASE}/api/assets/tokens/library`);
  if (!res.ok) throw new Error(`Failed to fetch token library: ${res.statusText}`);
  return res.json() as Promise<TokenLibrary>;
}

/**
 * Persist the token library. Sent as a POST with a plain-text body so it stays
 * a CORS "simple request" (no preflight), matching the upload endpoints. The
 * server returns the reconciled library.
 */
export async function saveTokenLibrary(lib: TokenLibrary): Promise<TokenLibrary> {
  const res = await fetch(`${API_BASE}/api/assets/tokens/library`, {
    method: "POST",
    body: JSON.stringify(lib),
  });
  if (!res.ok) throw new Error(`Failed to save token library: ${res.statusText}`);
  return res.json() as Promise<TokenLibrary>;
}

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
