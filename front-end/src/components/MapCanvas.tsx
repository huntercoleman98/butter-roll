import { useEffect, useRef, useState } from 'react'
import { Stage, Layer, Image as KonvaImage, Rect } from 'react-konva'
import type Konva from 'konva'
import Token from './Token'
import FogLayer from './FogLayer'
import type { FogRect } from '../hooks/useGameSocket'

interface TokenData {
  id: string
  url: string
  x: number
  y: number
}

interface DraftRect {
  x: number
  y: number
  width: number
  height: number
}

interface MapCanvasProps {
  mapUrl: string | null
  mapSize: { width: number; height: number } | null
  tokens: TokenData[]
  onMoveToken?: (id: string, x: number, y: number) => void
  mapAreaRef: React.RefObject<HTMLDivElement | null>
  onStageReady?: (stage: Konva.Stage) => void
  readOnly?: boolean
  fogRects?: FogRect[]
  fogMode?: 'reveal' | 'hide' | null
  onFogDraw?: (rect: DraftRect) => void
  onFogRemove?: (id: string) => void
}

const MIN_SCALE = 0.1
const MAX_SCALE = 10

function clientToWorld(stage: Konva.Stage, clientX: number, clientY: number) {
  const rect = stage.container().getBoundingClientRect()
  return {
    x: (clientX - rect.left - stage.x()) / stage.scaleX(),
    y: (clientY - rect.top - stage.y()) / stage.scaleY(),
  }
}

function startDrag(
  onMove: (ev: MouseEvent) => void,
  onUp: (ev: MouseEvent) => void,
) {
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', function handler(ev: MouseEvent) {
    onUp(ev)
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', handler)
  })
}

export default function MapCanvas({
  mapUrl, mapSize, tokens, onMoveToken, mapAreaRef, onStageReady,
  readOnly = false, fogRects = [], fogMode = null, onFogDraw, onFogRemove,
}: MapCanvasProps) {
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [mapImage, setMapImage] = useState<HTMLImageElement | null>(null)
  const [draft, setDraft] = useState<DraftRect | null>(null)
  const [selectedFogId, setSelectedFogId] = useState<string | null>(null)
  const selectedFogIdRef = useRef<string | null>(null)
  const stageRef = useRef<Konva.Stage>(null)

  function setFogSelection(id: string | null) {
    selectedFogIdRef.current = id
    setSelectedFogId(id)
  }

  // Clear selection whenever hide mode is left
  useEffect(() => {
    if (fogMode !== 'hide') setFogSelection(null)
  }, [fogMode])

  // Track container size
  useEffect(() => {
    const el = mapAreaRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setSize({ width: el.clientWidth, height: el.clientHeight })
    })
    ro.observe(el)
    setSize({ width: el.clientWidth, height: el.clientHeight })
    return () => ro.disconnect()
  }, [mapAreaRef])

  // Expose stage to parent for token placement math
  useEffect(() => {
    if (stageRef.current) onStageReady?.(stageRef.current)
  }, [onStageReady])

  // Load map image
  useEffect(() => {
    if (!mapUrl) { setMapImage(null); return }
    const img = new window.Image()
    img.src = mapUrl
    img.onload = () => setMapImage(img)
  }, [mapUrl])

  function handleWheel(e: Konva.KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault()
    const stage = stageRef.current!
    const oldScale = stage.scaleX()
    const pointer = stage.getPointerPosition()!
    const factor = e.evt.deltaY < 0 ? 1.1 : 1 / 1.1
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, oldScale * factor))
    stage.scale({ x: newScale, y: newScale })
    stage.position({
      x: pointer.x - (pointer.x - stage.x()) * (newScale / oldScale),
      y: pointer.y - (pointer.y - stage.y()) * (newScale / oldScale),
    })
  }

  function handleMouseDown(e: Konva.KonvaEventObject<MouseEvent>) {
    // Right-click drag → pan
    if (e.evt.button === 2) {
      e.evt.preventDefault()
      const stage = stageRef.current!
      const startPos = { x: e.evt.clientX - stage.x(), y: e.evt.clientY - stage.y() }
      startDrag(
        ev => stage.position({ x: ev.clientX - startPos.x, y: ev.clientY - startPos.y }),
        () => {},
      )
      return
    }

    if (e.evt.button !== 0 || !fogMode) return
    e.evt.preventDefault()

    const stage = stageRef.current!
    const start = clientToWorld(stage, e.evt.clientX, e.evt.clientY)

    if (fogMode === 'hide') {
      const hit = fogRects.find(r =>
        start.x >= r.x && start.x <= r.x + r.width &&
        start.y >= r.y && start.y <= r.y + r.height
      )
      if (!hit) {
        setFogSelection(null)
      } else if (hit.id === selectedFogIdRef.current) {
        onFogRemove?.(hit.id)
        setFogSelection(null)
      } else {
        setFogSelection(hit.id)
      }
      return
    }

    // Reveal mode: drag to draw
    let localDraft: DraftRect = { x: start.x, y: start.y, width: 0, height: 0 }
    setDraft(localDraft)
    startDrag(
      ev => {
        const cur = clientToWorld(stage, ev.clientX, ev.clientY)
        localDraft = {
          x: Math.min(start.x, cur.x),
          y: Math.min(start.y, cur.y),
          width: Math.abs(cur.x - start.x),
          height: Math.abs(cur.y - start.y),
        }
        setDraft(localDraft)
      },
      () => {
        if (localDraft.width > 2 && localDraft.height > 2) onFogDraw?.(localDraft)
        setDraft(null)
      },
    )
  }

  const tokensInteractive = !readOnly && !fogMode
  const fogOpacity = readOnly ? 1 : 0.65
  const selFogRect = selectedFogId ? fogRects.find(r => r.id === selectedFogId) : null

  return (
    <div
      ref={mapAreaRef}
      className="map-area"
      style={fogMode ? { cursor: fogMode === 'reveal' ? 'crosshair' : 'cell' } : undefined}
    >
      {!mapUrl && <div className="map-placeholder">Load a map to get started</div>}
      <Stage
        ref={stageRef}
        width={size.width}
        height={size.height}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onContextMenu={e => e.evt.preventDefault()}
      >
        <Layer listening={false}>
          {mapImage && (
            <KonvaImage
              image={mapImage}
              width={mapSize?.width ?? mapImage.naturalWidth}
              height={mapSize?.height ?? mapImage.naturalHeight}
              listening={false}
            />
          )}
        </Layer>
        <Layer>
          {tokens.map(t => (
            <Token key={t.id} {...t} onMove={onMoveToken ?? (() => {})} draggable={tokensInteractive} />
          ))}
        </Layer>
        <FogLayer fogRects={fogRects} opacity={fogOpacity} />
        {selFogRect && (
          <Layer listening={false}>
            <Rect
              x={selFogRect.x} y={selFogRect.y}
              width={selFogRect.width} height={selFogRect.height}
              stroke="rgba(255,80,80,0.9)"
              strokeWidth={2}
              dash={[6, 4]}
              fill="rgba(255,60,60,0.15)"
              listening={false}
            />
          </Layer>
        )}
        {draft && (
          <Layer listening={false}>
            <Rect
              x={draft.x} y={draft.y}
              width={draft.width} height={draft.height}
              fill="rgba(255,255,255,0.15)"
              stroke="rgba(255,255,255,0.9)"
              strokeWidth={2}
              dash={[6, 4]}
              listening={false}
            />
          </Layer>
        )}
      </Stage>
    </div>
  )
}