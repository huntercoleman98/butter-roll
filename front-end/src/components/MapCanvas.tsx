import { useEffect, useRef, useState } from 'react'
import { Stage, Layer, Image as KonvaImage, Rect } from 'react-konva'
import type Konva from 'konva'
import Token, { type TokenHandle } from './Token'
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
  selectedTokenIds?: Set<string>
  onMoveToken?: (id: string, x: number, y: number) => void
  onSelectionChange?: (ids: Set<string>) => void
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
  mapUrl, mapSize, tokens, selectedTokenIds, onMoveToken, onSelectionChange,
  mapAreaRef, onStageReady, readOnly = false,
  fogRects = [], fogMode = null, onFogDraw, onFogRemove,
}: MapCanvasProps) {
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [mapImage, setMapImage] = useState<HTMLImageElement | null>(null)
  const [draft, setDraft] = useState<DraftRect | null>(null)
  const [selectionRect, setSelectionRect] = useState<DraftRect | null>(null)
  const [selectedFogId, setSelectedFogId] = useState<string | null>(null)
  const selectedFogIdRef = useRef<string | null>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const dragStartPositions = useRef<Map<string, { x: number; y: number }>>(new Map())
  const tokenHandles = useRef<Map<string, TokenHandle>>(new Map())

  function setFogSelection(id: string | null) {
    selectedFogIdRef.current = id
    setSelectedFogId(id)
  }

  // Clear fog selection whenever hide mode is left
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

  // ── Token interaction handlers ──────────────────────────────────────────────

  function handleTokenClick(id: string, shift: boolean) {
    if (!onSelectionChange) return
    if (shift) {
      const next = new Set(selectedTokenIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      onSelectionChange(next)
    } else {
      onSelectionChange(new Set([id]))
    }
  }

  function handleTokenDragStart(id: string) {
    dragStartPositions.current.clear()
    if (!selectedTokenIds?.has(id)) {
      onSelectionChange?.(new Set([id]))
      return
    }
    for (const selId of selectedTokenIds) {
      const node = stageRef.current?.findOne<Konva.Image>('#' + selId)
      if (node) dragStartPositions.current.set(selId, { x: node.x(), y: node.y() })
    }
  }

  function handleTokenDragMove(id: string, x: number, y: number) {
    const startDragged = dragStartPositions.current.get(id)
    if (!startDragged) return
    const dx = x - startDragged.x
    const dy = y - startDragged.y
    for (const [selId, startPos] of dragStartPositions.current) {
      if (selId === id) continue
      tokenHandles.current.get(selId)?.setPosition(startPos.x + dx, startPos.y + dy)
    }
  }

  function handleTokenDragEnd(id: string, x: number, y: number) {
    const startDragged = dragStartPositions.current.get(id)
    if (!startDragged || dragStartPositions.current.size <= 1) {
      onMoveToken?.(id, x, y)
      dragStartPositions.current.clear()
      return
    }
    const dx = x - startDragged.x
    const dy = y - startDragged.y
    for (const [selId, startPos] of dragStartPositions.current) {
      const finalX = selId === id ? x : startPos.x + dx
      const finalY = selId === id ? y : startPos.y + dy
      onMoveToken?.(selId, finalX, finalY)
    }
    dragStartPositions.current.clear()
  }

  // ── Stage mouse handler ─────────────────────────────────────────────────────

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
    // Right-click → pan
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

    if (e.evt.button !== 0) return
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

    if (fogMode === 'reveal') {
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
      return
    }

    // Select mode: marquee on empty space (not on a token)
    if (readOnly || e.target.name() === 'token') return

    let localRect: DraftRect = { x: start.x, y: start.y, width: 0, height: 0 }
    setSelectionRect(localRect)
    startDrag(
      ev => {
        const cur = clientToWorld(stage, ev.clientX, ev.clientY)
        localRect = {
          x: Math.min(start.x, cur.x),
          y: Math.min(start.y, cur.y),
          width: Math.abs(cur.x - start.x),
          height: Math.abs(cur.y - start.y),
        }
        setSelectionRect(localRect)
      },
      () => {
        setSelectionRect(null)
        // Small area = plain click on empty space → clear selection
        if (localRect.width < 4 && localRect.height < 4) {
          onSelectionChange?.(new Set())
          return
        }
        const { x, y, width, height } = localRect
        onSelectionChange?.(new Set(
          tokens
            .filter(t => t.x >= x && t.x <= x + width && t.y >= y && t.y <= y + height)
            .map(t => t.id)
        ))
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
            <Token
              key={t.id}
              ref={handle => {
                if (handle) tokenHandles.current.set(t.id, handle)
                else tokenHandles.current.delete(t.id)
              }}
              {...t}
              isSelected={selectedTokenIds?.has(t.id)}
              draggable={tokensInteractive}
              onClick={tokensInteractive ? handleTokenClick : undefined}
              onDragStart={tokensInteractive ? handleTokenDragStart : undefined}
              onDragMove={tokensInteractive ? handleTokenDragMove : undefined}
              onDragEnd={tokensInteractive ? handleTokenDragEnd : undefined}
            />
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
        {selectionRect && (
          <Layer listening={false}>
            <Rect
              x={selectionRect.x} y={selectionRect.y}
              width={selectionRect.width} height={selectionRect.height}
              fill="rgba(250,204,21,0.08)"
              stroke="rgba(250,204,21,0.8)"
              strokeWidth={1}
              dash={[4, 3]}
              listening={false}
            />
          </Layer>
        )}
      </Stage>
    </div>
  )
}