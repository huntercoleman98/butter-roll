import { useEffect, useRef, useState } from 'react'
import type Konva from 'konva'
import MapCanvas from '../components/MapCanvas'
import MapSizeInput from '../components/MapSizeInput'
import { useGameSocket, uploadAsset } from '../hooks/useGameSocket'
import '../App.css'

type ActiveTool = 'select' | 'fog-reveal' | 'fog-hide'

export default function DM() {
  const { mapUrl, mapSize, tokens, fogRects, connected, send } = useGameSocket()
  const [aspectLocked, setAspectLocked] = useState(true)
  const [activeTool, setActiveTool] = useState<ActiveTool>('select')
  const [mapMenuOpen, setMapMenuOpen] = useState(false)
  const [selectedTokenIds, setSelectedTokenIds] = useState<Set<string>>(new Set())

  const mapAreaRef = useRef<HTMLDivElement>(null)
  const mapInputRef = useRef<HTMLInputElement>(null)
  const tokenInputRef = useRef<HTMLInputElement>(null)
  const stageRef = useRef<Konva.Stage | null>(null)

  const fogMode = activeTool === 'fog-reveal' ? 'reveal' : activeTool === 'fog-hide' ? 'hide' : null
  const fogToolActive = activeTool !== 'select'

  useEffect(() => {
    if (!mapMenuOpen) return
    function handleClick(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest('.menu-group')) setMapMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [mapMenuOpen])

  async function handleMapFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const url = await uploadAsset(file)
    const img = new Image()
    img.onload = () => send({ type: 'map_set', url, width: img.naturalWidth, height: img.naturalHeight })
    img.src = url
  }

  async function handleTokenFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const url = await uploadAsset(file)
    const stage = stageRef.current
    let x = (mapAreaRef.current?.clientWidth ?? window.innerWidth) / 2
    let y = (mapAreaRef.current?.clientHeight ?? window.innerHeight) / 2
    if (stage) {
      const scale = stage.scaleX()
      x = (x - stage.x()) / scale
      y = (y - stage.y()) / scale
    }
    send({ type: 'token_add', id: crypto.randomUUID(), url, x, y })
  }

  function handleMoveToken(id: string, x: number, y: number) {
    send({ type: 'token_move', id, x, y })
  }

  function handleMapSizeInput(axis: 'width' | 'height', value: string) {
    const n = parseInt(value, 10)
    if (!mapSize || isNaN(n) || n <= 0) return
    let { width, height } = mapSize
    if (aspectLocked) {
      const ratio = mapSize.width / mapSize.height
      if (axis === 'width') { width = n; height = Math.round(n / ratio) }
      else { height = n; width = Math.round(n * ratio) }
    } else {
      if (axis === 'width') width = n
      else height = n
    }
    send({ type: 'map_resize', width, height })
  }

  function handleFogDraw(rect: { x: number; y: number; width: number; height: number }) {
    send({ type: 'fog_add', id: crypto.randomUUID(), ...rect })
  }

  function handleFogRemove(id: string) {
    send({ type: 'fog_remove', id })
  }

  function handleDeleteTokens(ids: Set<string>) {
    for (const id of ids) send({ type: 'token_remove', id })
    setSelectedTokenIds(new Set())
  }

  function handleUpdateToken(ids: Set<string>, update: { color?: string; borderWidth?: number }) {
    for (const id of ids) send({ type: 'token_update', id, ...update })
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
          <button onClick={() => tokenInputRef.current?.click()}>Add Token</button>
          <input ref={tokenInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleTokenFile} />

          <input ref={mapInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleMapFile} />
          <div className="menu-group">
            <button onClick={() => setMapMenuOpen(o => !o)}>Map ▾</button>
            {mapMenuOpen && (
              <div className="window map-dropdown">
                <div className="window-body">
                  <button onClick={() => { mapInputRef.current?.click(); setMapMenuOpen(false) }}>Set Map…</button>
                  {mapSize && (
                    <div className="map-dropdown-row">
                      <MapSizeInput label="W" value={mapSize.width} onChange={n => handleMapSizeInput('width', String(n))} />
                      <MapSizeInput label="H" value={mapSize.height} onChange={n => handleMapSizeInput('height', String(n))} />
                      <button
                        style={{ padding: '2px 4px' }}
                        onClick={() => setAspectLocked(l => !l)}
                        title={aspectLocked ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
                      >
                        {aspectLocked ? 'Aspect ratio locked' : 'Aspect ratio unlocked'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <span className="connection-status">{connected ? '● Connected' : '○ Offline'}</span>
        </div>

        {/* ── Content area: sidebar + canvas ── */}
        <div className="content">

          <aside className="sidebar">
            <ul className="tree-view">
              <li
                className={activeTool === 'select' ? 'active' : ''}
                onClick={() => setActiveTool('select')}
              >
                Select
              </li>
              <li>
                <details>
                  <summary className={fogToolActive ? 'active' : ''}>
                    Fog{fogToolActive && <em> ({activeTool === 'fog-reveal' ? 'Reveal' : 'Hide'})</em>}
                  </summary>
                  <ul>
                    <li
                      className={activeTool === 'fog-reveal' ? 'active' : ''}
                      onClick={() => setActiveTool('fog-reveal')}
                    >
                      Reveal
                    </li>
                    <li
                      className={activeTool === 'fog-hide' ? 'active' : ''}
                      onClick={() => setActiveTool('fog-hide')}
                    >
                      Hide
                    </li>
                    <li onClick={() => send({ type: 'fog_clear' })}>Clear Fog</li>
                  </ul>
                </details>
              </li>
            </ul>
          </aside>

          <MapCanvas
            mapUrl={mapUrl}
            mapSize={mapSize}
            tokens={tokens}
            selectedTokenIds={selectedTokenIds}
            onMoveToken={handleMoveToken}
            onSelectionChange={setSelectedTokenIds}
            mapAreaRef={mapAreaRef}
            onStageReady={stage => { stageRef.current = stage }}
            fogRects={fogRects}
            fogMode={fogMode}
            onFogDraw={handleFogDraw}
            onFogRemove={handleFogRemove}
            onDeleteTokens={handleDeleteTokens}
            onUpdateToken={handleUpdateToken}
          />
        </div>
      </div>
    </div>
  )
}
