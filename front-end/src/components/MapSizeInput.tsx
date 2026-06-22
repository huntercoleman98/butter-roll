import { useEffect, useState } from 'react'

interface Props {
  label: string
  value: number
  onChange: (n: number) => void
}

function evaluate(raw: string): number | null {
  const expr = raw.trim()
  const opMatch = expr.match(/^(\d+)\s*([+\-*\/])?\s*(\d+)$/)
  if (opMatch) {
    const current = parseFloat(opMatch[1])
    const operand = parseFloat(opMatch[3])
    switch (opMatch[2]) {
      case '+': return Math.round(current + operand)
      case '-': return Math.round(current - operand)
      case '*': return Math.round(current * operand)
      case '/': return operand !== 0 ? Math.round(current / operand) : null
    }
  }
  const n = parseFloat(expr)
  return isNaN(n) ? null : Math.round(n)
}

export default function MapSizeInput({ label, value, onChange }: Props) {
  const [display, setDisplay] = useState(String(value))

  // Sync display when value changes externally (e.g. aspect-ratio lock updates the other axis)
  useEffect(() => {
    setDisplay(String(value))
  }, [value])

  function commit(raw: string) {
    const result = evaluate(raw)
    if (result !== null && result > 0) {
      onChange(result)
      setDisplay(String(result))
    } else {
      setDisplay(String(value))
    }
  }

  return (
    <div className="field-row">
      <label>{label}</label>
      <input
        type="text"
        value={display}
        style={{ width: 72 }}
        onChange={e => setDisplay(e.target.value)}
        onBlur={e => commit(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.currentTarget.blur()
          }
        }}
      />
    </div>
  )
}
