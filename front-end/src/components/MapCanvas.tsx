import { useEffect, useRef, useState } from 'react'
import { Stage, Layer, Image as KonvaImage, Rect, Arrow, Circle, Line, Text } from 'react-konva'
import Konva from 'konva'
import Token, { type TokenHandle } from './Token'
import FogLayer from './FogLayer'
import type { TokenData, FogRect, ArrowOverlay, RadiusCircle, Ping, ViewportSync } from '../hooks/useGameSocket'

export type ActiveTool = 'select' | 'fog-reveal' | 'fog-hide' | 'arrow' | 'radius'

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
  tool?: ActiveTool
  onFogDraw?: (rect: DraftRect) => void
  onFogRemove?: (id: string) => void
  onDeleteTokens?: (ids: Set<string>) => void
  onUpdateToken?: (ids: Set<string>, update: { color?: string; borderWidth?: number }) => void
  arrowOverlay?: ArrowOverlay | null
  onArrowUpdate?: (arrow: ArrowOverlay) => void
  onArrowClear?: () => void
  radiusCircle?: RadiusCircle | null
  onRadiusUpdate?: (circle: RadiusCircle) => void
  onRadiusClear?: () => void
  ping?: Ping | null
  onPing?: (pos: { x: number; y: number }) => void
  onBringPlayersHere?: (worldCenterX: number, worldCenterY: number, scale: number) => void
  syncedViewport?: ViewportSync | null
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

interface ContextMenu {
  x: number
  y: number
  tokenId: string
}

export default function MapCanvas({
  mapUrl, mapSize, tokens, selectedTokenIds, onMoveToken, onSelectionChange,
  mapAreaRef, onStageReady, readOnly = false,
  fogRects = [], tool = 'select', onFogDraw, onFogRemove, onDeleteTokens, onUpdateToken,
  arrowOverlay = null, onArrowUpdate, onArrowClear,
  radiusCircle = null, onRadiusUpdate, onRadiusClear,
  ping = null, onPing,
  onBringPlayersHere, syncedViewport = null,
}: MapCanvasProps) {
  const fogMode = tool === 'fog-reveal' ? 'reveal' : tool === 'fog-hide' ? 'hide' : null
  const arrowMode = tool === 'arrow'
  const radiusMode = tool === 'radius'
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [mapImage, setMapImage] = useState<HTMLImageElement | null>(null)
  const [draft, setDraft] = useState<DraftRect | null>(null)
  const [selectionRect, setSelectionRect] = useState<DraftRect | null>(null)
  const [selectedFogId, setSelectedFogId] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null)
  const [menuColor, setMenuColor] = useState<string | null>(null)
  const [menuBorderWidth, setMenuBorderWidth] = useState<number | null>(null)
  const [canvasContextMenu, setCanvasContextMenu] = useState<{ x: number; y: number } | null>(null)
  const selectedFogIdRef = useRef<string | null>(null)
  const suppressNextTokenClickRef = useRef(false)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const canvasContextMenuRef = useRef<HTMLDivElement>(null)
  const updateDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const dragStartPositions = useRef<Map<string, { x: number; y: number }>>(new Map())
  const tokenHandles = useRef<Map<string, TokenHandle>>(new Map())
  const viewportTweenRef = useRef<Konva.Tween | null>(null)

  function setFogSelection(id: string | null) {
    selectedFogIdRef.current = id
    setSelectedFogId(id)
  }

  // Clear fog selection whenever hide mode is left
  useEffect(() => {
    if (fogMode !== 'hide') setFogSelection(null)
  }, [fogMode])

  // Close token context menu on outside click
  useEffect(() => {
    if (!contextMenu) return
    function handleClick(e: MouseEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [contextMenu])

  // Close canvas context menu on outside click
  useEffect(() => {
    if (!canvasContextMenu) return
    function handleClick(e: MouseEvent) {
      if (canvasContextMenuRef.current && !canvasContextMenuRef.current.contains(e.target as Node)) {
        setCanvasContextMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [canvasContextMenu])

  // Apply viewport sync from DM with tween (viewer only)
  useEffect(() => {
    if (!syncedViewport || !stageRef.current || !mapAreaRef.current) return
    const { worldCenterX, worldCenterY, scale } = syncedViewport
    const w = mapAreaRef.current.clientWidth
    const h = mapAreaRef.current.clientHeight
    const targetX = w / 2 - worldCenterX * scale
    const targetY = h / 2 - worldCenterY * scale
    viewportTweenRef.current?.destroy()
    viewportTweenRef.current = new Konva.Tween({
      node: stageRef.current,
      x: targetX,
      y: targetY,
      scaleX: scale,
      scaleY: scale,
      duration: 0.4,
      easing: Konva.Easings.EaseInOut,
      onFinish: () => { viewportTweenRef.current = null },
    })
    viewportTweenRef.current.play()
  }, [syncedViewport])

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
    if (suppressNextTokenClickRef.current) {
      suppressNextTokenClickRef.current = false
      return
    }
    if (!onSelectionChange) return
    if (shift) {
      const next = new Set(selectedTokenIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      onSelectionChange(next)
    } else {
      console.log('hello')
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

  function handleTokenContextMenu(id: string, x: number, y: number) {
    const affectedIds = selectedTokenIds?.has(id) ? selectedTokenIds : new Set([id])
    if (!selectedTokenIds?.has(id)) onSelectionChange?.(new Set([id]))
    const affected = tokens.filter(t => affectedIds.has(t.id))
    const firstColor = affected[0]?.color ?? '#c084fc'
    const sharedColor = affected.every(t => (t.color ?? '#c084fc') === firstColor) ? firstColor : null
    const firstBW = affected[0]?.borderWidth ?? 2
    const sharedBW = affected.every(t => (t.borderWidth ?? 2) === firstBW) ? firstBW : null
    setMenuColor(sharedColor)
    setMenuBorderWidth(sharedBW)
    setContextMenu({ x, y, tokenId: id })
  }

  function contextMenuAffectedIds() {
    if (!contextMenu) return new Set<string>()
    const { tokenId } = contextMenu
    return selectedTokenIds?.has(tokenId) ? selectedTokenIds : new Set([tokenId])
  }

  function scheduleUpdate(ids: Set<string>, update: { color?: string; borderWidth?: number }) {
    if (updateDebounceRef.current) clearTimeout(updateDebounceRef.current)
    updateDebounceRef.current = setTimeout(() => onUpdateToken?.(ids, update), 300)
  }

  function handleContextMenuDelete() {
    if (!contextMenu) return
    onDeleteTokens?.(contextMenuAffectedIds())
    setContextMenu(null)
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
    // Right-click → pan, or context menu if mouse barely moved
    if (e.evt.button === 2) {
      if (e.target.name() === 'token') return
      e.evt.preventDefault()
      const stage = stageRef.current!
      const startClientX = e.evt.clientX
      const startClientY = e.evt.clientY
      const startPos = { x: e.evt.clientX - stage.x(), y: e.evt.clientY - stage.y() }
      startDrag(
        ev => stage.position({ x: ev.clientX - startPos.x, y: ev.clientY - startPos.y }),
        ev => {
          const dx = ev.clientX - startClientX
          const dy = ev.clientY - startClientY
          if (dx * dx + dy * dy < 16 && onBringPlayersHere) {
            setCanvasContextMenu({ x: ev.clientX, y: ev.clientY })
          }
        },
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

    if (arrowMode) {
      const start = clientToWorld(stage, e.evt.clientX, e.evt.clientY)
      onArrowUpdate?.({ x1: start.x, y1: start.y, x2: start.x, y2: start.y })
      startDrag(
        ev => {
          const cur = clientToWorld(stage, ev.clientX, ev.clientY)
          onArrowUpdate?.({ x1: start.x, y1: start.y, x2: cur.x, y2: cur.y })
        },
        () => onArrowClear?.(),
      )
      return
    }

    if (radiusMode) {
      const center = clientToWorld(stage, e.evt.clientX, e.evt.clientY)
      onRadiusUpdate?.({ x: center.x, y: center.y, x2: center.x, y2: center.y })
      startDrag(
        ev => {
          const cur = clientToWorld(stage, ev.clientX, ev.clientY)
          onRadiusUpdate?.({ x: center.x, y: center.y, x2: cur.x, y2: cur.y })
        },
        () => onRadiusClear?.(),
      )
      return
    }

    // Long-press ping (select mode only, any target including tokens)
    if (!readOnly && tool === 'select' && onPing) {
      let pingCancelled = false
      const pingTimer = setTimeout(() => {
        if (!pingCancelled) {
          if (e.target.name() === 'token') suppressNextTokenClickRef.current = true
          onPing(start)
        }
      }, 500)
      function cancelPing() {
        pingCancelled = true
        clearTimeout(pingTimer)
        window.removeEventListener('mouseup', cancelPing)
        window.removeEventListener('mousemove', checkPingMove)
      }
      function checkPingMove(ev: MouseEvent) {
        const dx = ev.clientX - e.evt.clientX
        const dy = ev.clientY - e.evt.clientY
        if (dx * dx + dy * dy > 25) cancelPing()
      }
      window.addEventListener('mouseup', cancelPing)
      window.addEventListener('mousemove', checkPingMove)
    }

    // Select mode: marquee on empty space (not on a token)
    if (readOnly || e.target.name() === 'token') return

    let localRect: DraftRect = { x: start.x, y: start.y, width: 0, height: 0 }
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

  const tokensInteractive = !readOnly && !fogMode && !arrowMode && !radiusMode
  const fogOpacity = readOnly ? 1 : 0.65
  const selFogRect = selectedFogId ? fogRects.find(r => r.id === selectedFogId) : null

  return (
    <div
      ref={mapAreaRef}
      className="map-area"
      style={
        arrowMode || radiusMode
          ? { cursor: 'crosshair' }
          : fogMode
          ? { cursor: fogMode === 'reveal' ? 'crosshair' : 'cell' }
          : undefined
      }
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
              onContextMenu={tokensInteractive ? handleTokenContextMenu : undefined}
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
        {arrowOverlay && (() => {
          const { x1, y1, x2, y2 } = arrowOverlay
          const dist = (Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2) / 60 * 5).toFixed(1)
          return (
            <Layer listening={false}>
              <Arrow
                points={[x1, y1, x2, y2]}
                stroke="rgba(0,0,0,0.9)"
                strokeWidth={5}
                fill="rgba(0,0,0,0.9)"
                pointerLength={12}
                pointerWidth={10}
                listening={false}
              />
              <Arrow
                points={[x1, y1, x2, y2]}
                stroke="rgba(255,235,59,0.95)"
                strokeWidth={2}
                fill="rgba(255,235,59,0.95)"
                pointerLength={12}
                pointerWidth={10}
                listening={false}
              />
              <Text
                x={(x1 + x2) / 2 + 6}
                y={(y1 + y2) / 2 - 18}
                text={`${dist} ft.`}
                fontSize={28}
                fill="white"
                stroke="black"
                strokeWidth={4}
                fillAfterStrokeEnabled
                listening={false}
              />
            </Layer>
          )
        })()}
        {ping && (
          <Layer listening={false}>
            <Circle x={ping.x} y={ping.y} radius={10} fill="rgba(255,235,59,0.95)" listening={false} />
            <Circle x={ping.x} y={ping.y} radius={30} stroke="rgba(255,235,59,0.6)" strokeWidth={3} fill="transparent" listening={false} />
            <Circle x={ping.x} y={ping.y} radius={55} stroke="rgba(255,235,59,0.25)" strokeWidth={2} fill="transparent" listening={false} />
          </Layer>
        )}
        {radiusCircle && (() => {
          const { x, y, x2, y2 } = radiusCircle
          const radius = Math.sqrt((x2 - x) ** 2 + (y2 - y) ** 2)
          const dist = (radius / 60 * 5).toFixed(1)
          const mx = (x + x2) / 2
          const my = (y + y2) / 2
          return (
            <Layer listening={false}>
              <Circle
                x={x} y={y} radius={radius}
                stroke="rgba(0,0,0,0.9)"
                strokeWidth={5}
                fill="transparent"
                listening={false}
              />
              <Circle
                x={x} y={y} radius={radius}
                stroke="rgba(255,235,59,0.95)"
                strokeWidth={2}
                fill="transparent"
                listening={false}
              />
              <Line
                points={[x, y, x2, y2]}
                stroke="rgba(0,0,0,0.9)"
                strokeWidth={5}
                listening={false}
              />
              <Line
                points={[x, y, x2, y2]}
                stroke="rgba(255,235,59,0.95)"
                strokeWidth={2}
                listening={false}
              />
              <Text
                x={mx + 6}
                y={my - 14}
                text={`${dist} ft.`}
                fontSize={28}
                fill="white"
                stroke="black"
                strokeWidth={4}
                fillAfterStrokeEnabled
                listening={false}
              />
            </Layer>
          )
        })()}
      </Stage>
      {canvasContextMenu && onBringPlayersHere && (
        <div
          ref={canvasContextMenuRef}
          className="window context-menu"
          style={{ position: 'fixed', left: canvasContextMenu.x, top: canvasContextMenu.y, zIndex: 1000 }}
        >
          <div className="title-bar">
            <div className="title-bar-text">Canvas</div>
            <div className="title-bar-controls">
              <button aria-label="Close" onClick={() => setCanvasContextMenu(null)} />
            </div>
          </div>
          <div className="window-body">
            <ul className="tree-view">
              <li onClick={() => {
                const stage = stageRef.current!
                const scale = stage.scaleX()
                const worldCenterX = (size.width / 2 - stage.x()) / scale
                const worldCenterY = (size.height / 2 - stage.y()) / scale
                onBringPlayersHere(worldCenterX, worldCenterY, scale)
                setCanvasContextMenu(null)
              }}>Bring player view here</li>
            </ul>
          </div>
        </div>
      )}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="window context-menu"
          style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 1000 }}
        >
          <div className="title-bar">
            <div className="title-bar-text">Token</div>
            <div className="title-bar-controls">
              <button aria-label="Close" onClick={() => setContextMenu(null)} />
            </div>
          </div>
          <div className="window-body">
            <ul className="tree-view">
              <li onClick={handleContextMenuDelete}>Delete</li>
            </ul>
            <div className="context-menu-fields">
              <label>Border color</label>
              <input
                type="color"
                value={menuColor ?? '#808080'}
                onChange={e => {
                  setMenuColor(e.target.value)
                  scheduleUpdate(contextMenuAffectedIds(), { color: e.target.value })
                }}
              />
              <label>Border width</label>
              <input
                type="number"
                value={menuBorderWidth !== null ? menuBorderWidth : ''}
                placeholder="—"
                min={0}
                onChange={e => {
                  const v = e.target.value === '' ? null : Number(e.target.value)
                  setMenuBorderWidth(v)
                  if (v !== null) scheduleUpdate(contextMenuAffectedIds(), { borderWidth: v })
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}