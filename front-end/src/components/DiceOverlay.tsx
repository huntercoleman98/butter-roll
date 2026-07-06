import { useEffect, useRef } from 'react'
import DiceBox from '@3d-dice/dice-box'
import type { DiceRollResult } from '../hooks/useGameSocket'
import { parseDiceExpression } from '../utils/parseDiceExpression'

const DICE_CLEAR_DELAY_MS = 5000

interface Props {
  request: { expression: string } | null
  onResult: (result: DiceRollResult) => void
}

export default function DiceOverlay({ request, onResult }: Props) {
  const boxRef = useRef<InstanceType<typeof DiceBox> | null>(null)

  useEffect(() => {
    let active = true
    const container = document.createElement('div')
    container.id = 'dice-box-container'
    document.body.appendChild(container)

    const box = new DiceBox('#dice-box-container', {
      assetPath: '/assets/',
      theme: 'default',
      scale: 5,
      gravity: 5,
    })

    box.init()
      .then(() => { if (active) boxRef.current = box })
      .catch(console.error)

    return () => {
      active = false
      boxRef.current = null
      try { box.clear() } catch { /* ignore if not yet initialized */ }
      container.remove()
    }
  }, [])

  const prevRequestRef = useRef<{ expression: string } | null>(null)
  const clearTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onResultRef = useRef(onResult)
  onResultRef.current = onResult

  useEffect(() => {
    if (!request || !boxRef.current) return
    if (request === prevRequestRef.current) return
    prevRequestRef.current = request

    const parsed = parseDiceExpression(request.expression)
    if (!parsed) return
    const { count, sides, modifier } = parsed

    if (clearTimeoutRef.current !== null) {
      clearTimeout(clearTimeoutRef.current)
      clearTimeoutRef.current = null
    }

    const box = boxRef.current
    box.add(`${count}d${sides}`)
      .then((results: unknown) => {
        // Cancel whatever timer is pending — this roll settling extends the window
        if (clearTimeoutRef.current !== null) {
          clearTimeout(clearTimeoutRef.current)
        }
        const dice = results as Array<{ value: number; sides: number }>
        const rolls = dice.map(d => d.value)
        const total = rolls.reduce((s, v) => s + v, 0) + modifier
        onResultRef.current({ expression: request.expression, sides, rolls, modifier, total })
        clearTimeoutRef.current = setTimeout(() => {
          clearTimeoutRef.current = null
          try { box.clear() } catch { /* ignore */ }
        }, DICE_CLEAR_DELAY_MS)
      })
      .catch(console.error)
  }, [request])

  return null
}