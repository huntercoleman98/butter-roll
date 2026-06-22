import { useEffect, useRef, useState } from 'react'

export interface TokenData {
  id: string
  url: string
  x: number
  y: number
}

export interface FogRect {
  id: string
  x: number
  y: number
  width: number
  height: number
}

export const SERVER_URL = 'http://localhost:8080'

type OutgoingMsg =
  | { type: 'map_set'; url: string; width: number; height: number }
  | { type: 'map_resize'; width: number; height: number }
  | { type: 'token_add'; id: string; url: string; x: number; y: number }
  | { type: 'token_move'; id: string; x: number; y: number }
  | { type: 'token_remove'; id: string }
  | { type: 'fog_add'; id: string; x: number; y: number; width: number; height: number }
  | { type: 'fog_remove'; id: string }
  | { type: 'fog_clear' }

export function useGameSocket() {
  const [mapUrl, setMapUrl] = useState<string | null>(null)
  const [mapSize, setMapSize] = useState<{ width: number; height: number } | null>(null)
  const [tokens, setTokens] = useState<TokenData[]>([])
  const [fogRects, setFogRects] = useState<FogRect[]>([])
  const [connected, setConnected] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    const ws = new WebSocket(`ws://localhost:8080/ws`)
    wsRef.current = ws

    ws.onopen = () => setConnected(true)
    ws.onclose = () => setConnected(false)
    ws.onerror = (e) => console.error('WebSocket error', e)

    ws.onmessage = (e: MessageEvent) => {
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(e.data as string) as Record<string, unknown>
      } catch {
        console.warn('bad WS message', e.data)
        return
      }

      switch (msg.type) {
        case 'snapshot':
          setMapUrl((msg.mapUrl as string) || null)
          setMapSize(
            msg.mapWidth && msg.mapHeight
              ? { width: msg.mapWidth as number, height: msg.mapHeight as number }
              : null,
          )
          setTokens((msg.tokens as TokenData[]) ?? [])
          setFogRects((msg.fogRects as FogRect[]) ?? [])
          break

        case 'map_set':
          setMapUrl(msg.url as string)
          setMapSize({ width: msg.width as number, height: msg.height as number })
          break

        case 'map_resize':
          setMapSize({ width: msg.width as number, height: msg.height as number })
          break

        case 'token_add':
          setTokens(prev => [
            ...prev,
            { id: msg.id as string, url: msg.url as string, x: msg.x as number, y: msg.y as number },
          ])
          break

        case 'token_move': {
          const id = msg.id as string
          const x = msg.x as number
          const y = msg.y as number
          setTokens(prev => {
            const idx = prev.findIndex(t => t.id === id)
            if (idx === -1) return prev
            const updated = { ...prev[idx], x, y }
            return [...prev.slice(0, idx), ...prev.slice(idx + 1), updated]
          })
          break
        }

        case 'token_remove':
          setTokens(prev => prev.filter(t => t.id !== msg.id))
          break

        case 'fog_add':
          setFogRects(prev => [
            ...prev,
            {
              id: msg.id as string,
              x: msg.x as number,
              y: msg.y as number,
              width: msg.width as number,
              height: msg.height as number,
            },
          ])
          break

        case 'fog_remove':
          setFogRects(prev => prev.filter(r => r.id !== msg.id))
          break

        case 'fog_clear':
          setFogRects([])
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

  return { mapUrl, mapSize, tokens, fogRects, connected, send }
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
