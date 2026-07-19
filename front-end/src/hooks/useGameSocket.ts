import { useEffect, useRef, useState } from "react";
import type { Monster } from "../types/monster";

export interface TokenData {
  id: string;
  url: string;
  x: number;
  y: number;
  color?: string;
  borderWidth?: number;
  statusEffects?: string[];
  name?: string;
  showName?: boolean;
  public?: boolean;
  monster?: string;
  hp?: number;
  wounds?: number;
}

export interface FogRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
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

export interface Page {
  id: string;
  name: string;
  mapUrl: string | null;
  mapSize: { width: number; height: number } | null;
  tokens: TokenData[];
  fogRects: FogRect[];
}

const API_BASE = "";

type OutgoingMsg =
  | {
      type: "map_set";
      pageId: string;
      url: string;
      width: number;
      height: number;
    }
  | { type: "map_resize"; pageId: string; width: number; height: number }
  | {
      type: "token_add";
      pageId: string;
      id: string;
      url: string;
      x: number;
      y: number;
      color?: string;
      borderWidth?: number;
      statusEffects?: string[];
    }
  | { type: "token_move"; pageId: string; id: string; x: number; y: number }
  | { type: "token_remove"; pageId: string; id: string }
  | {
      type: "token_update";
      pageId: string;
      id: string;
      color?: string;
      borderWidth?: number;
      name?: string;
      showName?: boolean;
      public?: boolean;
      monster?: string;
      hp?: number;
      wounds?: number;
    }
  | {
      type: "token_status";
      pageId: string;
      id: string;
      statusEffects: string[];
    }
  | {
      type: "fog_add";
      pageId: string;
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }
  | { type: "fog_remove"; pageId: string; id: string }
  | { type: "fog_clear"; pageId: string }
  | { type: "page_add"; id: string; name: string }
  | { type: "page_remove"; id: string }
  | { type: "page_rename"; id: string; name: string }
  | { type: "page_present"; id: string }
  | {
      type: "arrow_update";
      pageId: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    }
  | { type: "arrow_clear"; pageId: string }
  | {
      type: "radius_update";
      pageId: string;
      x: number;
      y: number;
      x2: number;
      y2: number;
    }
  | { type: "radius_clear"; pageId: string }
  | { type: "ping"; pageId: string; x: number; y: number }
  | {
      type: "viewport_sync";
      pageId: string;
      worldCenterX: number;
      worldCenterY: number;
      scale: number;
    }
  | { type: "dice_roll_request"; expression: string; clientId?: string; private?: boolean; playerName?: string; diceColor?: string; advMode?: "advantage" | "disadvantage"; label?: string }
  | {
      type: "dice_roll_result";
      expression: string;
      sides: number;
      rolls: number[];
      modifier: number;
      total: number;
      clientId?: string;
      private?: boolean;
      playerName?: string;
      diceColor?: string;
      label?: string;
    };

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
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(e.data as string) as Record<string, unknown>;
      } catch {
        console.warn("bad WS message", e.data);
        return;
      }

      switch (msg.type) {
        case "snapshot": {
          const raw = msg.pages as Array<{
            id: string;
            name: string;
            mapUrl: string;
            mapWidth: number;
            mapHeight: number;
            tokens: TokenData[];
            fogRects: FogRect[];
          }>;
          setPages(
            raw.map((p) => ({
              id: p.id,
              name: p.name,
              mapUrl: p.mapUrl || null,
              mapSize:
                p.mapWidth && p.mapHeight
                  ? { width: p.mapWidth, height: p.mapHeight }
                  : null,
              tokens: p.tokens ?? [],
              fogRects: p.fogRects ?? [],
            })),
          );
          presentedPageIdRef.current = msg.presentedPageId as string;
          setPresentedPageId(msg.presentedPageId as string);
          break;
        }

        case "map_set": {
          const pageId = msg.pageId as string;
          updatePage(pageId, (p) => ({
            ...p,
            mapUrl: msg.url as string,
            mapSize: {
              width: msg.width as number,
              height: msg.height as number,
            },
          }));
          break;
        }

        case "map_resize": {
          const pageId = msg.pageId as string;
          updatePage(pageId, (p) => ({
            ...p,
            mapSize: {
              width: msg.width as number,
              height: msg.height as number,
            },
          }));
          break;
        }

        case "token_add": {
          const pageId = msg.pageId as string;
          updatePage(pageId, (p) => ({
            ...p,
            tokens: [
              ...p.tokens,
              {
                id: msg.id as string,
                url: msg.url as string,
                x: msg.x as number,
                y: msg.y as number,
                ...(msg.color !== undefined && { color: msg.color as string }),
                ...(msg.borderWidth !== undefined && {
                  borderWidth: msg.borderWidth as number,
                }),
              },
            ],
          }));
          break;
        }

        case "token_move": {
          const pageId = msg.pageId as string;
          const id = msg.id as string;
          const x = msg.x as number;
          const y = msg.y as number;
          updatePage(pageId, (p) => {
            const idx = p.tokens.findIndex((t) => t.id === id);
            if (idx === -1) return p;
            const updated = { ...p.tokens[idx], x, y };
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

        case "token_remove": {
          const pageId = msg.pageId as string;
          updatePage(pageId, (p) => ({
            ...p,
            tokens: p.tokens.filter((t) => t.id !== msg.id),
          }));
          break;
        }

        case "token_update": {
          const pageId = msg.pageId as string;
          const id = msg.id as string;
          updatePage(pageId, (p) => ({
            ...p,
            tokens: p.tokens.map((t) => {
              if (t.id !== id) return t;
              const next = {
                ...t,
                ...(msg.color !== undefined && {
                  color: msg.color as string,
                }),
                ...(msg.borderWidth !== undefined && {
                  borderWidth: msg.borderWidth as number,
                }),
                ...(msg.name !== undefined && {
                  name: msg.name as string,
                }),
                ...(msg.showName !== undefined && {
                  showName: msg.showName as boolean,
                }),
                ...(msg.public !== undefined && {
                  public: msg.public as boolean,
                }),
                ...(msg.monster !== undefined && {
                  monster: msg.monster as string,
                }),
                ...(msg.hp !== undefined && { hp: msg.hp as number }),
                ...(msg.wounds !== undefined && {
                  wounds: msg.wounds as number,
                }),
              };
              // Unlinking clears the HP tracker (mirrors the server).
              if (msg.monster === "") {
                delete next.monster;
                delete next.hp;
                delete next.wounds;
              }
              return next;
            }),
          }));
          break;
        }

        case "token_status": {
          const pageId = msg.pageId as string;
          const id = msg.id as string;
          updatePage(pageId, (p) => ({
            ...p,
            tokens: p.tokens.map((t) =>
              t.id !== id
                ? t
                : { ...t, statusEffects: msg.statusEffects as string[] },
            ),
          }));
          break;
        }

        case "fog_add": {
          const pageId = msg.pageId as string;
          updatePage(pageId, (p) => ({
            ...p,
            fogRects: [
              ...p.fogRects,
              {
                id: msg.id as string,
                x: msg.x as number,
                y: msg.y as number,
                width: msg.width as number,
                height: msg.height as number,
              },
            ],
          }));
          break;
        }

        case "fog_remove": {
          const pageId = msg.pageId as string;
          updatePage(pageId, (p) => ({
            ...p,
            fogRects: p.fogRects.filter((r) => r.id !== msg.id),
          }));
          break;
        }

        case "fog_clear": {
          const pageId = msg.pageId as string;
          updatePage(pageId, (p) => ({ ...p, fogRects: [] }));
          break;
        }

        case "page_add": {
          const newPage: Page = {
            id: msg.id as string,
            name: msg.name as string,
            mapUrl: null,
            mapSize: null,
            tokens: [],
            fogRects: [],
          };
          setPages((prev) => [...prev, newPage]);
          break;
        }

        case "page_remove":
          setPages((prev) => prev.filter((p) => p.id !== msg.id));
          break;

        case "page_rename":
          updatePage(msg.id as string, (p) => ({
            ...p,
            name: msg.name as string,
          }));
          break;

        case "page_present":
          presentedPageIdRef.current = msg.id as string;
          setPresentedPageId(msg.id as string);
          break;

        case "arrow_update":
          if (msg.pageId === presentedPageIdRef.current)
            setArrowOverlay({
              x1: msg.x1 as number,
              y1: msg.y1 as number,
              x2: msg.x2 as number,
              y2: msg.y2 as number,
            });
          break;

        case "arrow_clear":
          if (msg.pageId === presentedPageIdRef.current) setArrowOverlay(null);
          break;

        case "radius_update":
          if (msg.pageId === presentedPageIdRef.current)
            setRadiusCircle({
              x: msg.x as number,
              y: msg.y as number,
              x2: msg.x2 as number,
              y2: msg.y2 as number,
            });
          break;

        case "radius_clear":
          if (msg.pageId === presentedPageIdRef.current) setRadiusCircle(null);
          break;

        case "ping":
          if (msg.pageId === presentedPageIdRef.current) {
            if (pingTimeoutRef.current) clearTimeout(pingTimeoutRef.current);
            setPing({ x: msg.x as number, y: msg.y as number });
            pingTimeoutRef.current = setTimeout(() => setPing(null), 2000);
          }
          break;

        case "viewport_sync":
          if (msg.pageId === presentedPageIdRef.current)
            setViewportSync({
              worldCenterX: msg.worldCenterX as number,
              worldCenterY: msg.worldCenterY as number,
              scale: msg.scale as number,
            });
          break;

        case "hello":
          setMyClientId(msg.clientId as string);
          break;

        case "dice_roll_request":
          setDiceRequests((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              expression: msg.expression as string,
              clientId: msg.clientId as string | undefined,
              playerName: msg.playerName as string | undefined,
              diceColor: msg.diceColor as string | undefined,
              advMode: msg.advMode as "advantage" | "disadvantage" | undefined,
              label: msg.label as string | undefined,
            },
          ]);
          break;

        case "dice_roll_result":
          setDiceResult({
            expression: msg.expression as string,
            sides: msg.sides as number,
            rolls: msg.rolls as number[],
            modifier: msg.modifier as number,
            total: msg.total as number,
            clientId: msg.clientId as string | undefined,
            private: msg.private as boolean | undefined,
            playerName: msg.playerName as string | undefined,
            diceColor: msg.diceColor as string | undefined,
            label: msg.label as string | undefined,
          });
          break;

        default:
          console.warn("unknown message type", msg.type);
      }
    };

    return () => ws.close();
  }, []);

  function send(msg: OutgoingMsg) {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
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

/** Fetch the aggregated monster list served from back-end/assets/monsters/. */
export async function fetchMonsters(): Promise<Monster[]> {
  const res = await fetch(`${API_BASE}/api/monsters`);
  if (!res.ok) throw new Error(`Failed to fetch monsters: ${res.statusText}`);
  return res.json() as Promise<Monster[]>;
}
