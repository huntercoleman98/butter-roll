import { useEffect, useRef, useState } from 'react'
import type Konva from 'konva'
import MapCanvas from '../components/MapCanvas'
import MapSizeInput from '../components/MapSizeInput'
import { useGameSocket, uploadAsset } from '../hooks/useGameSocket'
import '../App.css'

type ActiveTool = 'select' | 'fog-reveal' | 'fog-hide'

type PageContextMenu = { pageId: string; x: number; y: number }

export default function DM() {
  const { pages, presentedPageId, connected, send } = useGameSocket()
  const [activePageId, setActivePageId] = useState<string | null>(null)
  const [aspectLocked, setAspectLocked] = useState(true)
  const [activeTool, setActiveTool] = useState<ActiveTool>('select')
  const [mapMenuOpen, setMapMenuOpen] = useState(false)
  const [pagesMenuOpen, setPagesMenuOpen] = useState(false)
  const [renamingPageId, setRenamingPageId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [pageContextMenu, setPageContextMenu] = useState<PageContextMenu | null>(null)
  const [selectedTokenIds, setSelectedTokenIds] = useState<Set<string>>(new Set())

  const mapAreaRef = useRef<HTMLDivElement>(null)
  const mapInputRef = useRef<HTMLInputElement>(null)
  const tokenInputRef = useRef<HTMLInputElement>(null)
  const stageRef = useRef<Konva.Stage | null>(null)

  // On first snapshot, initialize active page to the presented page.
  useEffect(() => {
    if (activePageId === null && pages.length > 0) {
      setActivePageId(presentedPageId ?? pages[0].id)
    }
  }, [pages, presentedPageId, activePageId])

  // If the active page is deleted remotely, fall back to the first page.
  useEffect(() => {
    if (activePageId && pages.length > 0 && !pages.find(p => p.id === activePageId)) {
      setActivePageId(pages[0].id)
    }
  }, [pages, activePageId])

  const activePage = pages.find(p => p.id === activePageId) ?? pages[0] ?? null
  const activeId = activePage?.id ?? ''

  const fogMode = activeTool === 'fog-reveal' ? 'reveal' : activeTool === 'fog-hide' ? 'hide' : null
  const fogToolActive = activeTool !== 'select'

  // Close map menu on outside click.
  useEffect(() => {
    if (!mapMenuOpen) return
    function handleClick(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest('.map-menu-group')) setMapMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [mapMenuOpen])

  // Close pages menu on outside click.
  useEffect(() => {
    if (!pagesMenuOpen) return
    function handleClick(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest('.pages-menu-group')) {
        setPagesMenuOpen(false)
        setRenamingPageId(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [pagesMenuOpen])

  // Close page context menu on outside click or Escape.
  useEffect(() => {
    if (!pageContextMenu) return
    function handleClick() { setPageContextMenu(null) }
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') setPageContextMenu(null) }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [pageContextMenu])

  async function handleMapFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !activeId) return
    e.target.value = ''
    const url = await uploadAsset(file)
    const img = new Image()
    img.onload = () => send({ type: 'map_set', pageId: activeId, url, width: img.naturalWidth, height: img.naturalHeight })
    img.src = url
  }

  async function handleTokenFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !activeId) return
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
    send({ type: 'token_add', pageId: activeId, id: crypto.randomUUID(), url, x, y })
  }

  function handleMoveToken(id: string, x: number, y: number) {
    if (!activeId) return
    send({ type: 'token_move', pageId: activeId, id, x, y })
  }

  function handleMapSizeInput(axis: 'width' | 'height', value: string) {
    const n = parseInt(value, 10)
    if (!activePage?.mapSize || isNaN(n) || n <= 0 || !activeId) return
    let { width, height } = activePage.mapSize
    if (aspectLocked) {
      const ratio = activePage.mapSize.width / activePage.mapSize.height
      if (axis === 'width') { width = n; height = Math.round(n / ratio) }
      else { height = n; width = Math.round(n * ratio) }
    } else {
      if (axis === 'width') width = n
      else height = n
    }
    send({ type: 'map_resize', pageId: activeId, width, height })
  }

  function handleFogDraw(rect: { x: number; y: number; width: number; height: number }) {
    if (!activeId) return
    send({ type: 'fog_add', pageId: activeId, id: crypto.randomUUID(), ...rect })
  }

  function handleFogRemove(id: string) {
    if (!activeId) return
    send({ type: 'fog_remove', pageId: activeId, id })
  }

  function handleDeleteTokens(ids: Set<string>) {
    if (!activeId) return
    for (const id of ids) send({ type: 'token_remove', pageId: activeId, id })
    setSelectedTokenIds(new Set())
  }

  function handleUpdateToken(ids: Set<string>, update: { color?: string; borderWidth?: number }) {
    if (!activeId) return
    for (const id of ids) send({ type: 'token_update', pageId: activeId, id, ...update })
  }

  function switchToPage(pageId: string) {
    setActivePageId(pageId)
    setSelectedTokenIds(new Set())
    setPagesMenuOpen(false)
    setRenamingPageId(null)
  }

  function handleAddPage() {
    const id = crypto.randomUUID()
    const name = `Page ${pages.length + 1}`
    send({ type: 'page_add', id, name })
    setActivePageId(id)
    setPagesMenuOpen(false)
  }

  function handlePresentPage(id: string) {
    send({ type: 'page_present', id })
    setPagesMenuOpen(false)
  }

  function handleDeletePage(id: string) {
    setPageContextMenu(null)
    if (id === activeId) {
      const other = pages.find(p => p.id !== id)
      if (other) setActivePageId(other.id)
    }
    send({ type: 'page_remove', id })
  }

  function startRename(page: { id: string; name: string }) {
    setPageContextMenu(null)
    setRenamingPageId(page.id)
    setRenameValue(page.name)
    if (!pagesMenuOpen) setPagesMenuOpen(true)
  }

  function commitRename(pageId: string, currentName: string) {
    const name = renameValue.trim() || currentName
    send({ type: 'page_rename', id: pageId, name })
    setRenamingPageId(null)
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
          <div className="menu-group map-menu-group">
            <button onClick={() => setMapMenuOpen(o => !o)}>Map ▾</button>
            {mapMenuOpen && (
              <div className="window map-dropdown">
                <div className="window-body">
                  <button onClick={() => { mapInputRef.current?.click(); setMapMenuOpen(false) }}>Set Map…</button>
                  {activePage?.mapSize && (
                    <div className="map-dropdown-row">
                      <MapSizeInput label="W" value={activePage.mapSize.width} onChange={n => handleMapSizeInput('width', String(n))} />
                      <MapSizeInput label="H" value={activePage.mapSize.height} onChange={n => handleMapSizeInput('height', String(n))} />
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

          <div className="menu-group pages-menu-group">
            <button onClick={() => setPagesMenuOpen(o => !o)}>Pages ▾</button>
            {pagesMenuOpen && (
              <div className="window pages-dropdown">
                <div className="window-body">
                  {pages.map(page => (
                    <div
                      key={page.id}
                      className={`pages-row${activeId === page.id ? ' pages-row-active' : ''}`}
                      onClick={() => switchToPage(page.id)}
                      onContextMenu={e => {
                        e.preventDefault()
                        setPageContextMenu({ pageId: page.id, x: e.clientX, y: e.clientY })
                      }}
                    >
                      {renamingPageId === page.id ? (
                        <input
                          className="pages-row-rename"
                          autoFocus
                          value={renameValue}
                          onChange={e => setRenameValue(e.target.value)}
                          onBlur={() => commitRename(page.id, page.name)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') e.currentTarget.blur()
                            if (e.key === 'Escape') setRenamingPageId(null)
                            e.stopPropagation()
                          }}
                          onClick={e => e.stopPropagation()}
                        />
                      ) : (
                        <span className="pages-row-name">{page.name}</span>
                      )}
                      {presentedPageId === page.id ? (
                        <span className="live-badge">● Live</span>
                      ) : (
                        <button
                          className="present-btn"
                          onClick={e => { e.stopPropagation(); handlePresentPage(page.id) }}
                        >
                          Present
                        </button>
                      )}
                    </div>
                  ))}
                  <div className="pages-row pages-add-row" onClick={handleAddPage}>
                    + New Page
                  </div>
                </div>
              </div>
            )}
          </div>

          <span className="connection-status">{connected ? '● Connected' : '○ Offline'}</span>
        </div>

        {/* ── Page context menu ── */}
        {pageContextMenu && (() => {
          const page = pages.find(p => p.id === pageContextMenu.pageId)
          if (!page) return null
          return (
            <div
              className="window context-menu"
              style={{ position: 'fixed', left: pageContextMenu.x, top: pageContextMenu.y, zIndex: 200 }}
              onMouseDown={e => e.stopPropagation()}
            >
              <div className="title-bar">
                <div className="title-bar-text">Page</div>
                <div className="title-bar-controls">
                  <button aria-label="Close" onClick={() => setPageContextMenu(null)} />
                </div>
              </div>
              <div className="window-body">
                <ul className="tree-view">
                  <li onClick={() => startRename(page)}>Rename</li>
                  {pages.length > 1 && (
                    <li onClick={() => handleDeletePage(page.id)}>Delete</li>
                  )}
                </ul>
              </div>
            </div>
          )
        })()}

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
                    <li onClick={() => activeId && send({ type: 'fog_clear', pageId: activeId })}>Clear Fog</li>
                  </ul>
                </details>
              </li>
            </ul>
          </aside>

          <MapCanvas
            mapUrl={activePage?.mapUrl ?? null}
            mapSize={activePage?.mapSize ?? null}
            tokens={activePage?.tokens ?? []}
            selectedTokenIds={selectedTokenIds}
            onMoveToken={handleMoveToken}
            onSelectionChange={setSelectedTokenIds}
            mapAreaRef={mapAreaRef}
            onStageReady={stage => { stageRef.current = stage }}
            fogRects={activePage?.fogRects ?? []}
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
