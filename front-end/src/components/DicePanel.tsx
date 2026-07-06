import { useEffect, useRef, useState } from 'react'
import type { DiceRollResult } from '../hooks/useGameSocket'
import { parseDiceExpression } from '../utils/parseDiceExpression'

interface Props {
  history: DiceRollResult[]
  onRoll: (expression: string, isPrivate: boolean) => void
  onClose: () => void
}

const DIE_SIDES = [4, 6, 8, 10, 12, 20, 100]

function formatEntry(r: DiceRollResult, isPrivate: boolean): string {
  const showRolls = r.rolls.length > 1 || r.modifier !== 0
  const rollsStr = showRolls ? ` (${r.rolls.join(', ')})` : ''
  const tag = isPrivate ? ' 🔒' : ''
  return `DM rolled ${r.expression} → ${r.total}${rollsStr}${tag}`
}

export default function DicePanel({ history, onRoll, onClose }: Props) {
  const [expr, setExpr] = useState('')
  const [isPrivate, setIsPrivate] = useState(false)
  const [error, setError] = useState('')
  const [controlsHeight, setControlsHeight] = useState<number | null>(null)
  const [pos, setPos] = useState(() => ({ x: window.innerWidth - 240, y: 60 }))
  const panelRef = useRef<HTMLDivElement>(null)
  const historyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = historyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [history])

  function submit() {
    const trimmed = expr.trim()
    if (!trimmed) return
    if (!parseDiceExpression(trimmed)) {
      setError('Invalid expression. Use e.g. 2d6+3 (max 20 dice).')
      return
    }
    setError('')
    onRoll(trimmed, isPrivate)
    setExpr('')
  }

  function handleDragStart(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    const startX = e.clientX - pos.x
    const startY = e.clientY - pos.y

    function onMouseMove(ev: MouseEvent) {
      setPos({ x: ev.clientX - startX, y: ev.clientY - startY })
    }
    function onMouseUp() {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  function handleResizeMouseDown(e: React.MouseEvent) {
    e.preventDefault()
    const panel = panelRef.current
    if (!panel) return
    const startY = e.clientY
    const startHeight = panel.querySelector<HTMLElement>('.dice-controls')?.offsetHeight ?? 0

    function onMouseMove(ev: MouseEvent) {
      setControlsHeight(Math.max(40, startHeight + (ev.clientY - startY)))
    }
    function onMouseUp() {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  return (
    <div
      className="window dice-window"
      style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: 150 }}
      ref={panelRef}
    >
      <div className="title-bar" onMouseDown={handleDragStart} style={{ cursor: 'move' }}>
        <div className="title-bar-text">Dice</div>
        <div className="title-bar-controls">
          <button
            onClick={() => setIsPrivate(p => !p)}
            title={isPrivate ? 'Private' : 'Public'}
            style={{ fontSize: 12 }}
          >
            {isPrivate ? '🔒' : '🔓'}
          </button>
          <button aria-label="Close" onClick={onClose} />
        </div>
      </div>
      <div className="window-body dice-window-body">
        <div
          className="dice-controls"
          style={controlsHeight !== null ? { height: controlsHeight } : {}}
        >
          <div className="dice-die-buttons">
            {DIE_SIDES.map(sides => (
              <button key={sides} onClick={() => onRoll(`d${sides}`, isPrivate)}>
                d{sides}
              </button>
            ))}
          </div>
          <div className="dice-roll-row">
            <input
              type="text"
              placeholder="e.g. 2d6+3"
              value={expr}
              onChange={e => { setExpr(e.target.value); setError('') }}
              onKeyDown={e => { if (e.key === 'Enter') submit() }}
            />
            <button onClick={submit}>Roll</button>
          </div>
          {error && <div style={{ padding: '2px 4px', fontSize: 10, color: '#c00' }}>{error}</div>}
        </div>
        <div className="dice-resize-handle" onMouseDown={handleResizeMouseDown} />
        <div className="dice-history" ref={historyRef}>
          {history.map((r, i) => (
            <div key={i} style={{ color: r.private ? '#888' : undefined }}>
              {formatEntry(r, r.private ?? false)}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}