import { useEffect, useRef, useState } from 'react'

export interface TokenData {
  id: string
  url: string
  x: number
  y: number
  color?: string
  borderWidth?: number
}

export interface FogRect {
  id: string
  x: number
  y: number
  width: number
  height: number
}

export interface MeasureArrow {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface Page {
  id: string
  name: string
  mapUrl: string | null
  mapSize: { width: number; height: number } | null
  tokens: TokenData[]
  fogRects: FogRect[]
}

export const SERVER_URL = 'http://localhost:8080'

type OutgoingMsg =
  | { type: 'map_set'; pageId: string; url: string; width: number; height: number }
  | { type: 'map_resize'; pageId: string; width: number; height: number }
  | { type: 'token_add'; pageId: string; id: string; url: string; x: number; y: number; color?: string; borderWidth?: number }
  | { type: 'token_move'; pageId: string; id: string; x: number; y: number }
  | { type: 'token_remove'; pageId: string; id: string }
  | { type: 'token_update'; pageId: string; id: string; color?: string; borderWidth?: number }
  | { type: 'fog_add'; pageId: string; id: string; x: number; y: number; width: number; height: number }
  | { type: 'fog_remove'; pageId: string; id: string }
  | { type: 'fog_clear'; pageId: string }
  | { type: 'page_add'; id: string; name: string }
  | { type: 'page_remove'; id: string }
  | { type: 'page_rename'; id: string; name: string }
  | { type: 'page_present'; id: string }
  | { type: 'measure_update'; x1: number; y1: number; x2: number; y2: number }
  | { type: 'measure_clear' }

export function useGameSocket() {
  const [pages, setPages] = useState<Page[]>([])
  const [presentedPageId, setPresentedPageId] = useState<string | null>(null)
  const [measureArrow, setMeasureArrow] = useState<MeasureArrow | null>(null)
  const [connected, setConnected] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    const ws = new WebSocket(`ws://localhost:8080/ws`)
    wsRef.current = ws

    ws.onopen = () => setConnected(true)
    ws.onclose = () => setConnected(false)
    ws.onerror = (e) => console.error('WebSocket error', e)

    function updatePage(pageId: string, updater: (p: Page) => Page) {
      setPages(prev => prev.map(p => p.id === pageId ? updater(p) : p))
    }

    ws.onmessage = (e: MessageEvent) => {
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(e.data as string) as Record<string, unknown>
      } catch {
        console.warn('bad WS message', e.data)
        return
      }

      switch (msg.type) {
        case 'snapshot': {
          const raw = msg.pages as Array<{
            id: string; name: string; mapUrl: string
            mapWidth: number; mapHeight: number
            tokens: TokenData[]; fogRects: FogRect[]
          }>
          setPages(raw.map(p => ({
            id: p.id,
            name: p.name,
            mapUrl: p.mapUrl || null,
            mapSize: p.mapWidth && p.mapHeight ? { width: p.mapWidth, height: p.mapHeight } : null,
            tokens: p.tokens ?? [],
            fogRects: p.fogRects ?? [],
          })))
          setPresentedPageId(msg.presentedPageId as string)
          break
        }

        case 'map_set': {
          const pageId = msg.pageId as string
          updatePage(pageId, p => ({
            ...p,
            mapUrl: msg.url as string,
            mapSize: { width: msg.width as number, height: msg.height as number },
          }))
          break
        }

        case 'map_resize': {
          const pageId = msg.pageId as string
          updatePage(pageId, p => ({
            ...p,
            mapSize: { width: msg.width as number, height: msg.height as number },
          }))
          break
        }

        case 'token_add': {
          const pageId = msg.pageId as string
          updatePage(pageId, p => ({
            ...p,
            tokens: [...p.tokens, {
              id: msg.id as string,
              url: msg.url as string,
              x: msg.x as number,
              y: msg.y as number,
              ...(msg.color !== undefined && { color: msg.color as string }),
              ...(msg.borderWidth !== undefined && { borderWidth: msg.borderWidth as number }),
            }],
          }))
          break
        }

        case 'token_move': {
          const pageId = msg.pageId as string
          const id = msg.id as string
          const x = msg.x as number
          const y = msg.y as number
          updatePage(pageId, p => {
            const idx = p.tokens.findIndex(t => t.id === id)
            if (idx === -1) return p
            const updated = { ...p.tokens[idx], x, y }
            return { ...p, tokens: [...p.tokens.slice(0, idx), ...p.tokens.slice(idx + 1), updated] }
          })
          break
        }

        case 'token_remove': {
          const pageId = msg.pageId as string
          updatePage(pageId, p => ({ ...p, tokens: p.tokens.filter(t => t.id !== msg.id) }))
          break
        }

        case 'token_update': {
          const pageId = msg.pageId as string
          const id = msg.id as string
          updatePage(pageId, p => ({
            ...p,
            tokens: p.tokens.map(t => t.id !== id ? t : {
              ...t,
              ...(msg.color !== undefined && { color: msg.color as string }),
              ...(msg.borderWidth !== undefined && { borderWidth: msg.borderWidth as number }),
            }),
          }))
          break
        }

        case 'fog_add': {
          const pageId = msg.pageId as string
          updatePage(pageId, p => ({
            ...p,
            fogRects: [...p.fogRects, {
              id: msg.id as string,
              x: msg.x as number,
              y: msg.y as number,
              width: msg.width as number,
              height: msg.height as number,
            }],
          }))
          break
        }

        case 'fog_remove': {
          const pageId = msg.pageId as string
          updatePage(pageId, p => ({ ...p, fogRects: p.fogRects.filter(r => r.id !== msg.id) }))
          break
        }

        case 'fog_clear': {
          const pageId = msg.pageId as string
          updatePage(pageId, p => ({ ...p, fogRects: [] }))
          break
        }

        case 'page_add': {
          const newPage: Page = {
            id: msg.id as string,
            name: msg.name as string,
            mapUrl: null,
            mapSize: null,
            tokens: [],
            fogRects: [],
          }
          setPages(prev => [...prev, newPage])
          break
        }

        case 'page_remove':
          setPages(prev => prev.filter(p => p.id !== msg.id))
          break

        case 'page_rename':
          updatePage(msg.id as string, p => ({ ...p, name: msg.name as string }))
          break

        case 'page_present':
          setPresentedPageId(msg.id as string)
          break

        case 'measure_update':
          setMeasureArrow({
            x1: msg.x1 as number,
            y1: msg.y1 as number,
            x2: msg.x2 as number,
            y2: msg.y2 as number,
          })
          break

        case 'measure_clear':
          setMeasureArrow(null)
          break

        default:
          console.warn('unknown message type', msg.type)
      }
    }

    return () => ws.close()
  }, [])

  function send(msg: OutgoingMsg) {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
    }
  }

  return { pages, presentedPageId, measureArrow, connected, send }
}

/** Upload a file to the server's asset store. Returns the absolute URL. */
export async function uploadAsset(file: File): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${SERVER_URL}/assets`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(`Asset upload failed: ${res.statusText}`)
  const data = (await res.json()) as { url: string }
  return SERVER_URL + data.url
}
