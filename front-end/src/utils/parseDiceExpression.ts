export interface ParsedDice {
  count: number
  sides: number
  modifier: number
}

export function parseDiceExpression(expr: string): ParsedDice | null {
  const m = /^(\d*)d(\d+)(([+-])(\d+))?$/i.exec(expr.trim())
  if (!m) return null
  const count = m[1] ? parseInt(m[1]) : 1
  const sides = parseInt(m[2])
  let modifier = 0
  if (m[3]) {
    modifier = parseInt(m[5])
    if (m[4] === '-') modifier = -modifier
  }
  if (count < 1 || count > 20 || sides < 2) return null
  return { count, sides, modifier }
}